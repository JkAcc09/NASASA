/* page_test.js — opens the real page in headless Chrome or Edge and checks that it works end to end.
 * Run:  node page_test.js                      (Node 22 or later; no packages; Chrome or Edge installed)
 *       CHROME=/path/to/chrome node page_test.js   to choose the browser
 *
 * It serves this folder on a free local port, drives the browser through the DevTools protocol, and fails on any
 * missing file, script error or broken feature: the page fitting the window, the readout tabs, the mission status,
 * the right-click menu (real mouse buttons and a long press), the tabs and their keys, the (i) pop-ups, going to places and
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

    /* ============================================================ v1.6.2: no page scroll, readout tabs, mission status, right-click menu */
    console.log('Layout and the right-click menu');
    const sc = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), out = {};
      for (const t of ['menu', 'nav', 'overlay', 'dust', 'time']) { Marswalk.openTab(t); await W(250); out[t] = document.documentElement.scrollHeight - innerHeight; }
      Marswalk.openTab('menu'); return out;
    });
    ok(Object.values(sc).every(v => v <= 0), 'the page never scrolls past the window, whichever tab is open', JSON.stringify(sc));

    const tb = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const shown = () => [...document.querySelectorAll('#strip > dl')].filter(d => getComputedStyle(d).display !== 'none').map(d => d.id);
      R.layout = MW.settings.get('roLayout'); R.tabs = [...document.querySelectorAll('#ro-tabs button')].map(b => b.textContent.trim());
      const sr = $('strip').getBoundingClientRect(), mr = $('map').getBoundingClientRect(); R.right = sr.left >= mr.right - 2 && sr.width < 400;
      R.start = shown();
      document.querySelector('[data-ro-tab="env"]').click(); R.env = shown();
      document.querySelector('[data-ro-tab="budget-ro"]').click(); await W(1200); R.budget = shown(); R.o2 = $('e-o2').textContent;
      MW.settings.set('readouts', Object.assign({}, MW.settings.get('readouts'), { o2: false, batt: false, turn: false })); await W(100);
      R.budgetGone = document.querySelector('[data-ro-tab="budget-ro"]').hidden; R.after = shown();
      MW.settings.set('readouts', Object.assign({}, MW.settings.get('readouts'), { o2: true, batt: true, turn: true }));
      document.querySelector('[data-ro-tab="budget-ro"]').click();
      MW.settings.set('roLayout', 'focus'); await W(300); R.focus = { all: shown().length, tabs: getComputedStyle($('ro-tabs')).display };
      MW.settings.set('roLayout', 'side'); await W(200);
      return R;
    });
    ok(tb.layout === 'side' && tb.right && tb.tabs.join() === 'Position,Conditions,Budget', 'the readouts sit in a narrow column at the right, in three tabs', tb.tabs.join(', '));
    ok(tb.start.length === 1 && tb.env.join() === 'env' && tb.budget.join() === 'budget-ro' && /%/.test(tb.o2), 'each tab shows its own readouts, one group at a time', tb.start + ' / ' + tb.env + ' / ' + tb.budget + ', ' + tb.o2);
    ok(tb.budgetGone && tb.after.length === 1, 'a tab with nothing ticked in Settings is left out');
    ok(tb.focus.all === 3 && tb.focus.tabs === 'none', '"Numbers first" still shows every group at once, without tabs');
    await open(base + 'index.html', () => !!(window.MW && MW.hud && Marswalk.budget()));
    ok(await run(() => document.querySelector('[data-ro-tab="budget-ro"]').getAttribute('aria-selected') === 'true'), 'the chosen readout tab is remembered after a refresh');

    const ms = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const vis = () => [...document.querySelectorAll('.mchip')].every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.bottom <= innerHeight && r.right <= innerWidth; });
      R.vis = {};
      for (const t of ['menu', 'nav', 'overlay', 'dust', 'time']) { Marswalk.openTab(t); await W(150); R.vis[t] = vis(); }
      document.querySelector('#tabs [data-tab-btn="time"]').click(); await W(300); R.vis.folded = vis(); document.querySelector('#tabs [data-tab-btn="menu"]').click();
      const mp = $('map').getBoundingClientRect(), c = $('m-risk').getBoundingClientRect(); R.corner = c.right > mp.right - 40 && c.bottom > mp.bottom - 70;
      R.values = [...document.querySelectorAll('.mchip b')].map(b => b.textContent);
      Marswalk._state.budget.o2Used = 0.50; await W(1300); R.warn = $('m-o2').className;
      Marswalk._state.budget.o2Used = 0.66; await W(1300); R.danger = $('m-o2').className;
      Marswalk.clearTrail(); await W(1300); R.reset = $('m-o2').className;
      $('m-risk').click(); R.explain = !$('info-pop').hidden && $('info-pop').querySelector('h4').textContent; document.body.click();
      R.tip = $('m-o2').getAttribute('data-tip');
      return R;
    });
    ok(Object.values(ms.vis).every(Boolean), 'oxygen, battery and risk stay on screen in every tab, and with the panel folded', JSON.stringify(ms.vis));
    ok(ms.corner && /%$/.test(ms.values[0]) && /%$/.test(ms.values[1]) && /^\d+$/.test(ms.values[2]), 'they sit at the bottom right of the map with their values', ms.values.join(' '));
    ok(/warn/.test(ms.warn) && /danger/.test(ms.danger) && /ok/.test(ms.reset), 'they turn amber at 30 % and red at the 15 % reserve', ms.warn + ' / ' + ms.danger + ' / ' + ms.reset);
    ok(/Live safety/i.test(ms.explain || '') && /Oxygen left/.test(ms.tip), 'a press explains them; the label names the value', ms.explain + '; ' + ms.tip);

    /* the right-click menu, with real mouse buttons */
    await run(() => { window.__ctx = []; window.addEventListener('contextmenu', e => window.__ctx.push({ prevented: e.defaultPrevented, map: !!e.target.closest('#map') })); Marswalk.setFollow(false); Marswalk._map.setView(MW.geo.toLL(Marswalk._state.x, Marswalk._state.y), 16, { animate: false }); return true; });
    const rclick = async (x, y) => {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, S);
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }, S);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 }, S);
      await sleep(300);
    };
    const geom = await run(() => { const m = document.getElementById('map').getBoundingClientRect(), k = document.getElementById('collar').getBoundingClientRect(); return { mx: m.left + m.width * 0.4, my: m.top + m.height * 0.5, ex: m.right - 6, ey: m.bottom - 90, bx: m.left + m.width * 0.5, by: m.bottom - 6, cx: k.left + 60, cy: k.top + 120 }; });   // ex, ey: the right edge above the status symbols; bx, by: the bottom edge
    await rclick(geom.mx, geom.my);
    const c1 = await run(() => { const m = document.getElementById('ctx'), r = m.getBoundingClientRect(); return { open: !m.hidden, items: [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, last: window.__ctx[window.__ctx.length - 1] }; });
    ok(c1.open && c1.items.join('|') === 'Reveal information|Travel to location|Mark as landmark', 'right-clicking the map opens the menu with its three choices', c1.items.join(', '));
    ok(c1.last && c1.last.map && c1.last.prevented, 'the browser’s own menu is held back on the map');
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, S);
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, S);
    await sleep(150);
    ok(await run(() => document.getElementById('ctx').hidden), 'Escape closes it');
    await rclick(geom.cx, geom.cy);
    const c2 = await run(() => ({ open: !document.getElementById('ctx').hidden, last: window.__ctx[window.__ctx.length - 1] }));
    ok(!c2.open && c2.last && !c2.last.map && !c2.last.prevented, 'outside the map, right-click is left to the browser');
    const inView = () => run(() => { const r = document.getElementById('ctx').getBoundingClientRect(); return { open: !document.getElementById('ctx').hidden, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
    await rclick(geom.ex, geom.ey); const c3 = await inView();
    await rclick(geom.bx, geom.by); const c3b = await inView();
    ok(c3.open && c3.inView && c3b.open && c3b.inView && c1.inView, 'the menu stays on screen, even at the right and bottom edges of the map');
    const c4 = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), m = document.getElementById('ctx'), R = {};
      m.querySelector('[data-ctx="info"]').click(); await W(300);
      const p = document.querySelector('.spot-pop'); R.info = p ? p.innerText : ''; R.closed = m.hidden;
      Marswalk._map.closePopup();
      document.getElementById('mode-replay').click(); document.getElementById('btn-play').click(); await W(1500); document.getElementById('btn-play').click();
      R.dist = Math.round(Marswalk._state.dist);
      const ll = MW.geo.toLL(Marswalk._state.x + 300, Marswalk._state.y + 200); MW.ctxMenu.open(ll[0], ll[1]);
      m.querySelector('[data-ctx="go"]').click(); await W(100);
      R.ask = (m.querySelector('.ctx-ask') || {}).textContent || ''; R.stillThere = Math.round(Marswalk._state.dist) === R.dist;
      m.querySelector('[data-ctx="go-sure"]').click(); await W(400);
      const h = Marswalk.here(); R.moved = MW.geo.haversine(h, { lat: ll[0], lon: ll[1] }); R.newTrail = Marswalk._state.dist === 0; R.msg = (document.querySelector('.spot-pop') || {}).innerText || '';
      Marswalk._map.closePopup();
      const l2 = MW.geo.toLL(Marswalk._state.x - 150, Marswalk._state.y + 90); MW.ctxMenu.open(l2[0], l2[1]);
      m.querySelector('[data-ctx="mark"]').click(); await W(300);
      R.form = !document.getElementById('mk-form').hidden;
      document.getElementById('mk-name').value = 'Ridge marker'; document.getElementById('mk-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await W(200);
      R.saved = MW.markers.list().some(x => x.name === 'Ridge marker' && Math.abs(x.lat - l2[0]) < 1e-6);
      MW.markers.list().filter(x => x.name === 'Ridge marker').forEach(x => MW.markers.remove(x.id));
      Marswalk.openTab('menu');
      R.noHover = !document.getElementById('hover-read') && !document.getElementById('set-hover');
      return R;
    });
    ok(/latitude, longitude/.test(c4.info) && /height/.test(c4.info) && /slope/.test(c4.info) && /dust activity/.test(c4.info) && c4.closed, 'Reveal information shows coordinates, height, slope, dust and more', c4.info.split('\n').slice(0, 3).join(' | '));
    ok(c4.dist > 5 && /starts a new trail/.test(c4.ask) && c4.stillThere, 'Travel to location asks before leaving an unsaved trail', c4.dist + ' m walked');
    ok(c4.moved < 1 && c4.newTrail && /walker is at|New site|Back at Gale/.test(c4.msg), 'and then moves the walker there with a fresh trail', c4.msg.slice(0, 70));
    ok(c4.form && c4.saved, 'Mark as landmark opens the marker form at that spot and saves it');
    ok(c4.noHover, 'the mouse-following panel and its setting are gone');
    const sw = await run(() => { const s = Marswalk._state; document.getElementById('mode-manual').click(); Marswalk._map.setView(MW.geo.toLL(s.x, s.y), 17, { animate: false }); return { x: s.x, y: s.y }; });
    await rclick(geom.mx, geom.my);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geom.mx + 80, y: geom.my + 40, button: 'left', buttons: 1, clickCount: 1 }, S);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geom.mx + 80, y: geom.my + 40, button: 'left', buttons: 0, clickCount: 1 }, S);
    await sleep(1500);
    const sw2 = await run(() => ({ closed: document.getElementById('ctx').hidden, x: Marswalk._state.x, y: Marswalk._state.y }));
    ok(sw2.closed && Math.hypot(sw2.x - sw.x, sw2.y - sw.y) < 0.5, 'clicking elsewhere closes the menu without walking the pointer there');
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, S);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geom.mx - 60, y: geom.my - 40 }] }, S);
    await sleep(1100);
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, S);
    await sleep(400);
    const lp = await run(() => !document.getElementById('ctx').hidden);
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false }, S);
    await run(() => { MW.ctxMenu.close(); return true; });
    ok(lp, 'a long press on a touch screen opens the menu');

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
