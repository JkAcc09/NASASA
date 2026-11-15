/* page_test.js — opens the real page in headless Chrome or Edge and checks that it works end to end.
 * Run:  node page_test.js                      (Node 22 or later; no packages; Chrome or Edge installed)
 *       CHROME=/path/to/chrome node page_test.js   to choose the browser
 *
 * It serves this folder on a free local port, drives the browser through the DevTools protocol, and fails on any
 * missing file, script error or broken feature: the tabs and their keys, the (i) pop-ups, going to places and
 * moving the walker between sites, checkpoints and view links, the walk budget, slope, companions, the season
 * planner, the route-finder's budget line, deferred dust loading, the single-file marswalk.html, and the offline
 * store (it stops the server and reloads the page from the service worker). Map tiles come from NASA, so it needs
 * an internet connection for the tile checks.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function findBrowser() {
  const c = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].filter(Boolean);
  return c.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]), f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ---------------------------------------------------------------- a minimal DevTools-protocol client */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const waiting = new Map(), handlers = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
    else handlers.forEach(h => h(m));
  };
  const send = (method, params, sessionId) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId })); });
  return new Promise((res, rej) => { ws.onopen = () => res({ send, on: h => handlers.push(h), close: () => ws.close() }); ws.onerror = rej; });
}

