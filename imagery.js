/* imagery.js — MW.imagery: the best real NASA picture of a place, and the "View from here" panel.
 *
 *   On Curiosity's drive (within ROVER_M of one of its stops): a photo from the rover's left Navigation Camera
 *     taken at that stop. Online, the frames of that sol come from NASA's raw-image service
 *     (mars.nasa.gov/api/v1/raw_image_items) and the one taken at the end of the sol's drive, looking closest to the
 *     walker's heading, is chosen. Offline or if that fails, the frame stored for the stop in data.js is used.
 *   Anywhere else: an orbital view from above, cut from the same NASA Mars Trek mosaics the map uses (HiRISE,
 *     CTX or Viking, the sharpest there), centred on the place, with a cross on the exact spot.
 *   Nothing suitable (no network, no cached tiles): it says so. It never shows a picture of somewhere else.
 *
 *   MW.imagery.best(lat, lon, { heading })   Promise -> { kind: 'rover' | 'orbital' | 'none', src, title, source, date,
 *                                            where, link, note }
 *   MW.imagery.show(lat, lon, opts)          put the best picture of that place in the panel
 *   MW.imagery.follow()                      the panel follows the walker again (it does after "View from here")
 */
(function () {
  'use strict';
  var C = MW.config, G = MW.geo, $ = G.$, DEG = G.DEG, ROVER_M = 60, SOL_S = 88775.244;
  var MSL_SOL0 = Date.parse('2012-08-06T05:17:57Z');            // Curiosity's landing: sol 0
  var API = 'https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=100&page=0&condition_1=msl:mission&condition_2=';
  var RAW = 'https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/';
  /* What each photo base layer is, for the caption. Dates as published for the source images, never guessed. */
  var ORBITAL = {
    'MRO HiRISE': { layer: 2, zoom: 16, inst: 'MRO HiRISE (High Resolution Imaging Science Experiment)', taken: 'images taken from 2006 on; the date of each image in the mosaic varies' },
    'MRO CTX': { layer: 1, zoom: 12, inst: 'MRO CTX (Context Camera)', taken: 'images taken from 2006 on; the date of each image in the mosaic varies' },
    'the Viking colour mosaic': { layer: 0, zoom: 7, inst: 'Viking Orbiter colour mosaic (MDIM 2.1, USGS)', taken: 'Viking Orbiter images taken 1976 to 1980' }
  };

  function ll(lat, lon) { return Math.abs(lat).toFixed(4) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(4) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function day(t) { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function angDiff(a, b) { return Math.abs(((b - a + 540) % 360) - 180); }
  function solDate(sol) { return MSL_SOL0 + sol * SOL_S * 1000; }

  /* ---------------------------------------------------------------- the rover's photos */
  function nearestStop(lat, lon) {
    var best = null;
    G.WP.forEach(function (w, i) { var d = G.haversine({ lat: lat, lon: lon }, w); if (!best || d < best.d) best = { i: i, d: d }; });
    return best;
  }
  var solCache = new Map();
  function solFrames(sol) {                            // full-size left Navcam frames of one sol, from NASA's raw-image service
    if (solCache.has(sol)) return solCache.get(sol);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    var p = fetch(API + sol + ':sol:in&condition_3=NAV_LEFT_B:instrument:in', ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        return (d.items || []).filter(function (it) { var ex = it.extended || {}; return (ex.sample_type || 'full') === 'full' && it.https_url; })
          .map(function (it) { var ex = it.extended || {}; return { url: it.https_url, id: it.id, drive: +it.drive || 0, az: +ex.mast_az, el: +ex.mast_el, taken: it.date_taken, title: it.title }; });
      });
    p.catch(function () { solCache.delete(sol); });     // try again next time
    solCache.set(sol, p);
    return p;
  }
  function pickFrame(frames, yaw, heading) {           // taken where the drive ended, looking out (not at the deck), towards the heading
    var end = Math.max.apply(null, frames.map(function (f) { return f.drive; }));
    var pool = frames.filter(function (f) { return f.drive === end && isFinite(f.el) && f.el > -40 && f.el < 25; });
    if (!pool.length) pool = frames.filter(function (f) { return f.drive === end; });
    pool.sort(function (a, b) {
      var sa = (heading === null || heading === undefined || !isFinite(a.az) ? 0 : angDiff((a.az + yaw) % 360, heading)) + Math.abs(a.el + 10) * 0.5;
      var sb = (heading === null || heading === undefined || !isFinite(b.az) ? 0 : angDiff((b.az + yaw) % 360, heading)) + Math.abs(b.el + 10) * 0.5;
      return sa - sb;
    });
    return pool[0] || null;
  }
  function roverImage(lat, lon, opts) {
    var st = nearestStop(lat, lon);
    if (!st || st.d > ROVER_M) return Promise.resolve(null);
    var w = G.WP[st.i], where = 'Curiosity stop ' + (st.i + 1) + ' of ' + G.WP.length + ', ' + ll(w.lat, w.lon) + (st.d > 2 ? ' (' + Math.round(st.d) + ' m from the spot)' : '');
    var stored = function () {                         // the frame kept for the nearest stop that has one (data.js)
      for (var k = 0; k < 6; k++) for (var s = -1; s <= 1; s += 2) {
        var j = st.i + s * k; if (!G.WP[j] || !G.WP[j].pov) continue;
        if (G.haversine({ lat: lat, lon: lon }, G.WP[j]) > ROVER_M + 25) continue;
        var v = G.WP[j];
        return { kind: 'rover', src: RAW + String(v.sol).padStart(5, '0') + '/opgs/edr/ncam/NLB_' + v.pov + '_.JPG', title: "Curiosity's view here",
          source: 'NASA/JPL-Caltech, Curiosity left Navigation Camera (Navcam), raw image', date: 'Sol ' + v.sol + ', about ' + day(solDate(v.sol)) + ' (worked out from the sol)',
          where: 'Curiosity stop ' + (j + 1) + ', ' + ll(v.lat, v.lon), link: RAW + String(v.sol).padStart(5, '0') + '/opgs/edr/ncam/NLB_' + v.pov + '_.JPG', note: 'Frame stored with the route; the live image list could not be reached.' };
      }
      return null;
    };
    return solFrames(w.sol).then(function (frames) {
      var f = frames.length ? pickFrame(frames, w.yaw || 0, opts && opts.heading) : null;
      if (!f) return stored();
      return { kind: 'rover', src: f.url, title: "Curiosity's view here", source: 'NASA/JPL-Caltech, Curiosity left Navigation Camera (Navcam), raw image ' + f.id,
        date: 'Taken ' + new Date(f.taken).toISOString().slice(0, 16).replace('T', ' ') + ' UTC, sol ' + w.sol, where: where, link: f.url,
        note: isFinite(f.az) ? 'Looking ' + G.compass(((f.az + (w.yaw || 0)) % 360 + 360) % 360) + ', chosen from ' + frames.length + ' frames of that sol.' : '' };
    }, stored);
  }

  /* ---------------------------------------------------------------- the view from orbit */
  function loadTile(url) {
    return new Promise(function (res) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
  }
  function orbitalImage(lat, lon) {
    var im = MW.places.imageryAt(lat, lon), O = ORBITAL[im.name]; if (!O) return Promise.resolve(null);
    var b = C.BASE[O.layer], z = Math.min(O.zoom, b.nz), d = 180 / Math.pow(2, z), W = 320, H = 240;
    var fx = (((lon + 180) % 360) + 360) % 360 / d, fy = (90 - lat) / d, px = fx * 256, py = fy * 256;   // the spot in world pixels at zoom z
    var x0 = px - W / 2, y0 = py - H / 2, tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + W - 1) / 256), ty0 = Math.max(0, Math.floor(y0 / 256)), ty1 = Math.min(Math.pow(2, z) - 1, Math.floor((y0 + H - 1) / 256));
    var jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      var wx = ((tx % Math.pow(2, z + 1)) + Math.pow(2, z + 1)) % Math.pow(2, z + 1);
      jobs.push({ tx: tx, ty: ty, url: C.TREK + b.id + C.TREK_PATH + z + '/' + ty + '/' + wx + '.' + b.ext });
    }
    return Promise.all(jobs.map(function (j) { return loadTile(j.url).then(function (img) { j.img = img; return j; }); })).then(function (js) {
      var got = js.filter(function (j) { return j.img; });
      if (!got.length) return null;
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d'); g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, W, H);
      got.forEach(function (j) { g.drawImage(j.img, Math.round(j.tx * 256 - x0), Math.round(j.ty * 256 - y0)); });
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.shadowColor = '#000'; g.shadowBlur = 3;          // the exact spot
      g.beginPath(); g.moveTo(W / 2 - 14, H / 2); g.lineTo(W / 2 - 5, H / 2); g.moveTo(W / 2 + 5, H / 2); g.lineTo(W / 2 + 14, H / 2);
      g.moveTo(W / 2, H / 2 - 14); g.lineTo(W / 2, H / 2 - 5); g.moveTo(W / 2, H / 2 + 5); g.lineTo(W / 2, H / 2 + 14); g.stroke();
      var mpp = d / 256 * G.M_PER_DEG * Math.cos(lat * DEG), across = mpp * W;
      var src; try { src = cv.toDataURL('image/jpeg', 0.85); } catch (e) { return null; }
      return { kind: 'orbital', src: src, title: 'Seen from orbit', source: 'NASA/JPL/USGS Mars Trek, ' + O.inst + ' mosaic, layer ' + b.id,
        date: O.taken, where: 'Centred on ' + ll(lat, lon) + '; the picture is about ' + (across >= 1000 ? G.fmt(across / 1000, across < 10000 ? 1 : 0) + ' km' : G.fmt(across) + ' m') + ' across (' + im.res + ')',
        link: 'https://trek.nasa.gov/mars/', note: got.length < js.length ? 'Part of the area could not be loaded.' : '' };
    });
  }

  function best(lat, lon, opts) {
    return roverImage(lat, lon, opts).then(function (r) { return r || orbitalImage(lat, lon); }).then(function (r) {
      return r || { kind: 'none', title: 'No imagery available for this location.', source: '', date: '', where: ll(lat, lon), link: '',
        note: navigator.onLine === false ? 'The pictures come from NASA servers: connect to the internet, or save the walk area for offline use (Map Overlay).' : 'NASA has no picture of this spot that could be loaded.' };
    });
  }

  /* ---------------------------------------------------------------- the panel */
  var app = window.Marswalk, following = true, lastAt = null, seq = 0;
  function show(lat, lon, opts) {
    var my = ++seq, pv = $('pov'), img = $('pov-img');
    pv.hidden = false; $('pov-open').hidden = true; pv.classList.add('loading');
    $('pov-title').textContent = 'Finding a NASA picture of this spot…'; $('pov-sub').textContent = ll(lat, lon); $('pov-meta').textContent = ''; $('pov-link').hidden = true;
    lastAt = { lat: lat, lon: lon };
    return best(lat, lon, opts).then(function (r) {
      if (my !== seq) return r;                        // a newer request has taken over
      pv.classList.remove('loading'); pv.setAttribute('data-kind', r.kind);
      $('pov-title').textContent = r.kind === 'none' ? r.title : r.title + (opts && opts.label ? ' (' + opts.label + ')' : '');
      $('pov-sub').textContent = r.where;
      $('pov-meta').innerHTML = (r.source ? '<span>' + G.escapeHtml(r.source) + '</span>' : '') + (r.date ? '<span>' + G.escapeHtml(r.date) + '</span>' : '') + (r.note ? '<span>' + G.escapeHtml(r.note) + '</span>' : '');
      if (r.kind === 'none') { img.removeAttribute('src'); img.alt = ''; img.hidden = true; }
      else {
        img.hidden = false; img.alt = r.title + ': ' + r.where;
        img.onerror = function () {                    // a listed photo that will not load: say so rather than show nothing
          if (my !== seq) return;
          img.hidden = true; $('pov-title').textContent = 'No imagery available for this location.';
          $('pov-meta').innerHTML = '<span>The picture did not load. The pictures come from NASA servers and need an internet connection.</span>';
        };
        img.src = r.src;
      }
      $('pov-link').hidden = !r.link; if (r.link) { $('pov-link').href = r.link; $('pov-link').textContent = r.kind === 'rover' ? 'Open the full image at NASA' : 'Open NASA Mars Trek'; }
      return r;
    });
  }
  function showHere(force) {
    var h = app.here();
    if (!force && lastAt && G.haversine(h, lastAt) < 40) return;   // refresh as the walker moves, not every step
    show(h.lat, h.lon, { heading: app._state.heading });
  }
  setInterval(function () { if (following && !$('pov').hidden) showHere(false); }, 2500);
  $('pov-close').addEventListener('click', function () { $('pov').hidden = true; $('pov-open').hidden = false; });
  $('pov-open').addEventListener('click', function () { following = true; showHere(true); });
  if (window.innerWidth > 860) showHere(true); else $('pov-open').hidden = false;   // small screens keep the map clear

  MW.imagery = { best: best, rover: roverImage, orbital: orbitalImage,
    show: function (lat, lon, opts) { following = !!(opts && opts.follow); return show(lat, lon, opts); },
    follow: function () { following = true; showHere(true); } };
})();
