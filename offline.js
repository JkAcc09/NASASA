/* offline.js — "Offline map" in the Map Overlay tab: registers sw.js and saves the walk area's tiles ahead of time.
 *
 * Once the service worker runs, every map tile you look at is kept, and the app's own files are kept too, so the
 * page opens and the map shows where you have already looked, with no connection. "Save the walk area" fetches
 * the tiles you have not looked at yet for the ground around the walk: deep zooms near it, coarse zooms farther
 * out (OFFLINE.PLAN in config.js). Loads after app.js.
 */
(function () {
  'use strict';
  var C = MW.config, K = C.OFFLINE, G = MW.geo, $ = G.$, app = window.Marswalk, TILES = 'marswalk-tiles-v1';
  var secure = window.isSecureContext && /^https?:$/.test(location.protocol);
  var can = secure && 'serviceWorker' in navigator && 'caches' in window, plan = null, abort = false, swError = null;

  function say(t) { $('off-msg').innerHTML = t || ''; $('off-msg').hidden = !t; }
  function status() {
    if (!can) {
      $('off-status').textContent = location.protocol === 'file:'
        ? 'Not available when the page is opened as a file. Serve the folder (python -m http.server) and open http://localhost:8000, or use the published site.'
        : 'Not available here: this browser or address does not allow it (it needs https or localhost).';
      $('off-save').disabled = true; $('off-clear').disabled = true; return;
    }
    caches.open(TILES).then(function (c) { return c.keys(); }).then(function (keys) {
      var ctl = swError ? 'The offline store could not start here (' + swError + '). Saving tiles still works, but the page will not open without a connection.'
        : navigator.serviceWorker.controller ? 'On: the app and the tiles you view are kept for use without a connection.' : 'Starting… (reload once to finish)';
      $('off-status').textContent = ctl + ' ' + G.fmt(keys.length) + ' map tile' + (keys.length === 1 ? '' : 's') + ' kept.';
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) {
        $('off-status').textContent += ' Storage used: ' + G.fmt(Math.round((e.usage || 0) / 1048576)) + ' MB.';
      });
    });
  }

  /* ---------------------------------------------------------------- which tiles */
  function walkArea() {                                // points the walk area is drawn around
    var pts = [[G.ORIGIN.lat, G.ORIGIN.lon]], h = app.here();
    pts.push([h.lat, h.lon]);
    app._trail.pts.forEach(function (p, i) { if (i % 20 === 0) pts.push(p.ll); });
    if (G.SITE.gale) G.WP.forEach(function (w) { pts.push([w.lat, w.lon]); });
    app.savedTrails().forEach(function (r) { if (G.haversine({ lat: r.points[0][0], lon: r.points[0][1] }, G.ORIGIN) < 50000) r.points.forEach(function (p, i) { if (i % 20 === 0) pts.push([p[0], p[1]]); }); });
    var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; });
    return { s: Math.min.apply(null, la), n: Math.max.apply(null, la), w: Math.min.apply(null, lo), e: Math.max.apply(null, lo) };
  }
  function grow(a, km) {
    if (km === null) return { s: -90, n: 90, w: -180, e: 180 };
    var dLat = km * 1000 / G.M_PER_DEG, dLon = dLat / Math.max(0.05, Math.cos(((a.s + a.n) / 2) * G.DEG));
    return { s: Math.max(-90, a.s - dLat), n: Math.min(90, a.n + dLat), w: Math.max(-180, a.w - dLon), e: Math.min(180, a.e + dLon) };
  }
  function clip(a, b) { if (!b) return a; return { s: Math.max(a.s, b[0][0]), n: Math.min(a.n, b[1][0]), w: Math.max(a.w, b[0][1]), e: Math.min(a.e, b[1][1]) }; }
  function tilesFor(id, ext, box, z) {                 // Trek's equirectangular tiles: 2 x 1 at zoom 0, each 180/2^z degrees
    var d = 180 / Math.pow(2, z), out = [];
    if (box.s >= box.n || box.w >= box.e) return out;
    var x0 = Math.max(0, Math.floor((box.w + 180) / d)), x1 = Math.min(Math.pow(2, z + 1) - 1, Math.floor((box.e + 180 - 1e-9) / d));
    var y0 = Math.max(0, Math.floor((90 - box.n) / d)), y1 = Math.min(Math.pow(2, z) - 1, Math.floor((90 - box.s - 1e-9) / d));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push(C.TREK + id + C.TREK_PATH + z + '/' + y + '/' + x + '.' + ext);
    return out;
  }
  function makePlan() {
    var area = walkArea(), urls = [];
    C.BASE.forEach(function (b, i) {
      (K.PLAN[i] || []).forEach(function (p) {
        var box = clip(grow(area, p.radius), b.opts && b.opts.bounds);
        for (var z = p.zooms[0]; z <= Math.min(p.zooms[1], b.nz); z++) urls = urls.concat(tilesFor(b.id, b.ext, box, z));
      });
    });
    var L1 = app._layer();                             // the overlay switched on, if any
    if (L1 && L1._id) { var box = grow(area, K.OVERLAY.radius); for (var z = 0; z <= L1._nz; z++) urls = urls.concat(tilesFor(L1._id, L1._ext, box, z)); }
    var seen = {}; urls = urls.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
    return { urls: urls.slice(0, K.MAX_TILES), cut: urls.length > K.MAX_TILES, overlay: L1 && L1._id ? L1._id : null };
  }

  /* ---------------------------------------------------------------- saving */
  function offer() {
    plan = makePlan();
    var mb = Math.round(plan.urls.length * K.TILE_KB / 1024);
    $('off-plan').innerHTML = 'About <b>' + G.fmt(plan.urls.length) + ' tiles</b>, roughly ' + G.fmt(mb) + ' MB (tiles already kept are skipped): the photo map ' +
      (G.SITE.gale ? 'from 0.6 m per pixel around the walk' : 'at its best resolution around the walk') + ' out to the whole planet in coarse detail' +
      (plan.overlay ? ', and the overlay that is switched on' : '') + '.' + (plan.cut ? ' Capped at ' + G.fmt(K.MAX_TILES) + ' tiles.' : '');
    $('off-confirm').hidden = false; say('');
  }
  function run() {
    $('off-confirm').hidden = true; abort = false; $('off-stop').hidden = false; $('off-save').disabled = true;
    var urls = plan.urls, i = 0, done = 0, got = 0, failed = 0;
    caches.open(TILES).then(function (cache) {
      function next() {
        if (abort || i >= urls.length) return Promise.resolve();
        var u = urls[i++];
        return cache.match(u).then(function (hit) {
          if (hit) return;
          return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) { got++; return cache.put(u, r); } failed++; }).catch(function () { failed++; });
        }).then(function () { done++; if (done % 25 === 0 || done === urls.length) say('Saving the walk area: ' + G.fmt(done) + ' of ' + G.fmt(urls.length) + ' tiles…'); return next(); });
      }
      var lanes = []; for (var k = 0; k < 6; k++) lanes.push(next());
      return Promise.all(lanes);
    }).then(function () {
      $('off-stop').hidden = true; $('off-save').disabled = false;
      say((abort ? 'Stopped. ' : 'Done. ') + G.fmt(got) + ' new tiles saved' + (failed ? ', ' + G.fmt(failed) + ' not available from NASA (beyond a layer’s edge or deepest zoom)' : '') + '. The walk area now shows without a connection.');
      status();
    });
  }
  $('off-save').addEventListener('click', offer);
  $('off-go').addEventListener('click', run);
  $('off-cancel').addEventListener('click', function () { $('off-confirm').hidden = true; });
  $('off-stop').addEventListener('click', function () { abort = true; });
  $('off-clear').addEventListener('click', function () {
    if (!can) return;
    if (!this.getAttribute('data-sure')) { var b = this; b.setAttribute('data-sure', '1'); b.textContent = 'Delete the kept tiles?'; setTimeout(function () { b.removeAttribute('data-sure'); b.textContent = 'Delete kept tiles'; }, 4000); return; }
    caches.delete(TILES).then(function () { say('The kept map tiles are deleted. The app itself is still kept.'); status(); });
    this.removeAttribute('data-sure'); this.textContent = 'Delete kept tiles';
  });

  if (can) navigator.serviceWorker.register('sw.js').then(function () { navigator.serviceWorker.ready.then(status); }, function (e) { swError = e.message || 'unknown error'; status(); });
  status();
  MW.offline = { available: can, plan: function () { return makePlan(); }, tilesFor: tilesFor, status: status };
})();
