/* page_test.js — opens the real page in headless Chrome or Edge and checks that it works end to end.
 * Run:  node page_test.js                      (Node 22 or later; no packages; Chrome or Edge installed)
 *       CHROME=/path/to/chrome node page_test.js   to choose the browser
 *
 * It serves this folder on a free local port, drives the browser through the DevTools protocol, and fails on any
 * missing file, script error or broken feature: the page fitting the window, the readout tabs, the mission status,
 * the right-click menu (real mouse buttons and a long press), pictures of places (live NASA Navcam and orbital imagery),
 * the user's oxygen model, marker photos, the tabs and their keys, the (i) pop-ups, going to places and
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
  const errors = [], bad = [], urls = {};
  c.on(m => {
    if (m.sessionId !== S) return;
    if (m.method === 'Network.requestWillBeSent') urls[m.params.requestId] = m.params.request.url;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description.split('\n')[0] : m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith(base) && m.params.response.status >= 400) bad.push(m.params.response.status + ' ' + m.params.response.url.slice(base.length));
    if (m.method === 'Network.loadingFailed' && m.params.type !== 'Ping' && !m.params.canceled && (m.params.errorText || '').indexOf('ABORTED') < 0) bad.push('failed ' + (urls[m.params.requestId] || m.params.requestId).slice(0, 120) + ' ' + m.params.errorText);
  });
  await c.send('Runtime.enable', {}, S); await c.send('Network.enable', {}, S); await c.send('Page.enable', {}, S);
  const run = async (fn, arg) => {
    const r = await c.send('Runtime.evaluate', { expression: '(' + fn + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', awaitPromise: true, returnByValue: true }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (url, ready) => {
    await c.send('Page.navigate', { url }, S);
    for (let i = 0; i < 120; i++) { await sleep(250); try { if (await run(ready)) { await run(() => { if (window.MW && MW.intro) MW.intro.skip(); return true; }); return true; } } catch (e) {} }   // 1.8: past the start screen
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
      R.layout = MW.settings.get('roLayout'); R.tabs = [...document.querySelectorAll('#ro-tabs button')].map(b => b.getAttribute('data-tip'));
      const sr = $('strip').getBoundingClientRect(); R.right = sr.right >= innerWidth - 24 && sr.left > innerWidth / 2 && sr.width < 400;   // 1.7: a panel floating at the right, over the map
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
    ok(await run(() => document.querySelector('[data-ro-tab="budget-ro"]').getAttribute('aria-pressed') === 'true'), 'the chosen readout tab is remembered after a refresh');

    const ms = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const vis = () => [...document.querySelectorAll('.mchip')].every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.bottom <= innerHeight && r.right <= innerWidth; });
      R.vis = {};
      for (const t of ['menu', 'nav', 'overlay', 'dust', 'time']) { Marswalk.openTab(t); await W(150); R.vis[t] = vis(); }
      document.querySelector('#tabs [data-tab-btn="time"]').click(); await W(300); R.vis.folded = vis(); document.querySelector('#tabs [data-tab-btn="menu"]').click();
      const rtb = $('ro-tabs').getBoundingClientRect(), c = $('m-risk').getBoundingClientRect(); R.corner = c.right > rtb.left - 60 && c.right <= rtb.left && c.bottom > innerHeight - 80;   // 1.7: the corner of the open map, beside the readouts
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
    ok(c1.open && c1.items.join('|') === 'Reveal information|View location image|Find routes here|Teleport here|Mark as landmark', 'right-clicking the map opens the menu with its five choices', c1.items.join(', '));
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
    ok(c4.dist > 5 && /starts a new trail/.test(c4.ask) && c4.stillThere, 'Teleport here asks before leaving an unsaved trail', c4.dist + ' m walked');
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

    /* ============================================================ v1.6.3: map-edge tabs, pictures of places, oxygen model, marker photos */
    console.log('Pictures, oxygen model and marker photos');
    const rt = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const t = $('ro-tabs').getBoundingClientRect(), sr = $('strip').getBoundingClientRect(), b = $('ro-tabs').querySelector('button').getBoundingClientRect();
      R.edge = Math.abs(t.right + 8 - sr.left) < 4 && Math.abs(t.top - sr.top) < 4; R.square = Math.round(b.width) + 'x' + Math.round(b.height);   // 1.7: a rail on the readouts' left edge
      R.inStage = $('ro-tabs').parentNode.id === 'stage';
      const open = document.querySelector('#ro-tabs [aria-pressed="true"]'), w0 = innerWidth - MW.ui.fitPad(0).paddingBottomRight[0];   // 1.7: the open part of the map
      open.click(); await W(400);
      R.folded = getComputedStyle($('strip')).display === 'none' && innerWidth - MW.ui.fitPad(0).paddingBottomRight[0] > w0 + 100 && !document.querySelector('#ro-tabs [aria-pressed="true"]');
      R.foldedKey = localStorage.getItem('marswalk.roTab');
      document.querySelector('#ro-tabs [data-ro-tab="env"]').click(); await W(400);
      R.reopened = getComputedStyle($('strip')).display !== 'none' && getComputedStyle($('env')).display !== 'none';
      document.querySelector('#ro-tabs [data-ro-tab="env"]').click(); await W(300);
      return R;
    });
    ok(rt.inStage && rt.edge && /^4\dx4\d$/.test(rt.square), 'Position, Conditions and Budget are square tabs on the edge of the readouts', rt.square);
    const ic = await run(() => { const sig = b => b.querySelector('svg') ? b.querySelector('svg').innerHTML : ''; const ro = [...document.querySelectorAll('#ro-tabs button')].map(sig);
      const others = [...document.querySelectorAll('#tabs button, #bar button, .mchip')].map(sig); return { distinct: new Set(ro).size === 3, unique: ro.every(x => x && others.indexOf(x) < 0) }; });
    ok(ic.distinct && ic.unique, 'Position, Conditions and Budget have their own icons, used nowhere else on the bar or the rails');
    ok(rt.folded && rt.foldedKey === 'none' && rt.reopened, 'pressing the open tab folds the panel and gives the map the width; another tab opens it');
    await open(base + 'index.html', () => !!(window.MW && MW.hud && MW.imagery && Marswalk.budget()));
    const rk = await run(() => ({ folded: document.body.classList.contains('ro-folded'), strip: getComputedStyle(document.getElementById('strip')).display }));
    ok(rk.folded && rk.strip === 'none', 'a folded panel stays folded after a refresh');

    /* ============================================================ v1.7: Mission Control */
    console.log('Mission Control look');
    const mc = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      document.querySelector('#ro-tabs [data-ro-tab="nav"]').click(); await W(300);
      const mp = $('map').getBoundingClientRect(), br = $('bar').getBoundingClientRect(), cl = $('collar').getBoundingClientRect(), st = $('strip').getBoundingClientRect();
      R.fullBleed = mp.left <= 1 && mp.top <= 1 && mp.right >= innerWidth - 1 && mp.bottom >= innerHeight - 1;
      R.floating = br.top > 0 && cl.left > 0 && st.right < innerWidth && getComputedStyle($('collar')).position === 'absolute';
      const pad = MW.ui.fitPad(0); R.pad = pad.paddingTopLeft.concat(pad.paddingBottomRight).map(Math.round);
      R.padOk = Math.abs(pad.paddingTopLeft[0] - cl.right) < 3 && Math.abs(pad.paddingTopLeft[1] - br.bottom) < 3;
      R.popup = L.Popup.prototype.options.autoPanPaddingTopLeft.x > cl.right;
      const sc = $('scale').getBoundingClientRect(), pv = $('banner'); R.scaleClear = sc.left >= cl.right;
      R.mono = /JetBrains Mono/.test(getComputedStyle($('r-pos')).fontFamily);
      R.themes = [...document.querySelectorAll('#set-theme button')].map(b => b.textContent);
      MW.settings.set('theme', 'ember'); await W(50); R.ember = getComputedStyle(document.body).getPropertyValue('--me').trim();
      MW.settings.set('theme', 'console');
      Marswalk.openTab('nav'); document.querySelector('#tabs [data-tab-btn="nav"]').click(); await W(300);   // fold the column: the open map grows
      R.folded = MW.ui.fitPad(0).paddingTopLeft[0] < pad.paddingTopLeft[0] - 200; document.querySelector('#tabs [data-tab-btn="menu"]').click(); await W(200);
      MW.settings.open(); document.querySelector('#settings [data-goto="set-move-h"]').click(); await W(900);
      R.navCur = document.querySelector('#settings .set-nav [aria-current="true"]').getAttribute('data-goto');
      const mv = $('set-move-h').getBoundingClientRect(); R.navScrolled = mv.top < innerHeight && mv.top > 0; MW.settings.close();
      return R;
    });
    ok(mc.fullBleed && mc.floating, 'the map fills the window and the bar, column and readouts float over it');
    ok(mc.padOk && mc.popup && mc.scaleClear, 'routes, places and popups are fitted into the open part of the map, clear of the panels', mc.pad.join(', '));
    ok(mc.folded, 'folding the column gives the open map its width');
    ok(mc.mono, 'numbers are set in a monospace face');
    ok(mc.themes.join() === 'Console,Graphite,Ember,Aurora,Nebula,Night red,Daylight,Direct sun' && mc.ember === '#FFB547', 'Settings offers eight colour themes, and they apply', mc.themes.join(', '));
    ok(mc.navCur === 'set-move-h' && mc.navScrolled, 'the section list in Settings scrolls to the section pressed and marks it');
    await run(() => { localStorage.setItem('marswalk.settings.v1', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('marswalk.settings.v1') || '{}'), { theme: 'sand' }))); return true; });
    await open(base + 'index.html', () => !!(window.MW && MW.hud && Marswalk.budget()));
    ok(await run(() => MW.settings.get('theme') === 'ember' && document.body.getAttribute('data-theme') === 'ember'), 'a theme from before 1.7 opens as its console counterpart (Sand as Ember)');
    await run(() => { MW.settings.set('theme', 'console'); return true; });

    /* ============================================================ v1.8: start screen, tutorial, routes from places and the map, sample trails */
    console.log('Start screen, tutorial, route links and sample trails');
    await run(() => { localStorage.removeItem('marswalk.tour.v1'); return true; });
    await c.send('Page.navigate', { url: base + 'index.html' }, S);
    let st0 = null;
    for (let i = 0; i < 60 && !(st0 && st0.shown && st0.z >= 3000); i++) { await sleep(100); try { st0 = await run(() => { const i = document.getElementById('intro'); return i ? { shown: !i.hidden && getComputedStyle(i).display !== 'none', z: +getComputedStyle(i).zIndex } : null; }); } catch (e) {} }   // the old page can answer first
    ok(st0 && st0.shown && st0.z >= 3000, 'the start screen shows over everything while the page loads', JSON.stringify(st0));
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await run(() => !!(window.MW && MW.intro && MW.intro.ready))) break; } catch (e) {} }
    await sleep(1500);
    const gb = await run(() => {
      const cv = document.getElementById('intro-globe'), webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })();
      if (!webgl) return { webgl };
      const v = MW.globe.view;
      return new Promise(res => setTimeout(() => res({ webgl, on: MW.intro.globe && MW.globe.running, shown: getComputedStyle(cv).opacity === '1', worker: v.worker, frames: v.frames || 0, fps: v.fps, colour: v.colour, sat: document.getElementById('art-sat').naturalWidth > 0 }), 2400));
    });
    if (gb.webgl) {
      ok(gb.on && gb.shown && gb.colour && gb.sat, 'the start screen draws Mars, Phobos and the Mars Reconnaissance Orbiter from NASA\u2019s pictures');
      ok(gb.worker && gb.frames > 10, 'the scene is drawn in a worker of its own, so the page loading beside it cannot stall it', gb.frames + ' frames, ' + gb.fps + ' fps in this browser');
    } else console.log('  skip  the Mars globe: this browser has no WebGL; the painted planet shows instead');
    const st1 = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      R.go = getComputedStyle($('intro-go')).opacity;
      $('intro').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await W(2200);   // 1.10: the fade and slide take about 1.4 s
      R.gone = $('intro').hidden; R.ask = !$('tour-ask').hidden;
      $('tour-no').click(); await W(100); R.stored = localStorage.getItem('marswalk.tour.v1'); R.askGone = $('tour-ask').hidden;
      R.btn = !!$('btn-tour') && $('btn-tour').closest('#bar') !== null;
      return R;
    });
    ok(+st1.go > 0.5 && st1.gone, 'when ready it says "Tap anywhere to begin", and a tap enters the app: the start screen fades and the panels slide in');
    ok(await run(() => !MW.globe.running && !document.body.classList.contains('arriving')), 'afterwards the globe stops drawing and the panels are all in view');
    ok(st1.ask && st1.askGone && st1.stored === 'declined', 'a first visit is asked whether it wants the tour, and the answer is kept', st1.stored);
    await c.send('Page.navigate', { url: base + 'index.html' }, S);
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await run(() => !!(window.MW && MW.intro && MW.intro.ready))) break; } catch (e) {} }
    const st2 = await run(async () => { const W = ms => new Promise(r => setTimeout(r, ms)); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await W(400); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await W(300);   // a second key skips the dive
      return { gone: document.getElementById('intro').hidden, ask: !document.getElementById('tour-ask').hidden }; });
    ok(st2.gone && !st2.ask, 'a key enters too, and a visitor who has answered is not asked again');
    const tr = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = { inView: [], tabs: {} };
      $('btn-tour').click(); await W(200);
      R.active = MW.intro.tour.active; R.n = MW.intro.tour.steps.length;
      for (let i = 0; i < R.n; i++) {
        await W(250);
        const c = $('tour-card').getBoundingClientRect(); R.inView.push(c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight);
        if (/Find a route/.test($('tour-title').textContent)) R.tabs.route = !$('nav-route').hidden;
        if (/Go to a place/.test($('tour-title').textContent)) R.tabs.places = !$('places-sec').hidden;
        const before = window.Marswalk._state.x; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); R.keysHeld = window.Marswalk._state.x === before;
        $('tour-next').click();
      }
      await W(100); R.ended = !MW.intro.tour.active && $('tour').hidden;
      $('btn-tour').click(); await W(100); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await W(100); R.escaped = !MW.intro.tour.active;
      return R;
    });
    ok(tr.active && tr.n >= 10 && tr.inView.every(Boolean), 'the Tutorial button starts a guided tour, and every card stays on screen', tr.n + ' steps');
    ok(tr.tabs.places && tr.tabs.route, 'the tour opens the panel each step talks about');
    ok(tr.ended && tr.escaped && tr.keysHeld, 'Finish and Escape end it, and keys do not walk the pointer during it');
    const lk = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      Marswalk.openTab('menu'); const q = $('pl-q'); q.value = 'Bradbury'; q.dispatchEvent(new Event('input')); await W(200);
      const b = document.querySelector('#pl-list [data-pl="route"]'); R.btn = !!b && /routes/i.test(b.getAttribute('aria-label'));
      R.teleport = (document.querySelector('#pl-list [data-pl="walk"]') || {}).getAttribute('data-tip');
      b.click(); await W(400);
      R.navOpen = !$('nav-route').hidden; R.q = $('rt-q').value; R.plan = MW.navUI.plan && MW.navUI.plan.to.name;
      MW.navUI.clear(); q.value = ''; q.dispatchEvent(new Event('input'));
      return R;
    });
    ok(lk.btn && lk.navOpen && /Bradbury/.test(lk.q) && /Bradbury/.test(lk.plan || ''), 'Go to a place: the route symbol opens the route-finder with the place as the destination', lk.q);
    ok(/Teleport/.test(lk.teleport || ''), 'and the walker button there is now Teleport', lk.teleport);
    const g2 = await run(() => { const m = document.getElementById('map').getBoundingClientRect(); return { x: m.left + m.width * 0.55, y: m.top + m.height * 0.55 }; });
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g2.x, y: g2.y, button: 'right', buttons: 2, clickCount: 1 }, S);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g2.x, y: g2.y, button: 'right', buttons: 0, clickCount: 1 }, S);
    await sleep(300);
    const cr = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), m = document.getElementById('ctx'), R = {};
      R.items = [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent);
      m.querySelector('[data-ctx="route"]').click(); await W(400);
      R.navOpen = !document.getElementById('nav-route').hidden; R.plan = MW.navUI.plan && MW.navUI.plan.to.name; R.ok = MW.navUI.plan && MW.navUI.plan.result.ok;
      MW.navUI.clear(); Marswalk.openTab('menu');
      return R;
    });
    ok(cr.items.indexOf('Find routes here') >= 0 && cr.items.indexOf('Teleport here') >= 0 && cr.items.indexOf('Travel to location') < 0, 'the right-click menu has Find routes here, and Travel is now Teleport here', cr.items.join(', '));
    ok(cr.navOpen && /^Point at/.test(cr.plan || '') && cr.ok, 'Find routes here opens the route-finder with that spot, and finds routes to it', cr.plan);
    const sm = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const S = MW.SAMPLE_TRAILS || []; R.n = S.length; R.valid = S.every(r => !!MW.store.fromText(JSON.stringify(r)));
      R.rows = document.querySelectorAll('#saved li.sample').length;
      const files = ['out-back', 'ridge-loop', 'figure-eight', 'rover-grid', 'hazard-detour'];
      R.files = (await Promise.all(files.map(f => fetch('sample-trails/' + f + '.marswalk.json').then(r => r.text()).then(t => !!MW.store.fromText(t)).catch(() => false)))).filter(Boolean).length;
      R.howto = (await fetch('sample-trails/HOW-TO-USE.txt').then(r => r.ok ? r.text() : '')).indexOf('Import a trail file') >= 0;
      const before = MW.store.list().length;
      document.querySelector('#saved [data-act="keep"][data-id="s-ridge-loop"]').click(); await W(100);
      R.kept = MW.store.list().length === before + 1 && MW.store.list().some(r => r.name === 'Sample · Boxwork ridge loop');
      document.querySelector('#saved [data-act="replay"][data-id="s-figure-eight"]').click(); await W(200);
      const st = Marswalk._state, p0 = S.filter(r => r.id === 's-figure-eight')[0].points[0], h = Marswalk.here();
      R.replayAtStart = Math.abs(h.lat - p0[0]) < 1e-4 && Math.abs(h.lon - p0[1]) < 1e-4 && st.mode === 'replay';
      document.querySelector('#saved [data-act="replay"][data-id="curiosity"]').click(); await W(100);
      return R;
    });
    ok(sm.n === 5 && sm.valid && sm.rows === 5, 'five sample trails are listed, each a valid trail record', sm.n + ' samples');
    ok(sm.files === 5 && sm.howto, 'the sample trail files beside the page import cleanly, with a how-to', sm.files + ' files');
    ok(sm.kept && sm.replayAtStart, 'a sample can be added to your trails, and replayed from its start');

    /* ============================================================ v1.9: undo and redo a teleport */
    const tp = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {}, A = Marswalk, S = A._state;
      $('speed').value = '120'; $('speed').dispatchEvent(new Event('change'));
      $('btn-play').click(); await W(1500); $('btn-play').click(); await W(100);
      const h0 = A.here(), d0 = S.dist, n0 = A._trail.pts.length;
      R.startDisabled = $('tp-undo').disabled && $('tp-redo').disabled;
      MW.placesUI.walkTo({ lat: -4.70, lon: 137.42 }, true); await W(200);
      R.moved = Math.abs(A.here().lat - -4.70) < 1e-4 && S.dist === 0 && !$('tp-undo').disabled;
      $('tp-undo').click(); await W(200);
      const h1 = A.here(); R.back = Math.abs(h1.lat - h0.lat) < 1e-6 && Math.abs(h1.lon - h0.lon) < 1e-6 && S.dist === d0 && A._trail.pts.length === n0 && d0 > 5;
      R.redoOn = !$('tp-redo').disabled; R.note = !$('tp-note').hidden && /Back where/.test($('tp-note').textContent);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); await W(200);
      R.redone = Math.abs(A.here().lat - -4.70) < 1e-4;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await W(200);
      R.keysBack = Math.abs(A.here().lat - h0.lat) < 1e-6;
      MW.placesUI.walkTo({ lat: 18.38, lon: 77.58, name: 'Jezero crater' }, true); await W(300);
      R.newSite = !MW.geo.SITE.gale;
      A.undoTeleport(); await W(300);
      R.siteBack = MW.geo.SITE.gale && Math.abs(A.here().lat - h0.lat) < 1e-6 && S.dist === d0;
      R.redoCleared = A.teleports.forward === 1;          // the Jezero teleport waits in Redo; the earlier one was replaced by it
      return R;
    });
    ok(tp.startDisabled && tp.moved, 'Undo and Redo teleport sit in the top bar, off until there is a teleport');
    ok(tp.back && tp.redoOn && tp.note, 'Undo puts the walker back with its trail, distance and all, and says so');
    ok(tp.redone && tp.keysBack, 'Redo teleports again; Ctrl+Y and Ctrl+Z do the same');
    ok(tp.newSite && tp.siteBack && tp.redoCleared, 'undoing a teleport to another site brings back the Gale base too');
    await run(() => { document.querySelector('#ro-tabs [data-ro-tab="nav"]').click(); return true; });

    const im = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {}, G = MW.geo;
      const wait = async () => { for (let i = 0; i < 60 && $('pov').classList.contains('loading'); i++) await W(250); };
      MW.imagery.follow(); await wait();
      R.here = { kind: $('pov').getAttribute('data-kind'), title: $('pov-title').textContent, meta: $('pov-meta').innerText, src: $('pov-img').src, link: $('pov-link').href };
      const r1 = await MW.imagery.best(G.WP[60].lat, G.WP[60].lon, { heading: 90 }), r2 = await MW.imagery.best(G.WP[60].lat, G.WP[60].lon, { heading: 270 });
      R.stop = { kind: r1.kind, date: r1.date, where: r1.where, differs: r1.src !== r2.src };
      MW.placesUI.walk('lm:Jezero crater', true); await W(300); MW.imagery.follow(); await wait();
      R.far = { kind: $('pov').getAttribute('data-kind'), title: $('pov-title').textContent, meta: $('pov-meta').innerText, where: $('pov-sub').textContent, img: $('pov-img').src.slice(0, 22) };
      const trek = MW.config.TREK; MW.config.TREK = 'https://127.0.0.1:9/nothing/';             // no tiles to be had: there must be no picture, not a wrong one
      const r3 = await MW.imagery.best(10.5, -150.25, {}); MW.config.TREK = trek;
      R.none = { kind: r3.kind, title: r3.title };
      MW.placesUI.walk('sol:4560:0', true); await W(300);
      return R;
    });
    /* NASA's raw-image service refuses browsers that call themselves HeadlessChrome (403), so here the panel may fall back to
       the frame stored with the route. Either is right, as long as it says which: a live frame gives its capture time, a stored
       one says its date was worked out from the sol. The user agent is not disguised to get past that refusal. */
    const live = /Taken \d{4}-\d\d-\d\d \d\d:\d\d UTC, sol \d+/.test(im.here.meta), stored = /worked out from the sol/.test(im.here.meta) && /could not be reached/.test(im.here.meta);
    ok(im.here.kind === 'rover' && /Navigation Camera/.test(im.here.meta) && (live || stored) && /msl-raw-images/.test(im.here.src), 'on Curiosity\u2019s drive the panel shows a NASA Navcam frame from that stop, with its source and date', (live ? 'live: ' : 'stored, NASA refused the headless browser: ') + im.here.meta.split('\n')[1]);
    if (/^Taken/.test(im.stop.date)) ok(/stop 61/.test(im.stop.where) && im.stop.differs, 'the frame is the one facing the walker\u2019s heading (east and west give different frames)', im.stop.date);
    else console.log('  skip  the frame facing the walker\u2019s heading: needs NASA\u2019s live image list, which refuses headless browsers');
    ok(im.far.kind === 'orbital' && /Seen from orbit/.test(im.far.title) && /Viking/.test(im.far.meta) && /1976 to 1980/.test(im.far.meta) && /18\.38/.test(im.far.where) && im.far.img === 'data:image/jpeg;base64', 'away from the drive it shows NASA orbital imagery of that spot, with source, dates and location', im.far.where);
    ok(im.none.kind === 'none' && im.none.title === 'No imagery available for this location.', 'with no imagery to be had it says so instead of showing another place');

    const ci = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), G = MW.geo, m = document.getElementById('ctx');
      const ll = G.toLL(Marswalk._state.x + 40, Marswalk._state.y - 30); MW.ctxMenu.open(ll[0], ll[1]);
      const items = [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent);
      m.querySelector('[data-ctx="image"]').click();
      for (let i = 0; i < 60 && !document.querySelector('.img-pop .locimg, .img-pop h3:not(:empty)'); i++) await W(200);
      for (let i = 0; i < 40 && /Looking for/.test((document.querySelector('.img-pop') || {}).innerText || ''); i++) await W(200);
      const p = document.querySelector('.img-pop'); const out = { items, text: p ? p.innerText : '', img: !!(p && p.querySelector('img')), w: p ? Math.round(p.getBoundingClientRect().width) : 0 };
      Marswalk._map.closePopup(); return out;
    });
    ok(ci.items.indexOf('View location image') >= 0 && ci.img && /NASA/.test(ci.text) && ci.w < 330, 'the right-click menu\u2019s View location image shows a small preview with its source', ci.text.split('\n')[0] + '; ' + ci.w + ' px wide');

    const ox = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      R.defaultsBefore = MW.config.BUDGET.astronaut.o2Kg;
      document.querySelector('#o2-kind [data-o2-kind="fixed"]').click();
      const set = (k, v) => { $('o2-fields').querySelector('[data-o2="' + k + '"]').value = v; };
      set('o2Kg', '1.2'); set('walkKgH', '5'); $('o2-name').value = 'Test suit';
      $('o2-save').click(); R.badMsg = $('o2-msg').textContent; R.badErr = $('o2-fields').querySelector('[data-o2-err="walkKgH"]').textContent; R.notSaved = MW.settings.get('o2Model') === null;
      set('walkKgH', '0.09'); set('restKgH', '0.04'); $('o2-save').click(); await W(1300);
      R.model = MW.budget.model(); R.status = $('o2-status').innerText; R.label = $('e-o2-l').textContent; R.chip = $('m-o2').getAttribute('data-tip');
      const b = MW.budget.read(MW.budget.fresh(), { kind: 'astronaut', back: 0, air: -40, moving: true });
      R.hours = b.o2Hours;                              // 1.2 kg at 0.09 kg/h
      R.defaultsAfter = MW.config.BUDGET.astronaut.o2Kg;
      return R;
    });
    ok(ox.notSaved && /Not saved/.test(ox.badMsg) && /Between 0\.005 and 1 kg\/h/.test(ox.badErr), 'a wrong value is refused, with the unit, and nothing is saved', ox.badErr);
    ok(ox.model && ox.model.model === 'fixed' && ox.model.o2Kg === 1.2 && /YOUR MODEL/.test(ox.status) && /your oxygen model/.test(ox.label) && /your oxygen model/.test(ox.chip), 'a saved oxygen model is used and marked as the user\u2019s', ox.label);
    ok(Math.abs(ox.hours - 1.2 / 0.09) < 0.05, 'the walk budget follows it: 1.2 kg at 0.09 kg/h lasts 13.3 h', ox.hours.toFixed(2) + ' h');
    ok(ox.defaultsBefore === 0.7 && ox.defaultsAfter === 0.7, 'the default assumptions are left as they were');
    await open(base + 'index.html', () => !!(window.MW && MW.o2Model && Marswalk.budget()));
    const ox2 = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      R.kept = MW.budget.model(); R.field = $('o2-fields').querySelector('[data-o2="walkKgH"]').value;
      $('o2-reset').click(); await W(1300); R.reset = MW.budget.model(); R.label = $('e-o2-l').textContent; R.status = $('o2-status').innerText;
      return R;
    });
    ok(ox2.kept && ox2.kept.walkKgH === 0.09 && ox2.field === '0.09', 'it is kept after a refresh and shown again for editing');
    ok(ox2.reset === null && !/your oxygen model/.test(ox2.label) && /DEFAULT/.test(ox2.status), '"Use the defaults" brings the default model back');

    const ph = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), R = {};
      const file = (type, name, w, h, colour) => new Promise(res => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, w, h); c.toBlob(b => res(new File([b], name, { type })), type); });
      const pick = f => { const dt = new DataTransfer(); dt.items.add(f); $('mk-photo-file').files = dt.files; $('mk-photo-file').dispatchEvent(new Event('change')); };
      MW.navUI.addMarker({ lat: -4.81, lon: 137.39 }); await W(200);
      pick(new File(['hello'], 'notes.txt', { type: 'text/plain' })); await W(100); R.badType = $('mk-photo-msg').textContent;
      pick(new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' })); await W(100); R.badSize = $('mk-photo-msg').textContent;
      pick(await file('image/png', 'ridge.png', 2400, 1600, '#c96')); for (let i = 0; i < 30 && $('mk-photo-img').hidden; i++) await W(100);
      R.preview = !$('mk-photo-img').hidden;
      $('mk-name').value = 'Photo marker'; $('mk-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await W(200);
      const mk = MW.markers.list().find(x => x.name === 'Photo marker'); R.id = mk && mk.id;
      const d = mk && MW.markers.photos.get(mk.id); R.stored = !!d && /^data:image\/jpeg/.test(d); R.kb = d ? Math.round(d.length * 0.75 / 1024) : 0;
      const im = new Image(); im.src = d; await im.decode(); R.px = Math.max(im.naturalWidth, im.naturalHeight);
      MW.navUI.openMarker(mk.id); await W(200); R.popup = !!document.querySelector('.mkp .mk-photo'); Marswalk._map.closePopup();
      return R;
    });
    ok(/PNG, JPEG or WebP/.test(ph.badType) && /10 MB/.test(ph.badSize), 'a marker photo must be PNG, JPEG or WebP and at most 10 MB', ph.badType.slice(0, 40) + '; ' + ph.badSize.slice(0, 40));
    ok(ph.preview && ph.stored && ph.px === 800 && ph.kb < 300 && ph.popup, 'an uploaded photo is shrunk, saved with the marker and shown in its details', ph.px + ' px, ' + ph.kb + ' KB');
    await open(base + 'index.html', () => !!(window.MW && MW.navUI && MW.markers));
    const ph2 = await run(async (id) => {
      const W = ms => new Promise(r => setTimeout(r, ms)), $ = id2 => document.getElementById(id2), R = {};
      R.kept = !!MW.markers.photos.get(id);
      const file = (type, name, colour) => new Promise(res => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 300, 200); c.toBlob(b => res(new File([b], name, { type })), type); });
      const before = MW.markers.photos.get(id);
      MW.navUI.openMarker(id); await W(100); document.querySelector('[data-mk="edit"]').click(); await W(200);
      R.editShows = !$('mk-photo-img').hidden && /Replace/.test($('mk-photo-add').textContent);
      const dt = new DataTransfer(); dt.items.add(await file('image/jpeg', 'new.jpg', '#36c')); $('mk-photo-file').files = dt.files; $('mk-photo-file').dispatchEvent(new Event('change'));
      for (let i = 0; i < 30 && $('mk-photo-img').src === before; i++) await W(100);
      $('mk-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await W(200);
      R.replaced = MW.markers.photos.get(id) && MW.markers.photos.get(id) !== before;
      MW.navUI.openMarker(id); await W(100); document.querySelector('[data-mk="edit"]').click(); await W(200);
      $('mk-photo-del').click(); $('mk-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await W(200);
      R.removed = MW.markers.photos.get(id) === null && !!MW.markers.get(id);
      MW.markers.remove(id); Marswalk.openTab('menu');
      return R;
    }, ph.id);
    ok(ph2.kept && ph2.editShows, 'the photo is still there after a refresh, and editing shows it');
    ok(ph2.replaced && ph2.removed, 'it can be replaced, and removed while the marker stays');

    /* ============================================================ the offline store */
    console.log('Offline');
    await open(base + 'index.html', () => !!(window.MW && MW.offline && navigator.serviceWorker && navigator.serviceWorker.controller));
    const off = await run(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms));
      Marswalk._map.setView([-4.8, 137.384], 15); await W(5000);
      const tiles = (await (await caches.open('marswalk-tiles-v1')).keys()).length, shell = (await (await caches.open('marswalk-shell-v2')).keys()).length;
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
  const ownBad = bad.filter(b => !/mars\.nasa\.gov\/api\//.test(b));          // NASA's image list refusing a headless browser is not a missing file
  ok(!ownBad.length, 'no file the page asked for was missing', ownBad.slice(0, 5).join('; ') || undefined);
  ok(!realErrors.length, 'no script errors', realErrors.slice(0, 5).join('; ') || undefined);
  console.log(`\n${passed} passed, ${failed} failed`);
  c.close(); br.kill(); srv.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 800);
})().catch(e => { console.error(e); process.exit(2); });
