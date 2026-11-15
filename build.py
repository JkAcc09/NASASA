"""Packs the app into one file, marswalk.html, that opens with a double-click.

Run from anywhere:  python build.py
It inlines every local stylesheet and script named in index.html, except the files in EXTERNAL,
which stay as separate files beside marswalk.html. Nothing else is changed.
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
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
out = root / 'dist' / 'marswalk.html' if (root / 'js').is_dir() else root / 'marswalk.html'   # flat checkout: marswalk.html sits beside index.html
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out.relative_to(root).as_posix(), len(html.encode('utf-8')) // 1024, 'KB')
