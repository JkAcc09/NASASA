"""Makes the start screen's Mars picture, mars-color.jpg: NASA's colour map of Mars with the MOLA relief of the
terrain pack shaded into it. Done once here, not in the browser, so the page spends nothing on it while it loads.

Run:  python make_art.py path/to/Mars.jpg
  Mars.jpg is "Images and Textures/Mars/Mars.jpg" from NASA's 3D Resources (github.com/nasa/NASA-3D-Resources), the
  Viking colour mosaic, 1440 x 720, equirectangular, 180 W at the left edge. Needs Pillow and NumPy.
"""
import base64, gzip, json, pathlib, sys
import numpy as np
from PIL import Image

here = pathlib.Path(__file__).resolve().parent
text = (here / 'terrain-data.js').read_text(encoding='utf-8')
pack = json.loads(text[text.index('{'):text.rindex('}') + 1])
raw = np.frombuffer(gzip.decompress(base64.b64decode(pack['data'])), dtype=np.uint8)

def grid(g):                                   # the same decoding as terrain.js decodeGrid
    n = g['nx'] * g['ny']; lo = raw[g['offset']:g['offset'] + n].astype(np.int64); hi = raw[g['offset'] + n:g['offset'] + 2 * n].astype(np.int64)
    z = lo | (hi << 8); d = (z >> 1) ^ -(z & 1); d = d.reshape(g['ny'], g['nx'])
    first = np.cumsum(d[:, 0])                 # the first column runs down the rows; each row then runs across
    d[:, 0] = first
    return np.cumsum(d, axis=1)

G = pack['global']; enc = pack['encoding']
h = grid(G) * enc['step'] - enc['offset']      # 721 rows (90 N to 90 S) x 1440 columns (0 E eastwards), metres
W, H = 1440, 720
lat = 90 - (np.arange(H) + 0.5) * 0.25         # pixel centres of the picture
lon = -180 + (np.arange(W) + 0.5) * 0.25
fy = (90 - lat) / 0.25; y0 = np.clip(np.floor(fy).astype(int), 0, G['ny'] - 2); ay = (fy - y0)[:, None]
fx = (lon % 360) / 0.25; x0 = np.floor(fx).astype(int) % G['nx']; x1 = (x0 + 1) % G['nx']; ax = (fx - np.floor(fx))[None, :]
z = (h[y0][:, x0] * (1 - ax) + h[y0][:, x1] * ax) * (1 - ay) + (h[y0 + 1][:, x0] * (1 - ax) + h[y0 + 1][:, x1] * ax) * ay

M = 3389500 * np.pi / 180 * 0.25               # metres per 0.25 degree of latitude
dx = np.maximum(0.05, np.cos(np.radians(lat)))[:, None] * M
gx = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2 * dx) * 14
zu = np.vstack([z[:1], z[:-1]]); zd = np.vstack([z[1:], z[-1:]])
gy = (zu - zd) / (2 * M) * 14
s = np.array([-0.62, 0.62, 0.48]); s /= np.linalg.norm(s)          # the Sun from the north-west, 30 degrees up
shade = (-gx * s[0] + gy * s[1] + s[2]) / np.sqrt(gx * gx + gy * gy + 1) / s[2]
f = 0.82 + 0.18 * np.clip(shade, 0, 1.9)

src = Image.open(sys.argv[1] if len(sys.argv) > 1 else 'Mars.jpg').convert('RGB').resize((W, H), Image.LANCZOS)
out = np.clip(np.asarray(src, dtype=np.float32) * f[:, :, None], 0, 255).astype(np.uint8)
Image.fromarray(out).save(here / 'mars-color.jpg', quality=86, optimize=True, progressive=True)
print('mars-color.jpg:', (here / 'mars-color.jpg').stat().st_size // 1024, 'KB')