let passed = 0, failed = 0;
function ok(cond, what, detail) {
  if (cond) passed++; else failed++;
  console.log((cond ? '  ok    ' : '  FAIL  ') + what + (detail !== undefined ? '  [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ']' : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const exe = findBrowser();
  if (!exe) { console.error('No Chrome or Edge found. Set CHROME=/path/to/browser.'); process.exit(2); }
  let srv = await serve();
  const port = srv.address().port, base = 'http://127.0.0.1:' + port + '/';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marswalk-test-'));
  const br = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = ''; br.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) res(m[1]); });
    setTimeout(() => rej(new Error('The browser did not start.')), 20000);
  });
  const c = await cdp(wsUrl);
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [], bad = [];
  c.on(m => {
    if (m.sessionId !== S) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description.split('\n')[0] : m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith(base) && m.params.response.status >= 400) bad.push(m.params.response.status + ' ' + m.params.response.url.slice(base.length));
    if (m.method === 'Network.loadingFailed' && m.params.type !== 'Ping' && !m.params.canceled && (m.params.errorText || '').indexOf('ABORTED') < 0) bad.push('failed ' + m.params.requestId + ' ' + m.params.errorText);
  });
  await c.send('Runtime.enable', {}, S); await c.send('Network.enable', {}, S); await c.send('Page.enable', {}, S);
  const run = async (fn, arg) => {
    const r = await c.send('Runtime.evaluate', { expression: '(' + fn + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', awaitPromise: true, returnByValue: true }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (url, ready) => {
    await c.send('Page.navigate', { url }, S);
    for (let i = 0; i < 120; i++) { await sleep(250); try { if (await run(ready)) return true; } catch (e) {} }
    return false;
  };

  try {
    /* ============================================================ index.html, from source */
    console.log('The page, from source (' + path.basename(exe) + ')');
    const loaded = await open(base + 'index.html', () => !!(window.MW && MW.dust && MW.dust.pack && MW.dustUI.state.my && MW.offline));
    ok(loaded, 'index.html loads and the dust data arrives');
    const a = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      R.modules = ['config', 'geo', 'budget', 'places', 'dust', 'dustUI', 'terrain', 'router', 'navUI', 'placesUI', 'season', 'companions', 'offline', 'lazy'].filter(k => !MW[k]);
      R.lazyStart = Math.round((performance.getEntriesByType('resource').find(e => /dust-data\.js/.test(e.name)) || {}).startTime || -1);
      R.appStart = Math.round((performance.getEntriesByType('resource').find(e => /\/app\.js/.test(e.name)) || {}).startTime || -1);
      /* tabs and their keys: the arrows move the focus, never the walker */
      const tabs = [...document.querySelectorAll('#tabs button[data-tab-btn]')], s = Marswalk._state, x0 = s.x, y0 = s.y, mode0 = s.mode;
      tabs[0].focus(); const key = k => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      key('ArrowDown'); R.k1 = document.activeElement.getAttribute('data-tab-btn'); key('End'); R.k2 = document.activeElement.getAttribute('data-tab-btn');
      key('ArrowDown'); R.k3 = document.activeElement.getAttribute('data-tab-btn'); key('ArrowUp'); R.k4 = document.activeElement.getAttribute('data-tab-btn');
      await W(400); R.still = s.x === x0 && s.y === y0 && s.mode === mode0;
      document.activeElement.blur();
      /* the (i) pop-ups for the new terms */
      R.info = {};
      for (const k of ['places', 'slope', 'walkBudget', 'companions', 'season', 'offline']) {
        const b = document.querySelector('button.info[data-info="' + k + '"]'); if (!b) { R.info[k] = 'no button'; continue; }
        const tab = b.closest('[data-tab]'); if (tab) Marswalk.openTab(tab.getAttribute('data-tab').split(' ')[0]);
        b.click(); R.info[k] = !$('info-pop').hidden && $('info-pop').querySelector('h4').textContent; document.body.click();
      }
      Marswalk.openTab('menu');
      /* readouts */
      R.slope = $('r-slope').textContent; R.o2 = $('e-o2').textContent; R.turn = $('e-turn').textContent; R.hash = location.hash;
      return R;
    });
    ok(!a.modules.length, 'every module is present', a.modules.length ? 'missing ' + a.modules.join(', ') : undefined);
    ok(a.lazyStart > a.appStart + 500, 'the dust packs load after the page has started', 'app.js at ' + a.appStart + ' ms, dust-data.js at ' + a.lazyStart + ' ms');
    ok(a.k1 === 'nav' && a.k2 === 'time' && a.k3 === 'menu' && a.k4 === 'time', 'arrow keys, Home and End move between the tabs', [a.k1, a.k2, a.k3, a.k4].join(' '));
    ok(a.still, 'and do not move the walker');
    ok(Object.values(a.info).every(v => typeof v === 'string' && v.length > 3 && v !== 'no button'), 'every new (i) button opens its explanation', Object.values(a.info).join('; '));
    ok(/°$/.test(a.slope) && /%$/.test(a.o2) && /min/.test(a.turn), 'slope, oxygen and turn-back readouts are filled in', a.slope + ', ' + a.o2 + ', ' + a.turn);
    ok(/^#map=-4\.\d+,137\.\d+,[\d.]+(&dust=36,\d+)?$/.test(a.hash), 'the address holds the view', a.hash);

    const b = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {}, G = MW.geo, app = Marswalk;
      R.groups = [...$('pl-list').querySelectorAll('summary')].map(s => s.textContent.replace(/\s+\d+$/, ''));
      const h0 = app.here(); MW.placesUI.view('lm:Olympus Mons'); await W(500);
      R.view = { moved: JSON.stringify(app.here()) !== JSON.stringify(h0), lat: app._map.getCenter().lat, imagery: /Viking/.test($('pl-msg').textContent) };
      MW.placesUI.walk('lm:Bradbury Landing', true); await W(500);
      R.local = { site: G.SITE.name, near: Math.abs(app.here().lat - -4.5895) < 1e-6, x: Math.round(app._state.x), y: Math.round(app._state.y) };
      MW.placesUI.walk('lm:Jezero crater', true); await W(900);
      R.far = { site: G.SITE.name, xy: Math.hypot(app._state.x, app._state.y), air: $('e-air').textContent, z: $('r-z-l').textContent, base: !!document.querySelector('.leaflet-tooltip') && [...document.querySelectorAll('.leaflet-tooltip')].some(t => /Jezero/.test(t.textContent)) };
      MW.navUI.routeTo({ lat: 18.4, lon: 77.6, name: 'Jezero test' }); await W(400);
      R.farRoute = { cards: document.querySelectorAll('.rt-card').length, from: $('rt-from').textContent.slice(0, 60), msg: $('rt-msg').textContent };
      MW.navUI.clear();
      MW.placesUI.walk('sol:4560:0', true); await W(600);
      R.back = { gale: G.SITE.gale, x: Math.round(app._state.x), air: $('e-air').textContent };
      /* checkpoints */
      $('pl-cp-walker').click(); $('pl-save-name').value = 'Page test spot'; $('pl-save').dispatchEvent(new Event('submit', { cancelable: true })); await W(200);
      R.cp = MW.places.checkpoints.list().map(c => c.name + ':' + c.kind);
      R.cpRow = [...$('pl-list').querySelectorAll('li b')].some(x => x.textContent === 'Page test spot');
      MW.places.checkpoints.list().forEach(c => MW.places.checkpoints.remove(c.id));
      /* a walk: replay Curiosity's drive at 120x for a few seconds; the budget is used, the companion moves alongside */
      MW.companions.show('w2', true, 'curiosity');
      const m0 = MW.companions.list().find(m => m.id === 'w2');
      $('speed').value = '120'; $('speed').dispatchEvent(new Event('change'));
      document.getElementById('mode-replay').click(); await W(100);
      document.getElementById('btn-play').click(); await W(4000); document.getElementById('btn-play').click();
      const m1 = MW.companions.list().find(m => m.id === 'w2');
      R.walk = { dist: Math.round(app._state.dist), o2: app.budget().o2Pct, batt: app.budget().battPct, mateMoved: G.haversine(m0, m1), mates: $('mates').textContent.indexOf('replaying') >= 0 };
      app._map.setView([-4.8, 137.384], 16);
      /* a planned route carries the budget line */
      MW.navUI.routeTo({ lat: -4.83, lon: 137.39, name: 'Test point' }); await W(400);
      R.rt = [...document.querySelectorAll('.rt-budget')].map(p => p.textContent)[0] || null; MW.navUI.clear();
      /* the season planner */
      app.openTab('dust'); await W(2500);
      R.season = $('season-text').textContent; app.openTab('menu');
      R.slopeVar = [...$('route-var').options].some(o => o.value === 'grade');
      return R;
    });
    ok(['Your checkpoints', 'Gale crater', 'Landing sites', 'Planet', 'Curiosity stops'].every(g => b.groups.indexOf(g) >= 0), 'the place list is grouped', b.groups.join(', '));
    ok(!b.view.moved && Math.abs(b.view.lat - 18.65) < 1 && b.view.imagery, 'View shows Olympus Mons, names its imagery, and leaves the walker');
    ok(b.local.site.indexOf('Gale') >= 0 && b.local.near && Math.hypot(b.local.x, b.local.y) > 5000, 'Walk from here to Bradbury Landing keeps the Gale base', b.local.x + ' m E, ' + b.local.y + ' m N of base');
    ok(b.far.site === 'Jezero crater' && b.far.xy < 1 && b.far.air === '–' && /regional/.test(b.far.z) && b.far.base, 'a walk at Jezero starts a new site: base there, no Gale weather, regional height');
    ok(b.farRoute.cards > 0 && /18\.\d+° N/.test(b.farRoute.from), 'the route-finder works from the new base', b.farRoute.cards + ' routes; ' + (b.farRoute.msg || b.farRoute.from));
    ok(b.back.gale && b.back.x === 0 && /°C/.test(b.back.air), 'a Curiosity stop takes the walker back to the Gale base and its weather');
    ok(b.cp.length === 1 && b.cp[0] === 'Page test spot:walker' && b.cpRow, 'a checkpoint is saved and listed');
    ok(b.walk.dist > 50 && b.walk.o2 < 100 && b.walk.o2 > 90, 'walking uses oxygen', b.walk.dist + ' m walked, ' + b.walk.o2.toFixed(1) + ' % left');
    ok(b.walk.mateMoved > 20 && b.walk.mates, 'the companion replays its route alongside', Math.round(b.walk.mateMoved) + ' m');
    ok(/oxygen/.test(b.rt || '') && /MODELLED/.test(b.rt || ''), 'route cards show the walk budget', b.rt);
    ok(/Clearest 60°/.test(b.season) && /MY\d+/.test(b.season), 'the season planner names the clearest season and its dates', b.season.slice(0, 90));
    ok(b.slopeVar, 'route stops can be coloured by slope along the drive');

    /* ============================================================ the hover panel and its setting */
    console.log('Hover information');
    const mouseAt = async (dx) => {                         // a real mouse move over the map, through the browser's input
      const r = await run(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + dx, y: r.y + 40, pointerType: 'mouse' }, S);
      await sleep(350);
      return run(() => { const h = document.getElementById('hover-read'); return { shown: !h.hidden && h.offsetWidth > 0, title: (h.querySelector('h4') || {}).textContent || '' }; });
    };
    await run(() => { Marswalk.setFollow(false); document.getElementById('mode-manual').click(); MW.settings.set('move', 'hybrid'); return true; });
    const hDefault = await run(() => ({ setting: MW.settings.get('hoverInfo'), box: document.getElementById('set-hover').checked }));
    ok(hDefault.setting === true && hDefault.box === true, '"Show hover information" is on by default');
    const hOn = await mouseAt(-60);
    ok(hOn.shown && /Tap to walk here/.test(hOn.title), 'on: the panel follows the mouse, as before', hOn.title);
    await run(() => { const i = document.getElementById('set-hover'); i.checked = false; i.dispatchEvent(new Event('change')); return true; });
    const hNow = await run(() => document.getElementById('hover-read').hidden);
    const hOff = await mouseAt(60);
    ok(hNow && !hOff.shown, 'off: the panel hides at once and stays hidden as the mouse moves');
    const walkOff = await run(async () => {
      const s = Marswalk._state, x0 = s.x, y0 = s.y, ll = MW.geo.toLL(s.x + 40, s.y + 30);
      Marswalk._map.closePopup(); Marswalk._map.setView(MW.geo.toLL(s.x, s.y), 17, { animate: false });   // close in, so the tap is not read as a tap on the trail
      Marswalk._map.fire('click', { latlng: L.latLng(ll[0], ll[1]) });
      await new Promise(r => setTimeout(r, 2500));
      return { moved: Math.hypot(s.x - x0, s.y - y0), readout: document.getElementById('r-dist').textContent, z: document.getElementById('r-z').textContent,
               popup: !!document.querySelector('.leaflet-popup') };
    });
    ok(walkOff.moved > 5 && /\d/.test(walkOff.readout) && /\d/.test(walkOff.z), 'off: a tap still walks the pointer and the readouts still update', Math.round(walkOff.moved) + ' m; ' + walkOff.readout);
    await open(base + 'index.html', () => !!(window.MW && MW.settings && Marswalk));
    const hReload = await run(() => ({ setting: MW.settings.get('hoverInfo'), box: document.getElementById('set-hover').checked }));
    ok(hReload.setting === false && hReload.box === false, 'off is remembered after a refresh');
    await run(() => { Marswalk.setFollow(false); document.getElementById('mode-manual').click(); return true; });
    const hOff2 = await mouseAt(-30);
    ok(!hOff2.shown, 'and the panel stays hidden after the refresh');
    await run(() => { const i = document.getElementById('set-hover'); i.checked = true; i.dispatchEvent(new Event('change')); return true; });
    const hBack = await mouseAt(30);
    ok(hBack.shown, 'on again: the panel comes back');
    await open(base + 'index.html', () => !!(window.MW && MW.settings && Marswalk));
    ok(await run(() => MW.settings.get('hoverInfo') === true), 'on is remembered after a refresh too');

    /* ============================================================ the offline store */
    console.log('Offline');
    await open(base + 'index.html', () => !!(window.MW && MW.offline && navigator.serviceWorker && navigator.serviceWorker.controller));
    const off = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms));
      Marswalk._map.setView([-4.8, 137.384], 15); await W(5000);
      const tiles = (await (await caches.open('marswalk-tiles-v1')).keys()).length, shell = (await (await caches.open('marswalk-shell-v1')).keys()).length;
      const plan = MW.offline.plan();
      return { controlled: !!navigator.serviceWorker.controller, tiles, shell, plan: plan.urls.length, hirise: plan.urls.filter(u => /curiosity_hirise/.test(u)).length };
    });
    ok(off.controlled, 'the service worker controls the page');
    ok(off.shell > 25, 'the app files are kept', off.shell + ' files');
    ok(off.tiles > 0, 'map tiles that were viewed are kept', off.tiles + ' tiles');
    ok(off.plan > 100 && off.plan <= 6000 && off.hirise > 20, '"Save the walk area" plans a bounded set of tiles, HiRISE near the walk', off.plan + ' tiles, ' + off.hirise + ' HiRISE');
    await new Promise(r => srv.close(r)); if (srv.closeAllConnections) srv.closeAllConnections();
    bad.length = 0;
    const back = await open(base + 'index.html', () => !!(window.MW && MW.places && Marswalk && document.getElementById('pl-list').children.length));
    ok(back, 'with the server stopped, the page still opens from the offline store');
    const offTiles = back ? await run(async () => { await new Promise(r => setTimeout(r, 2500)); return [...document.querySelectorAll('#map canvas')].length; }) : 0;
    ok(offTiles > 0, 'and the map draws', offTiles + ' tile canvases');
    srv = await serve();                                   // a fresh server on a new port for the single file
    const base2 = 'http://127.0.0.1:' + srv.address().port + '/';
    bad.length = 0; errors.length = 0;

    /* ============================================================ marswalk.html, the single file */
    console.log('The single file');
    const one = await open(base2 + 'marswalk.html', () => !!(window.MW && MW.dust && MW.dust.pack && MW.dustUI.state.my && MW.placesUI));
    ok(one, 'marswalk.html loads with everything inside it');
    const oneR = await run(() => ({ local: performance.getEntriesByType('resource').filter(e => e.name.startsWith(location.origin) && !/dust-baselines|sw\.js/.test(e.name)).map(e => e.name), places: document.querySelectorAll('#pl-list summary').length }));
    ok(oneR.local.length === 0 && oneR.places >= 5, 'and asks for no other file of its own (dust-baselines.js is optional)', oneR.local.join(', ') || undefined);
  } catch (e) { ok(false, 'the checks ran to the end', e.message); }

  console.log('Errors');
  const realErrors = errors.filter(e => !/ServiceWorker|service worker/i.test(e));
  ok(!bad.length, 'no file the page asked for was missing', bad.slice(0, 5).join('; ') || undefined);
  ok(!realErrors.length, 'no script errors', realErrors.slice(0, 5).join('; ') || undefined);
  console.log(`\n${passed} passed, ${failed} failed`);
  c.close(); br.kill(); srv.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 800);
})().catch(e => { console.error(e); process.exit(2); });
