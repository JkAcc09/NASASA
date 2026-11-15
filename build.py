"""Packs the app into one file, marswalk.html, that opens with a double-click.

Run from anywhere:  python build.py
It inlines every local stylesheet, script and picture (<img>) named in index.html, except the files in EXTERNAL,
which stay as separate files beside marswalk.html. Scripts index.html loads late (lazy.js:
<script type="text/plain" data-lazy-src="…">) become ordinary scripts here, so the single file has
everything from the start. Nothing else is changed.
The result still needs internet access for the NASA map tiles.
"""
import pathlib, re
here = pathlib.Path(__file__).resolve().parent
EXTERNAL = {'dust-baselines.js'}      # optional and large: the page works without it, so it is not packed in
root = here if (here / 'index.html').exists() else here.parent      # this script may sit in tools/ or beside index.html
def find(rel):
    """A file named in index.html: at that path, or, in a checkout without folders, beside index.html."""
    p = root / rel
    return p if p.exists() else root / pathlib.PurePosixPath(rel).name
html = (root / 'index.html').read_text(encoding='utf-8')
def css(m): return '<style>\n' + find(m.group(1)).read_text(encoding='utf-8') + '\n</style>'
def js(m):
    if pathlib.PurePosixPath(m.group(1)).name in EXTERNAL: return m.group(0)
    return '<script>\n' + find(m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>'
html = re.sub(r'<link rel="stylesheet" href="((?!https)[^"]+)">', css, html)
import base64
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
def img(m):                                                          # the start screen's pictures travel inside the file
    f = find(m.group(2)); ext = f.suffix.lower()
    return m.group(1) + 'data:' + MIME[ext] + ';base64,' + base64.b64encode(f.read_bytes()).decode('ascii') + m.group(3)
html = re.sub(r'(<img\b[^>]*?\bsrc=")((?!data:|https?:)[^"]+\.(?:jpe?g|png|webp))(")', img, html)
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
def lazy(m):                                                          # a deferred script: inline it, or link it if EXTERNAL
    if pathlib.PurePosixPath(m.group(1)).name in EXTERNAL: return '<script src="' + m.group(1) + '"></script>'
    return js(m)
html = re.sub(r'<script type="text/plain" data-lazy="[^"]*" data-lazy-src="([^"]+)"></script>', lazy, html)
out = root / 'dist' / 'marswalk.html' if (root / 'js').is_dir() else root / 'marswalk.html'   # flat checkout: marswalk.html sits beside index.html
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8', newline='\n')      # the same bytes on every system (build_dust_baselines.js reads them)
print(out.relative_to(root).as_posix(), len(html.encode('utf-8')) // 1024, 'KB')
