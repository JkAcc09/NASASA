"""terrain_ingest.py: writes terrain-data.js, the elevation pack that the route-finder uses.

Run it from the folder that holds index.html:   python terrain_ingest.py [folder with the two source files]

What it makes
    Height of the Martian surface above the MOLA reference level (the areoid), in metres:
      - the whole planet on a 0.25 degree grid (about 15 km at the equator), and
      - the Gale crater exploration zone on a 0.0625 degree grid (about 3.7 km), the finest the source supports.

Where the numbers come from (both files are downloaded once, then kept beside this script)
    MarsTopo719.shape   The shape of Mars as spherical harmonics to degree 719, by M. Wieczorek (2015),
                        built from NASA's Mars Orbiter Laser Altimeter (MGS MOLA) gridded data.
    gmm3_120_sha.tab    The GMM-3 gravity field of Mars to degree 120, Genova et al. (2016), NASA GSFC,
                        from MGS, Mars Odyssey and MRO tracking.
    Both are fetched from the SHTOOLS project's example data:
    https://github.com/SHTOOLS/SHTOOLS/tree/master/examples/ExampleDataFiles

How height is worked out
    MOLA heights are measured from the areoid: the surface of constant gravity-plus-rotation potential whose
    mean radius round the equator is 3,396 km (Smith et al. 2001). This script finds that potential from GMM-3,
    solves for the areoid's radius in every direction (second-order, gravity to degree 90), and subtracts it
    from the shape. The result is checked against the published MOLA heights of nine landing sites on flat
    ground; the script stops if any is more than 60 m out.

What it is not
    Degree 719 resolves features about 15 km across. Cliffs, buttes, dunes and boulders are far smaller than
    that and are not in this data. Slopes worked out from it are regional slopes.

Needs: numpy and pyshtools (pip install pyshtools).
"""
import base64, datetime, gzip, json, pathlib, sys, urllib.request
import numpy as np
import pyshtools as pysh
from pyshtools.legendre import PlmBar

HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE
URL = 'https://raw.githubusercontent.com/SHTOOLS/SHTOOLS/master/examples/ExampleDataFiles/'
FILES = ['MarsTopo719.shape', 'gmm3_120_sha.tab']

OMEGA = 7.0882181e-5          # rad/s, rotation rate of Mars
A = 3396000.0                 # m, the mean equatorial radius that defines the MOLA datum
F = 1 / 169.8                 # flattening of the helper ellipsoid (the result does not depend on it)
L_GRAV = 90                   # gravity degrees used for the areoid: its shape is smooth
STEP = 4                      # metres per stored unit
OFFSET = 9000                 # metres added before storing, so every stored value is positive
GLOBAL_D = 0.25               # degrees
INSET = dict(name='Gale crater exploration zone', north=-2.0, south=-8.0, west=134.0, east=141.0, d=0.0625)

# Published MOLA heights of landing sites on flat ground (m): the check on the whole calculation.
CHECK = [('Viking 1', 22.27, -47.95, -3627), ('Viking 2', 47.64, 134.29, -4505), ('Mars Pathfinder', 19.13, -33.22, -3682),
         ('Opportunity', -1.9462, -5.5266, -1385), ('Spirit', -14.5684, 175.4726, -1940), ('Phoenix', 68.22, -125.75, -4126),
         ('InSight', 4.502, 135.623, -2613), ('Zhurong', 25.066, 109.925, -4100), ('Bradbury Landing (Curiosity)', -4.5895, 137.4417, -4501)]
CHECK_TOL = {'Bradbury Landing (Curiosity)': 250}      # inside a 154 km crater beside a 5 km mountain: smoothing shows


def fetch():
    for f in FILES:
        p = SRC / f
        if not p.exists():
            print('downloading', f)
            urllib.request.urlretrieve(URL + f, p)


