"""Builds the Marswalk dust data pack (dust-data.js) from the Mars dust optical depth climatology.

Source   Montabone et al., "Climatologies of the Martian Atmospheric Dust Optical Depth", version 2
         https://www-mars.lmd.jussieu.fr/mars/dust_climatology/index.html
         Icarus 251 (2015) 65-95, doi:10.1016/j.icarus.2014.12.034
         JGR Planets (2020), doi:10.1029/2019JE006111
         Built from NASA orbiter retrievals: MGS TES, Mars Odyssey THEMIS and MRO Mars Climate Sounder (MCS).
         Licence: Creative Commons Attribution-ShareAlike 3.0 Unported. This pack is a modified
         (subsampled, quantised) copy and is distributed under the same licence.

What it reads, for every Martian Year asked for:
  griddedcdod_MYnn   OBSERVED. Daily maps, 6 degrees of longitude by 3 or 5 degrees of latitude depending on
                     the year (the tool reads the grid from each file and records it). Grid points
                     without a valid observation are missing. Variables kept: cdod610 (9.3 um absorption
                     column dust optical depth, normalised to 610 Pa), cdod610unc (its combined
                     uncertainty), cdodrel (reliability of the grid point) and Ls.
  dustscenario_MYnn  INTERPOLATED. The same observations spread to complete coverage by kriging
                     (reconstructed maps). Variable kept: cdod610.

What it writes: dust-data.js, one global `window.MARSWALK_DUST`. Nothing is invented: every number is a
bin average of values in the files, and a bin with no valid observation is stored as missing.

How the data is reduced (so the pack stays small enough to ship inside the page):
  time   --step sols are averaged into one frame (default 5 sols, about 2 to 3 degrees of Ls)
  space  the native grids are averaged, weighted by overlap, into --dlon x --dlat degree cells
         (default 6 x 5, which is the native observed grid of the MCS-era years)
  value  one byte per value, 255 = missing, in four planes:
         observed      byte = round(sqrt(optical depth) x 80): steps of about 0.006 at 0.05 and 0.025 at 1.0
         uncertainty   relative combined uncertainty (cdod610unc / cdod610) in steps of 5 %, capped at 200 %
         reliability   the dataset's reliability value in steps of 0.1
         interpolated  the kriged value, same coding as observed, kept only where observed is missing
                       (where an observation exists the page shows the observation)

Run:  python dust_ingest.py                      all years on the server (MY24 to MY36)
      python dust_ingest.py --years 28 34 35     a subset
      python dust_ingest.py --inspect 34         print the variables in one year's files and stop
Only the variables listed above are fetched (HTTP range requests), and they are cached in the system
temporary directory, so a second run does not download again. No third-party packages are needed.
"""
import argparse, array, base64, gzip, json, math, os, pathlib, struct, sys, tempfile, time, urllib.request

BASE = 'https://www-mars.lmd.jussieu.fr/mars/dust_climatology/dataset_v2/'
VERSIONS = {24: '2-0', 25: '2-0', 26: '2-0', 27: '2-0', 28: '2-0', 29: '2-0', 30: '2-0', 31: '2-0', 32: '2-0',
            33: '2-1', 34: '2-5', 35: '2-5', 36: '2-5'}
# Instruments behind each year's maps, from the dataset's own file titles and Montabone et al. (2015, 2020).
INSTRUMENTS = {
    24: 'MGS TES', 25: 'MGS TES', 26: 'MGS TES, Odyssey THEMIS', 27: 'MGS TES, Odyssey THEMIS',
    28: 'Odyssey THEMIS, MRO MCS', 29: 'Odyssey THEMIS, MRO MCS', 30: 'Odyssey THEMIS, MRO MCS',
    31: 'Odyssey THEMIS, MRO MCS', 32: 'Odyssey THEMIS, MRO MCS', 33: 'Odyssey THEMIS, MRO MCS',
    34: 'MRO MCS', 35: 'MRO MCS', 36: 'MRO MCS'}
SCALE = 80            # stored byte = round(sqrt(optical depth) x SCALE)
MISSING = 255
TYPES = {1: ('b', 1), 2: ('c', 1), 3: ('h', 2), 4: ('i', 4), 5: ('f', 4), 6: ('d', 8)}


def fetch(url, start, end, tries=4):
    """Bytes start..end (inclusive) of a remote file."""
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'Range': 'bytes=%d-%d' % (start, end), 'User-Agent': 'marswalk-dust-ingest'})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) != end - start + 1:
                raise IOError('short read: %d of %d bytes' % (len(data), end - start + 1))
            return data
        except Exception as e:                     # network hiccup: wait and try again
            if k == tries - 1:
                raise
            time.sleep(3 * (k + 1))


