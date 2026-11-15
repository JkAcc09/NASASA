"""Zips Marswalk for sharing, the way the team's earlier versions were packed.

Run:  python package.py 1.6                  writes All_Versions/NASASA v1.6.zip
      python package.py 1.6 --out D:/share   writes D:/share/NASASA v1.6.zip

It first runs build.py, so marswalk.html matches the source. The zip holds one folder, "NASASA v1.6", with every
file of the app beside index.html (the flat layout of this repository): the page, its scripts and styles, the data
packs, the README and images, and the tools and tests, plus RUN-LOCALLY.txt (how to start it with Python's
web server). It leaves out Git's files, All_Versions (the earlier zips) and caches. It never overwrites a zip.
"""
import argparse, pathlib, subprocess, sys, zipfile

here = pathlib.Path(__file__).resolve().parent
SKIP_DIRS = {'.git', 'All_Versions', '__pycache__', 'node_modules', '.claude', 'dist'}
SKIP_FILES = {'.DS_Store', 'Thumbs.db'}

ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('version', help='for example 1.6')
ap.add_argument('--out', default=str(here / 'All_Versions'), help='folder to write the zip into')
args = ap.parse_args()

name = 'NASASA v' + args.version
out = pathlib.Path(args.out) / (name + '.zip')
if out.exists():
    sys.exit('%s already exists; choose another version number.' % out)

r = subprocess.run([sys.executable, str(here / 'build.py')], capture_output=True, text=True)
if r.returncode:
    sys.exit('build.py failed:\n' + r.stdout + r.stderr)
print(r.stdout.strip())

needed = [l for l in (here / 'index.html').read_text(encoding='utf-8').split('"') if l.endswith(('.js', '.css')) and '/' not in l and ':' not in l]
missing = [f for f in needed if not (here / f).exists()]
if missing:
    sys.exit('index.html names files that are not here: ' + ', '.join(missing))

files = sorted(p for p in here.iterdir() if p.is_file() and p.name not in SKIP_FILES and not p.name.endswith('.zip'))
RUN = '''Marswalk %(v)s: how to run it on your own computer
=============================================================

Quickest: double-click marswalk.html. It is the whole app in one file and opens in Chrome, Edge or Firefox.

From the source files, with Python's built-in web server (needs Python 3, nothing to install):

  1. Open a terminal in this folder (the one holding index.html).
       Windows: in File Explorer, click the address bar, type cmd and press Enter.
       macOS / Linux: right-click the folder and choose "Open in Terminal".
  2. Start the server:
       python -m http.server 8000 --bind 127.0.0.1
     (on macOS or Linux it may be python3 instead of python)
  3. Open http://localhost:8000 in Chrome, Edge or Firefox.
  4. To stop the server, press Ctrl+C in the terminal.

Start the server from inside this folder: started anywhere else it shows a list of files instead of the app.
--bind 127.0.0.1 keeps it on this computer only.

Served this way the page can also work offline: it keeps itself and every map tile you view, and
Map Overlay > Offline map > "Save the walk area" fetches the rest of the walk area ahead of time.
A file opened by double-click cannot do that. The map tiles come from NASA, so the first visit needs internet.

Checks (optional, need Node.js 18 or later; page_test.js needs Node 22+ and Chrome or Edge):
  node dust_test.js      node router_test.js      node features_test.js      node page_test.js

Everything else is in README.md.
''' % {'v': args.version}
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.write(here, name + '/')
    for f in files:
        z.write(f, name + '/' + f.name)
    z.writestr(name + '/RUN-LOCALLY.txt', RUN.replace('\n', '\r\n'))     # Windows line ends: Notepad shows it properly
print('%s: %d files and RUN-LOCALLY.txt, %d KB' % (out, len(files), out.stat().st_size // 1024))