def heights():
    """Height above the areoid on the model's own 0.125 degree grid: rows 90 N to 90 S, columns 0 to 360 E."""
    shape = pysh.SHCoeffs.from_file(str(SRC / FILES[0]), lmax=719)
    grav = pysh.SHGravCoeffs.from_file(str(SRC / FILES[1]), header_units='km', errors=True)
    gm, r0 = grav.gm, grav.r0
    p = PlmBar(L_GRAV, 0.0)
    w0 = gm / A * (1.0 + sum(grav.coeffs[0, l, 0] * p[l * (l + 1) // 2] for l in range(2, L_GRAV + 1))) + 0.5 * OMEGA ** 2 * A ** 2
    n = pysh.gravmag.MakeGeoidGridDH(grav.coeffs, r0, gm, w0, omega=OMEGA, a=A, f=F, order=2, lmax=719, lmax_calc=L_GRAV, sampling=2, extend=True)
    lats = np.linspace(90, -90, n.shape[0])
    phi = np.radians(lats)[:, None]
    areoid = A * (1 - F) / np.sqrt(1 - (2 * F - F * F) * np.cos(phi) ** 2) + n
    topo = shape.expand(grid='DH2', lmax=719, extend=True).to_array() - areoid
    return topo, w0, shape, areoid


def sample(topo, lat, lon):
    """Bilinear reading of the 0.125 degree grid."""
    lon = np.mod(lon, 360.0)
    i = (90.0 - lat) / 0.125; j = lon / 0.125
    i0 = np.clip(np.floor(i).astype(int), 0, topo.shape[0] - 2); j0 = np.clip(np.floor(j).astype(int), 0, topo.shape[1] - 2)
    a = i - i0; b = j - j0
    return (topo[i0, j0] * (1 - b) + topo[i0, j0 + 1] * b) * (1 - a) + (topo[i0 + 1, j0] * (1 - b) + topo[i0 + 1, j0 + 1] * b) * a


def inset_grid(shape, areoid):
    """The inset, read from the harmonics themselves at every point: smoother than stretching the coarse grid."""
    lat = np.arange(INSET['north'], INSET['south'] - 1e-9, -INSET['d'])
    lon = np.arange(INSET['west'], INSET['east'] + 1e-9, INSET['d'])
    la, lo = np.meshgrid(lat, lon, indexing='ij')
    r = shape.expand(lat=la.ravel(), lon=lo.ravel(), lmax_calc=719).reshape(la.shape)
    return r - sample(areoid, la, lo), lat, lon


def encode(grid):
    """Rows of heights as bytes: units of STEP metres, each stored as the difference from the value to its left
    (the first of a row: from the value above), zigzag, low bytes of all values then high bytes."""
    v = np.round((grid + OFFSET) / STEP).astype(np.int64)
    if v.min() < 0 or v.max() > 65535: raise SystemExit('height out of range for the encoding')
    d = np.diff(v, axis=1, prepend=0)
    d[:, 0] = v[:, 0] - np.concatenate([[0], v[:-1, 0]])
    z = ((d << 1) ^ (d >> 63)).astype(np.uint16)
    return np.concatenate([(z & 255).astype(np.uint8).ravel(), (z >> 8).astype(np.uint8).ravel()]).tobytes(), v


def main():
    fetch()
    topo, w0, shape, areoid = heights()
    print('reference potential W0 = %.1f m2/s2 (MOLA datum: 12652804.7)' % w0)
    print('height range %.0f to %.0f m' % (topo.min(), topo.max()))
    bad = 0
    for name, lat, lon, ref in CHECK:
        z = float(sample(topo, np.float64(lat), np.float64(lon))); tol = CHECK_TOL.get(name, 60)
        ok = abs(z - ref) <= tol; bad += not ok
        print('  %-30s model %7.0f m   MOLA %6d m   difference %5.0f m  %s' % (name, z, ref, z - ref, 'ok' if ok else 'OUT OF TOLERANCE (%d m)' % tol))
    if bad: raise SystemExit('The heights do not match the landing sites. Nothing written.')

    glob = topo[::2, :-1:2]                                   # 721 x 1440: every 0.25 degrees, without the repeated 360 column
    ins, ilat, ilon = inset_grid(shape, areoid)
    gb, _ = encode(glob); ib, _ = encode(ins)
    raw = gb + ib
    pack = {
        'format': 'marswalk-terrain', 'version': 1, 'built': datetime.date.today().isoformat(),
        'quantity': 'Height of the surface above the MOLA reference level (areoid), metres',
        'source': {
            'shape': 'MarsTopo719 (M. Wieczorek, 2015), spherical harmonics to degree 719 of the MGS MOLA gridded shape of Mars',
            'gravity': 'GMM-3 (Genova et al., 2016, NASA GSFC), degrees 2 to %d, for the areoid' % L_GRAV,
            'url': 'https://github.com/SHTOOLS/SHTOOLS/tree/master/examples/ExampleDataFiles',
            'datum': 'areoid with mean equatorial radius 3,396 km; W0 = %.1f m2/s2' % w0},
        'resolution': 'Features smaller than about 15 km are not resolved: cliffs, buttes, dunes and boulders are not in this data.',
        'encoding': {'step': STEP, 'offset': OFFSET, 'note': 'per grid: ny*nx low bytes then ny*nx high bytes of zigzag differences; see terrain_ingest.py encode()'},
        'global': {'nx': glob.shape[1], 'ny': glob.shape[0], 'd': GLOBAL_D, 'lat0': 90.0, 'lon0': 0.0, 'offset': 0, 'wraps': True,
                   'note': 'row j, column i is the height at latitude lat0 - j*d, east longitude lon0 + i*d'},
        'inset': {'name': INSET['name'], 'nx': ins.shape[1], 'ny': ins.shape[0], 'd': INSET['d'], 'lat0': float(ilat[0]), 'lon0': float(ilon[0]), 'offset': len(gb)},
        'check': [{'site': n, 'lat': la, 'lon': lo, 'mola_m': r} for n, la, lo, r in CHECK],
        'data': base64.b64encode(gzip.compress(raw, 9)).decode('ascii'),
    }
    out = HERE / 'terrain-data.js'
    head = ('/* Marswalk terrain pack. Written by terrain_ingest.py on %s; do not edit by hand.\n'
            ' * Height above the MOLA reference level, from the MarsTopo719 shape model (MGS MOLA) and the GMM-3 gravity model.\n'
            ' * The whole planet every 0.25 degrees, and the Gale exploration zone every 0.0625 degrees.\n'
            ' * It resolves features about 15 km across. It does not show cliffs, buttes, dunes or boulders.\n'
            ' * `data` is gzip, then base64; the layout is in `encoding`.\n */\n') % pack['built']
    out.write_text(head + 'window.MARSWALK_TERRAIN = ' + json.dumps(pack, separators=(',', ':')) + ';\n', encoding='utf-8')
    print(out.name, round(out.stat().st_size / 1024), 'KB; global', glob.shape, 'inset', ins.shape)


if __name__ == '__main__':
    main()