class NC3:
    """Just enough of the NetCDF classic (CDF-1/CDF-2) format to list variables and read them by byte range."""

    def __init__(self, url):
        self.url = url
        self.buf = fetch(url, 0, 65535)
        self.pos = 0
        magic = self.buf[:4]
        if magic[:3] != b'CDF' or magic[3] not in (1, 2):
            raise ValueError('not a NetCDF classic file: ' + url)
        self.wide = magic[3] == 2
        self.pos = 4
        self.numrecs = self._int()
        self.dims = self._dims()
        self.attrs = self._attrs()
        self.vars = self._vars()

    def _int(self):
        v = struct.unpack_from('>i', self.buf, self.pos)[0]; self.pos += 4; return v

    def _name(self):
        n = self._int(); s = self.buf[self.pos:self.pos + n].decode('latin-1'); self.pos += (n + 3) // 4 * 4; return s

    def _dims(self):
        tag, n = self._int(), self._int()
        return [(self._name(), self._int()) for _ in range(n)] if tag == 10 else []

    def _attrs(self):
        tag, n = self._int(), self._int()
        out = {}
        if tag != 12:
            return out
        for _ in range(n):
            name = self._name(); t = self._int(); cnt = self._int(); code, size = TYPES[t]
            raw = self.buf[self.pos:self.pos + cnt * size]; self.pos += (cnt * size + 3) // 4 * 4
            out[name] = raw.decode('latin-1') if t == 2 else list(struct.unpack('>%d%s' % (cnt, code), raw))
        return out

    def _vars(self):
        tag, n = self._int(), self._int()
        out = {}
        if tag != 11:
            return out
        for _ in range(n):
            name = self._name(); nd = self._int(); dimids = [self._int() for _ in range(nd)]
            attrs = self._attrs(); t = self._int(); vsize = self._int()
            if self.wide:
                begin = struct.unpack_from('>q', self.buf, self.pos)[0]; self.pos += 8
            else:
                begin = self._int()
            shape = [self.dims[d][1] for d in dimids]
            out[name] = {'type': t, 'shape': shape, 'dims': [self.dims[d][0] for d in dimids], 'begin': begin, 'vsize': vsize,
                         'attrs': attrs, 'record': bool(shape) and shape[0] == 0}
        return out

    def read(self, name, cache_dir):
        """A whole variable as a flat array of Python numbers (row-major)."""
        v = self.vars[name]
        if v['record']:
            raise ValueError(name + ' is a record variable; this reader handles fixed-size variables only')
        code, size = TYPES[v['type']]
        count = 1
        for s in v['shape']:
            count *= s
        cache = pathlib.Path(cache_dir) / (self.url.rsplit('/', 1)[1] + '.' + name + '.bin')
        if cache.exists() and cache.stat().st_size == count * size:
            raw = cache.read_bytes()
        else:
            raw = bytearray()
            chunk = 8 << 20
            for off in range(0, count * size, chunk):
                raw += fetch(self.url, v['begin'] + off, v['begin'] + min(count * size, off + chunk) - 1)
            cache.write_bytes(raw)
        a = array.array(code)
        a.frombytes(bytes(raw))
        if sys.byteorder == 'little':
            a.byteswap()
        return a


def valid(x, fill):
    return x == x and abs(x) < 1e4 and x != fill and x >= 0


