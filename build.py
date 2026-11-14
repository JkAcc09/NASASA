"""Packs the app into one file, dist/marswalk.html, that opens with a double-click.

Run from anywhere:  python tools/build.py
It inlines every local stylesheet and script named in index.html. Nothing else is changed.
The result still needs internet access for the NASA map tiles.
"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
def css(m): return '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '\n</style>'
def js(m): return '<script>\n' + (root / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>'
html = re.sub(r'<link rel="stylesheet" href="((?!https)[^"]+)">', css, html)
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'marswalk.html').write_text(html, encoding='utf-8')
print('dist/marswalk.html', len(html.encode('utf-8')) // 1024, 'KB')