def bin_year(my, args, cache_dir):
    """One Martian Year reduced to frames. Returns the metadata and four byte planes per frame."""
    ver = VERSIONS[my]
    g = NC3(BASE + 'griddedcdod_MY%d_v%s.nc' % (my, ver))
    k = NC3(BASE + 'dustscenario_MY%d_v%s.nc' % (my, ver))
    out_nx, out_ny = int(round(360 / args.dlon)), int(round(180 / args.dlat))
    lon0 = -180 - args.dlon / 2          # output columns are centred on the native longitudes: column 0 straddles 180 W

    def overlaps(centres, lo_edge, width, n_out, wrap):
        """For each native grid point: [(output index, weight)], weight = share of the native cell inside that output cell."""
        d = abs(centres[1] - centres[0]); out = []
        for c in centres:
            a, b = c - d / 2, c + d / 2; ws = []
            k0 = int(math.floor((a - lo_edge) / width + 1e-9)); k1 = int(math.floor((b - lo_edge) / width - 1e-9))
            for k in range(k0, k1 + 1):
                w = (min(b, lo_edge + (k + 1) * width) - max(a, lo_edge + k * width)) / d
                kk = k % n_out if wrap else k
                if w > 1e-6 and 0 <= kk < n_out:
                    ws.append((kk, w))
            out.append(ws)
        return out

    def cell_index(nc):
        lon = nc.read('longitude', cache_dir); lat = nc.read('latitude', cache_dir)
        ix = overlaps(list(lon), lon0, args.dlon, out_nx, True)
        iy = overlaps([-y for y in lat], -90.0, args.dlat, out_ny, False)        # row 0 starts at 90 N
        return lon, lat, ix, iy

    glon, glat, gix, giy = cell_index(g)
    klon, klat, kix, kiy = cell_index(k)
    ls = g.read('Ls', cache_dir)
    nt = len(ls)
    cd = g.read('cdod610', cache_dir); un = g.read('cdod610unc', cache_dir); rl = g.read('cdodrel', cache_dir)
    kcd = k.read('cdod610', cache_dir)
    gfill = (g.vars['cdod610']['attrs'].get('_FillValue') or g.vars['cdod610']['attrs'].get('missing_value') or [None])[0]
    kfill = (k.vars['cdod610']['attrs'].get('_FillValue') or k.vars['cdod610']['attrs'].get('missing_value') or [None])[0]
    gny, gnx, kny, knx = len(glat), len(glon), len(klat), len(klon)
    if len(cd) != nt * gny * gnx or len(kcd) != len(k.read('Ls', cache_dir)) * kny * knx:
        raise ValueError('unexpected variable shape in MY%d' % my)
    knt = len(kcd) // (kny * knx)
    ncell = out_nx * out_ny
    frames_ls, frames_sol, obs, unc, rel, krg = [], [], bytearray(), bytearray(), bytearray(), bytearray()
    native_valid = native_total = 0
    for t0 in range(0, nt, args.step):
        ts = range(t0, min(nt, t0 + args.step))
        s = [0.0] * ncell; su = [0.0] * ncell; sr = [0.0] * ncell; n = [0.0] * ncell
        ks = [0.0] * ncell; kn = [0.0] * ncell
        for t in ts:
            base = t * gny * gnx
            for j in range(gny):
                row = base + j * gnx
                for i in range(gnx):
                    x = cd[row + i]; native_total += 1
                    if valid(x, gfill):
                        native_valid += 1
                        u = un[row + i]; r = rl[row + i]
                        u = u if valid(u, gfill) else 0.0; r = r if valid(r, gfill) else 0.0
                        for cy, wy in giy[j]:
                            for cx, wx in gix[i]:
                                c = cy * out_nx + cx; w = wy * wx
                                s[c] += x * w; su[c] += u * w; sr[c] += r * w; n[c] += w
            if t < knt:
                base = t * kny * knx
                for j in range(kny):
                    row = base + j * knx
                    for i in range(knx):
                        x = kcd[row + i]
                        if valid(x, kfill):
                            for cy, wy in kiy[j]:
                                for cx, wx in kix[i]:
                                    c = cy * out_nx + cx; w = wy * wx
                                    ks[c] += x * w; kn[c] += w
        q = lambda v: min(MISSING - 1, int(round(math.sqrt(max(0.0, v)) * SCALE)))
        for c in range(ncell):
            if n[c] > 0:
                v = s[c] / n[c]
                obs.append(q(v)); krg.append(MISSING)        # an observation exists: the kriged value is not needed
                unc.append(min(40, int(round(su[c] / n[c] / max(v, 1e-3) * 20))))
                rel.append(min(10, int(round(sr[c] / n[c] * 10))))
            else:
                obs.append(MISSING); unc.append(MISSING); rel.append(MISSING)
                krg.append(q(ks[c] / kn[c]) if kn[c] > 0 else MISSING)
        mid = ts[len(ts) // 2]
        frames_ls.append(round(ls[mid], 2)); frames_sol.append(mid + 1)
    meta = {'my': my, 'version': ver, 'instruments': INSTRUMENTS[my], 'frames': len(frames_ls), 'ls': frames_ls, 'sol': frames_sol,
            'nativeGrid': {'observed': '%g x %g deg' % (abs(glon[1] - glon[0]), abs(glat[1] - glat[0])),
                           'interpolated': '%g x %g deg' % (abs(klon[1] - klon[0]), abs(klat[1] - klat[0]))},
            'observedCoverage': round(native_valid / max(1, native_total), 3),
            'files': ['griddedcdod_MY%d_v%s.nc' % (my, ver), 'dustscenario_MY%d_v%s.nc' % (my, ver)]}
    return meta, obs, unc, rel, krg


def inspect(my, cache_dir):
    for kind in ('griddedcdod', 'dustscenario'):
        nc = NC3(BASE + '%s_MY%d_v%s.nc' % (kind, my, VERSIONS[my]))
        print('==', nc.url, '\n   dims', nc.dims, 'numrecs', nc.numrecs)
        for name, v in nc.vars.items():
            a = {k: (x if not isinstance(x, str) else x[:70]) for k, x in v['attrs'].items() if k != 'comment'}
            print('   %-12s type %d shape %s begin %d  %s' % (name, v['type'], v['shape'], v['begin'], a))
        for name in ('longitude', 'latitude'):
            x = nc.read(name, cache_dir); print('   ', name, len(x), list(x[:3]), '...', list(x[-2:]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--years', type=int, nargs='*', default=sorted(VERSIONS))
    ap.add_argument('--step', type=int, default=5, help='sols averaged into one frame')
    ap.add_argument('--dlon', type=float, default=6.0); ap.add_argument('--dlat', type=float, default=5.0)
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'marswalk-dust-cache'))
    here = pathlib.Path(__file__).resolve().parent                     # this script may sit in tools/ or beside index.html
    js_dir = here if (here / 'index.html').exists() else (here.parent / 'js' if (here.parent / 'js').is_dir() else here)
    ap.add_argument('--out', default=str(js_dir / 'dust-data.js'))
    ap.add_argument('--inspect', type=int, metavar='MY')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    if args.inspect:
        inspect(args.inspect, args.cache); return
    years, blob, failed = [], bytearray(), []
    for my in args.years:
        try:
            t0 = time.time()
            meta, obs, unc, rel, krg = bin_year(my, args, args.cache)
            meta['offset'] = len(blob)
            blob += obs + unc + rel + krg                     # four planes, each frames x ny x nx bytes
            years.append(meta)
            print('MY%d: %d frames, %.0f%% of native grid points observed, %.0f s' % (my, meta['frames'], meta['observedCoverage'] * 100, time.time() - t0))
        except Exception as e:                                # a year that cannot be fetched is left out, never filled in
            failed.append({'my': my, 'reason': str(e)}); print('MY%d: NOT INCLUDED (%s)' % (my, e))
    if not years:
        sys.exit('No data could be fetched; dust-data.js was not written.')
    pack = {
        'format': 'marswalk-dust', 'version': 1, 'built': time.strftime('%Y-%m-%d'),
        'quantity': 'Column dust optical depth, infrared absorption at 9.3 um, normalised to 610 Pa (cdod610)',
        'source': {'name': 'Montabone et al., Climatologies of the Martian Atmospheric Dust Optical Depth, v2',
                   'url': 'https://www-mars.lmd.jussieu.fr/mars/dust_climatology/index.html',
                   'doi': ['10.1016/j.icarus.2014.12.034', '10.1029/2019JE006111'],
                   'licence': 'CC BY-SA 3.0; subsampled and quantised from the original files'},
        'grid': {'nx': int(round(360 / args.dlon)), 'ny': int(round(180 / args.dlat)), 'dlon': args.dlon, 'dlat': args.dlat,
                 'lon0': -180 - args.dlon / 2, 'lat0': 90,
                 'note': 'cell (row j, column i) spans lon0+i*dlon to lon0+(i+1)*dlon east and lat0-j*dlat to lat0-(j+1)*dlat; column 0 straddles 180 W'},
        'time': {'stepSols': args.step, 'note': 'each frame is the mean of stepSols daily maps; ls and sol are those of the middle sol'},
        'encoding': {'scale': SCALE, 'missing': MISSING, 'planes': ['observed', 'uncertainty', 'reliability', 'interpolated'],
                     'note': 'per year at `offset`: four planes of frames*ny*nx bytes. observed and interpolated: optical depth = (byte/scale)^2. uncertainty: relative, byte*5 percent. reliability: byte/10. 255 = missing. interpolated is stored only where observed is missing'},
        'years': years, 'notIncluded': failed}
    packed = base64.b64encode(gzip.compress(bytes(blob), 9, mtime=0)).decode('ascii')
    head = ('/* Marswalk dust data pack. Written by dust_ingest.py on %s; do not edit by hand.\n'
            ' * Column dust optical depth (9.3 um absorption, normalised to 610 Pa) from the Montabone et al. climatology v2,\n'
            ' * which is built from NASA MGS TES, Mars Odyssey THEMIS and MRO Mars Climate Sounder retrievals.\n'
            ' * https://www-mars.lmd.jussieu.fr/mars/dust_climatology/  CC BY-SA 3.0. Modified: averaged to %g x %g degrees\n'
            ' * and %d-sol frames, stored in steps of 0.01. `data` is gzip, then base64; the layout is in `encoding`.\n */\n'
            % (pack['built'], args.dlon, args.dlat, args.step))
    lines = [packed[i:i + 4000] for i in range(0, len(packed), 4000)]
    js = head + 'window.MARSWALK_DUST = ' + json.dumps(pack, separators=(',', ':')) + ';\nwindow.MARSWALK_DUST.data =\n  "' + '" +\n  "'.join(lines) + '";\n'
    pathlib.Path(args.out).write_text(js, encoding='utf-8')
    print('%s: %d years, %d KB raw, %d KB written' % (args.out, len(years), len(blob) // 1024, len(js) // 1024))


if __name__ == '__main__':
    main()
