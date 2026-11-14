/* app.js — the page itself: builds the map, moves the pointer, draws the trail, fills the readouts.
 *
 * Sections, in order:
 *   1. Map and layers            5. Movement (replay, manual, sensors)
 *   2. Reference route           6. Recording and saved trails
 *      and landmarks             7. Readouts (bottom strip) and rover view
 *   3. Pointer and state         8. Controls, settings and the main loop
 *   4. Trail drawing
 *
 * Real sensors plug in through window.Marswalk.setPose({ lat, lon, heading }).
 */
(function () {
  'use strict';
  var C = MW.config, G = MW.geo, WP = G.WP, $ = G.$, store = MW.store, settings = MW.settings;
  var fmt = G.fmt, minus = G.minus, norm = G.norm, clock = G.clock, compass = G.compass, toLL = G.toLL, toENU = G.toENU;

  /* ================================================================== 1. Map and layers */
  var map = L.map('map', {
    crs: L.CRS.EPSG4326,                // Trek serves plain lat/lon (equirectangular) tiles, 2×1 at zoom 0
    center: [G.ORIGIN.lat, G.ORIGIN.lon], zoom: 15, minZoom: 1, maxZoom: 18,
    zoomControl: false, keyboard: false, preferCanvas: true, zoomSnap: 0.5,
    maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 0.8
  });
  map.attributionControl.setPrefix(false);
  map.createPane('data').style.zIndex = 250;     // the data layer, above the photo base
  map.createPane('route').style.zIndex = 410;    // reference route, stops, saved trails
  map.createPane('trail').style.zIndex = 420;    // the live trail
  map.getPane('data').style.pointerEvents = 'none';
  map.getPane('trail').style.pointerEvents = 'none';   // the trail is hit-tested by hand, so taps reach the route stops
  var routeR = L.canvas({ pane: 'route', padding: 0.3 }), trailR = L.canvas({ pane: 'trail', padding: 0.3 });

  /* Photo base. If NASA's server cannot be reached, say so plainly. */
  var tilesOk = 0, tilesBad = 0;
  function onTileError() {
    tilesBad++;
    if (!tilesOk && tilesBad > 5) { $('banner').textContent = "Can't load map imagery from NASA Mars Trek. Check the internet connection, then reload. The route, pointer and trail still work."; $('banner').hidden = false; }
  }
  C.BASE.forEach(function (b, i) {
    var layer = new MW.SmoothTiles(b.id, b.ext, b.nz, L.extend({ attribution: i ? '' : 'Tiles: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA/JPL Mars Trek</a>' }, b.opts)).addTo(map);
    layer.on('tileload', function () { tilesOk++; $('banner').hidden = true; });
    layer.on('tileerror', onTileError);
  });

  /* The one switchable data layer, its legend bar and its note. */
  var dataLayer = null, activeDef = C.LAYERS[0], dataOpacity = 0.65;
  function setDataLayer(key) {
    if (dataLayer) { map.removeLayer(dataLayer); dataLayer = null; }
    var def = activeDef = C.LAYERS.filter(function (l) { return l.key === key; })[0];
    if (def.id) {
      dataLayer = new MW.SmoothTiles(def.id, def.ext, def.nz, { pane: 'data', opacity: dataOpacity, read: def.read, ramp: def.ramp, stretch: def.stretch }).addTo(map);
      dataLayer.on('tileerror', onTileError);
    }
    $('layer-note').textContent = def.note + (def.regional ? C.REGIONAL_NOTE : '');
    /* Every data layer gets the same bar: low word, colours, high word, and a tick at the walker's value. */
    var key$ = $('layer-key'), stops = C.RAMPS[def.ramp || def.legend];
    key$.hidden = $('layer-key-note').hidden = !stops;
    if (stops) {
      key$.children[0].textContent = def.ends[0]; key$.children[2].textContent = def.ends[1];
      key$.children[1].style.background = $('p-bar').style.background = G.rampCss(stops);
      $('layer-key-note').textContent = def.stretch ? 'Colours are spread over the range inside the current view, so they show local contrast, not absolute values.'
        : def.ramp ? "Fixed scale, read from the colours of NASA's map: the same colour means the same amount everywhere."
        : "NASA's own colours, as published.";
    }
    $('layer-tick').hidden = true;
    updateProbe();
  }
  (function buildLayerList() {
    var box = $('layer-list');
    C.LAYERS.forEach(function (l) {
      if (l.group) {
        var h = document.createElement('div'); h.className = 'grp'; h.textContent = l.group + ' ';
        if (l.info) h.insertAdjacentHTML('beforeend', '<button type="button" class="info" data-info="' + l.info + '" aria-label="What does this mean?">i</button>');
        box.appendChild(h); return;
      }
      var lab = document.createElement('label');
      lab.innerHTML = '<input type="radio" name="layer" value="' + l.key + '"' + (l.key === 'none' ? ' checked' : '') + '><span>' + l.name + '</span><span class="res">' + l.res + '</span>';
      box.appendChild(lab);
    });
    box.addEventListener('change', function (e) { setDataLayer(e.target.value); });
    $('opacity').addEventListener('input', function (e) { dataOpacity = e.target.value / 100; if (dataLayer) dataLayer.setOpacity(dataOpacity); });
  })();

  /* ================================================================== 2. Reference route */
  var routeLL = WP.map(function (w) { return [w.lat, w.lon]; });
  L.polyline(routeLL, { renderer: routeR, color: '#000', weight: 4, opacity: 0.55, interactive: false }).addTo(map);
  L.polyline(routeLL, { renderer: routeR, color: '#fff', weight: 1.6, dashArray: '5 5', interactive: false }).addTo(map);
  L.circleMarker(routeLL[0], { renderer: routeR, radius: 8, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(map)
    .bindTooltip('Base', { permanent: true, direction: 'left', offset: [-8, 0] });
  var stops = WP.map(function (w, i) {
    return L.circleMarker([w.lat, w.lon], { renderer: routeR, radius: 4, color: '#000', weight: 1, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false })
      .addTo(map).on('click', function () { openStop(i); });
  });
  function colourStops(key) {
    var v = C.ROUTE_VARS.filter(function (x) { return x.key === key; })[0], leg = $('route-legend');
    if (!v.get) { stops.forEach(function (s) { s.setStyle({ fillColor: '#fff', radius: 4 }); }); leg.hidden = true; return; }
    var vals = WP.map(v.get), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    stops.forEach(function (s, i) { s.setStyle({ fillColor: 'rgb(' + G.rampColour(C.VIRIDIS, hi === lo ? 0.5 : (vals[i] - lo) / (hi - lo)).join(',') + ')', radius: 6 }); });
    $('ramp-min').textContent = minus(lo) + v.unit; $('ramp-max').textContent = minus(hi) + v.unit; leg.hidden = false;
  }
  (function () {
    var sel = $('route-var');
    C.ROUTE_VARS.forEach(function (v) { var o = document.createElement('option'); o.value = v.key; o.textContent = v.name; sel.appendChild(o); });
    sel.addEventListener('change', function () { colourStops(sel.value); });
  })();
  function openStop(i) {
    var w = WP[i], x = w.wx, ps = trail.passesNear(w.x, w.y, 4);
    var html = '<div class="pop"><h3>Curiosity stop, sol ' + w.sol + '</h3><ul>' +
      '<li>Height ' + minus(w.z, 1) + ' m</li>' +
      '<li>Air ' + minus(x.tmin) + ' to ' + minus(x.tmax) + ' °C</li>' +
      '<li>Ground ' + minus(x.gmin) + ' to ' + minus(x.gmax) + ' °C</li>' +
      '<li>Pressure ' + x.p + ' Pa</li></ul>' +
      '<p>' + (w.wxMeasured ? 'REMS readings for this sol.' : 'REMS feed stops at sol 4995; last reported sol shown.') + '</p>' +
      (ps.length ? '<p>Your trail has passed this stop ' + (ps.length === 1 ? 'once' : ps.length + ' times') + ':</p>' + passList(ps) : '') +
      '<button type="button" data-pov="' + i + '">Show rover view</button></div>';
    L.popup({ maxWidth: 260 }).setLatLng([w.lat, w.lon]).setContent(html).openOn(map);
  }
  document.addEventListener('click', function (e) {      // capture phase: Leaflet popups swallow clicks
    var b = e.target.closest && e.target.closest('[data-pov]');
    if (b) { showPov(+b.getAttribute('data-pov')); map.closePopup(); }
  }, true);

  /* ---- Landmarks: names on the map; tap one for its details and outline ---- */
  var lmOutline = null;
  function userVisits(lm) {                              // by the active walker: this trail plus their saved trails
    var w = settings.walker(), live = MW.landmarks.entries(lm, trail.pts.map(function (p) { return p.ll; })), saved = 0;
    store.list().forEach(function (r) { if (!r.walker || r.walker.name === w.name) saved += MW.landmarks.entries(lm, r.points); });
    return { who: w.name, live: live, saved: saved };
  }
  function openLandmark(lm) {
    var v = userVisits(lm), n = v.live + v.saved, times = function (k) { return k === 1 ? 'once' : k + ' times'; };
    var html = '<div class="pop lmk"><h3>' + G.escapeHtml(lm.name) + '</h3><dl>' +
      '<dt>Function</dt><dd>' + lm.role + '</dd>' +
      '<dt>Size</dt><dd>' + lm.size + '</dd>' +
      '<dt>Visited by missions</dt><dd>' + (lm.missions[0] ? times(lm.missions[0]) + ': ' : 'never: ') + lm.missions[1] + '</dd>' +
      '<dt>Visited by you</dt><dd>' + (n ? times(n) : 'not yet') + ' (' + G.escapeHtml(v.who) + (n ? ': ' + v.live + ' on this trail, ' + v.saved + ' in saved trails' : '') + ')</dd>' +
      '</dl><p>' + lm.note + '</p>' + (lm.outlineNote ? '<p>' + lm.outlineNote + '</p>' : '') + '</div>';
    if (lmOutline) lmOutline.forEach(function (l) { map.removeLayer(l); });
    lmOutline = lm.outline
      ? [L.polygon(lm.outline, { renderer: routeR, color: '#000', weight: 5, opacity: 0.5, fill: false, interactive: false }).addTo(map),
         L.polygon(lm.outline, { renderer: routeR, color: '#fff', weight: 2, dashArray: '7 5', fillColor: '#fff', fillOpacity: 0.1, interactive: false }).addTo(map)]
      : [L.circleMarker(lm.at, { renderer: routeR, radius: 14, color: '#fff', weight: 2, dashArray: '5 4', fillOpacity: 0, interactive: false }).addTo(map)];
    L.popup({ maxWidth: 300, className: 'lmk-pop' }).setLatLng(lm.at).setContent(html).openOn(map);
  }
  map.on('popupclose', function (e) {
    if (lmOutline && e.popup.options.className === 'lmk-pop') { lmOutline.forEach(function (l) { map.removeLayer(l); }); lmOutline = null; }
  });
  MW.landmarks.attach(map, { onOpen: openLandmark });

  /* ================================================================== 3. Pointer and state */
  var meIcon = L.divIcon({
    className: 'me', iconSize: [72, 72], iconAnchor: [36, 36],
    html: '<svg width="72" height="72" viewBox="-36 -36 72 72" aria-hidden="true">' +
      '<defs><radialGradient id="cone" cx="0" cy="0" r="36" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0.25" stop-color="currentColor" stop-opacity="0.55"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>' +
      '<g id="me-rot"><path d="M0 0 L-18 -31.2 A36 36 0 0 1 18 -31.2 Z" fill="url(#cone)"/>' +             // 60° view cone
      '<path class="me-arrow" d="M0 -18 L12 13 L0 6.5 L-12 13 Z" fill="currentColor" stroke-width="2.6" stroke-linejoin="round"/></g></svg>'   // colour and size come from Settings, as CSS variables
  });
  var me = L.marker([G.ORIGIN.lat, G.ORIGIN.lon], { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);

  var S = {
    x: 0, y: 0, heading: G.ORIGIN.yaw,   // metres from base, degrees clockwise from north
    mode: 'replay',                      // 'replay' follows `route`; 'manual' is keys, pad and taps
    playing: false,                      // every replay starts with the pointer standing still
    factor: 30,                          // time speed-up
    t: 0, dist: 0, dose: 0,              // seconds, metres and µSv since this trail began
    follow: true, external: false,
    near: { i: 0, z: G.ORIGIN.z, d: 0, s: 0 }   // nearest place on the reference route
  };

  /* ================================================================== 4. Trail drawing */
  var trail = new MW.Trail();
  var casing = L.polyline([], { renderer: trailR, color: '#22061F', weight: 9, opacity: 0.6, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  var tLines = [0, 1, 2, 3].map(function () {            // one line per pass count: four canvas strokes however long the trail gets
    return L.polyline([], { renderer: trailR, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  });
  function styleTrail() {                                // colour and width chosen in Settings
    var pal = C.TRAIL_PALETTES[settings.get('trailColour')], w = settings.get('trailWidth');
    casing.setStyle({ weight: 9 * w });
    tLines.forEach(function (l, i) { l.setStyle({ color: pal[i], weight: (4 + i) * w }); });
  }
  var backLine = L.polyline([], { renderer: trailR, color: '#0B5FFF', weight: 3, dashArray: '2 7', interactive: false }).addTo(map);
  var showBack = false;

  function meta() { return { t: S.t, hdg: Math.round(norm(S.heading)) % 360, sol: WP[S.near.i].sol }; }
  function drawTrail() {
    var runs = trail.linesByPasses();
    casing.setLatLngs(trail.pts.map(function (p) { return p.ll; }));
    tLines.forEach(function (l, b) { l.setLatLngs(runs[b]); });
    backLine.setLatLngs(showBack ? trail.wayBack().map(function (p) { return p.ll; }) : []);
    trail.dirty = false;
  }
  function clearTrail() {
    trail.reset(); S.dist = 0; S.t = 0; S.dose = 0;
    trail.add(S.x, S.y, 0, meta()); drawTrail(); map.closePopup();
  }
  function passList(passes) {
    return '<ol>' + passes.map(function (p) {
      return '<li>' + clock(p.t) + ' into the walk, looking ' + String(p.hdg).padStart(3, '0') + '° ' + compass(p.hdg) +
        (route.stops && S.mode === 'replay' ? ', sol ' + p.sol : '') + '</li>';
    }).join('') + '</ol>';
  }
  /* Tap near the trail: list every pass over that spot, in the order they happened. */
  function inspectTrail(latlng) {
    var e = toENU(latlng.lat, latlng.lng);
    var best = trail.nearest(e.x, e.y, Math.max(C.NEAR, 12 * G.metresPerPixel(map.getZoom())));
    if (!best) return false;
    var passes = trail.passesNear(best.x, best.y, C.NEAR), n = passes.length;
    L.popup({ maxWidth: 300 }).setLatLng(best.ll).setContent('<div class="pop"><h3>' + (n === 1 ? 'Passed here once' : 'Passed here ' + n + ' times') + '</h3>' +
      passList(passes) + '<p>' + fmt(best.d) + ' m along the trail at the latest pass.</p></div>').openOn(map);
    return true;
  }

  /* ================================================================== 5. Movement */
  function setPos(x, y) {
    S.dist += Math.hypot(x - S.x, y - S.y);
    S.x = x; S.y = y;
    trail.record(x, y, S.dist, meta());
  }
  function slew(to, dt, rate) {                       // turn towards `to`, at most `rate` degrees a second
    var d = G.angDiff(S.heading, to), step = (rate || 300) * dt;
    S.heading = norm(Math.abs(d) <= step ? to : S.heading + Math.sign(d) * step);
    return Math.abs(d);
  }

  /* --- replay: follow `route`, either Curiosity's drive or a saved trail --- */
  var CURIOSITY = { id: 'curiosity', name: "Curiosity's drive", stops: true, pts: WP.map(function (w) { return { x: w.x, y: w.y, hdg: w.yaw }; }) };
  function routeFromRecord(rec) {
    return { id: rec.id, name: rec.name, stops: false, pts: rec.points.map(function (p) { var e = toENU(p[0], p[1]); return { x: e.x, y: e.y, hdg: p[3] || 0 }; }) };
  }
  var route = CURIOSITY, replay = { seg: 0, f: 0, hold: 0 };

  /* Put the pointer at the start of a route, standing still, with a fresh trail. */
  function loadRoute(r) {
    route = r; S.mode = 'replay'; target = null; stopRecording(false);
    replay.seg = 0; replay.f = 0; replay.hold = 0;
    S.x = r.pts[0].x; S.y = r.pts[0].y; S.heading = r.pts[0].hdg;
    nearestOnRoute(); clearTrail(); setPlaying(false); showMode();
    setFollow(true); map.panTo(toLL(S.x, S.y));
  }
  function atRouteEnd() { return replay.seg >= route.pts.length - 1; }
  function stepReplay(dt) {
    var P = route.pts;
    if (replay.hold > 0) { replay.hold -= dt; slew(P[replay.seg].hdg, dt); return; }   // stopped: face the way the rover really faced
    if (atRouteEnd()) { setPlaying(false); return; }
    var a0 = P[replay.seg], b0 = P[replay.seg + 1];
    slew(route.stops ? G.bearing(b0.x - a0.x, b0.y - a0.y) : b0.hdg, dt, 480);
    var move = C.WALK * S.factor * dt;
    while (move > 0 && !atRouteEnd()) {
      var a = P[replay.seg], b = P[replay.seg + 1], len = Math.max(0.01, Math.hypot(b.x - a.x, b.y - a.y)), left = len * (1 - replay.f);
      if (move < left) { replay.f += move / len; move = 0; setPos(a.x + (b.x - a.x) * replay.f, a.y + (b.y - a.y) * replay.f); }
      else {
        move -= left; replay.seg++; replay.f = 0; setPos(b.x, b.y);
        if (route.stops) {                           // a 12 second stop at each of Curiosity's positions
          replay.hold = 12 / S.factor; move = 0;
          if (!$('pov').hidden && WP[replay.seg].pov) showPov(replay.seg);
        }
      }
    }
  }

  /* --- manual: keys, on-screen pad, or tap the map to walk there --- */
  var keys = { fwd: false, back: false, left: false, right: false }, target = null;
  function stepManual(dt) {
    var turning = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), moving = (keys.fwd ? 1 : 0) - (keys.back ? 0.5 : 0);
    if (turning || moving) target = null;
    if (target) {
      var dx = target.x - S.x, dy = target.y - S.y, d = Math.hypot(dx, dy);
      if (d < 0.5) { target = null; return; }
      if (slew(G.bearing(dx, dy), dt, 240) < 25) {
        var st = Math.min(d, C.WALK * S.factor * dt), h = S.heading * G.DEG;
        setPos(S.x + Math.sin(h) * st, S.y + Math.cos(h) * st);
      }
      return;
    }
    if (turning) S.heading = norm(S.heading + turning * 100 * dt);
    if (moving) { var hh = S.heading * G.DEG, m = moving * C.WALK * S.factor * dt; setPos(S.x + Math.sin(hh) * m, S.y + Math.cos(hh) * m); }
  }

  /* Where am I relative to the surveyed route? Gives height, the matching sol and its weather. */
  function nearestOnRoute() {
    var best = { d: 1e12, i: 0, z: G.ORIGIN.z, s: 0 };
    for (var i = 0; i < WP.length - 1; i++) {
      var a = WP[i], b = WP[i + 1], vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1e-6;
      var t = Math.max(0, Math.min(1, ((S.x - a.x) * vx + (S.y - a.y) * vy) / L2));
      var d = Math.hypot(S.x - (a.x + vx * t), S.y - (a.y + vy * t));
      if (d < best.d) best = { d: d, i: t < 0.5 ? i : i + 1, z: a.z + (b.z - a.z) * t, s: a.s + (b.s - a.s) * t };
    }
    S.near = best;
  }

  /* Conditions "now": REMS gives each sol's low and high; the hour-by-hour curve between them is modelled. */
  function conditions() {
    var w = WP[S.near.i].wx, hour = (C.START_HOUR + S.t / C.MARS_HOUR) % 24;
    var day = function (peak) { return 0.5 + 0.5 * Math.cos((hour - peak) / 24 * 2 * Math.PI); };
    return {
      hour: hour, air: w.tmin + (w.tmax - w.tmin) * day(14.5), gnd: w.gmin + (w.gmax - w.gmin) * day(13),
      p: w.p, uv: w.uv, rate: C.RAD_RATE * (1 + 0.03 * Math.cos((hour - 16) / 24 * 2 * Math.PI))
    };
  }

  /* ================================================================== 6. Recording and saved trails */
  var recording = false;
  function startRecording() {
    if (S.mode !== 'manual') setManual();
    clearTrail(); recording = true;
    $('save-form').hidden = true; $('btn-rec').textContent = 'Stop and save'; $('btn-rec').setAttribute('aria-pressed', 'true');
    setPlaying(true);
  }
  function stopRecording(offerSave) {
    if (!recording) return;
    recording = false; setPlaying(false);
    $('btn-rec').textContent = 'Record a new trail'; $('btn-rec').setAttribute('aria-pressed', 'false');
    var st = $('rec-status');
    if (!offerSave) { st.hidden = true; return; }
    var lastPt = trail.pts[trail.pts.length - 1];
    if (Math.hypot(S.x - lastPt.x, S.y - lastPt.y) > 0.05) trail.add(S.x, S.y, S.dist, meta());   // end exactly where the walker stands
    if (trail.pts.length < 2) { st.textContent = 'Nothing to save yet: walk first, then stop.'; st.className = 'rec'; st.hidden = false; return; }
    st.hidden = true;
    $('save-name').value = 'Trail ' + (store.list().length + 1);
    $('save-form').hidden = false; $('save-name').focus(); $('save-name').select();
  }
  $('btn-rec').addEventListener('click', function () { if (recording) stopRecording(true); else startRecording(); });
  $('save-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('save-name').value.trim() || 'Trail ' + (store.list().length + 1);
    store.save(trail.toRecord(name, 'walked', settings.walker()));
    $('save-form').hidden = true; renderSaved(); say('Saved “' + name + '”.');
  });
  $('btn-discard').addEventListener('click', function () { $('save-form').hidden = true; });

  var shown = new Map();                               // saved-trail id -> lines drawn on the map
  function say(text) { var m = $('store-msg'); m.textContent = text + (store.persistent ? '' : ' This browser is not keeping saved trails between visits, so download the ones you need.'); m.hidden = false; }
  function renderSaved() {
    var ul = $('saved'); ul.innerHTML = '';
    var row = function (id, name, metaText, acts) {
      var li = document.createElement('li');
      li.innerHTML = '<strong>' + G.escapeHtml(name) + '</strong><span>' + metaText + '</span><div>' +
        acts.map(function (a) { return '<button type="button" data-act="' + a[0] + '" data-id="' + id + '">' + a[1] + '</button>'; }).join('') + '</div>';
      ul.appendChild(li);
    };
    row('curiosity', "Curiosity's drive", 'NASA, sols 4560–5073, ' + fmt(G.routeLen / 1000, 1) + ' km', [['replay', 'Replay']]);
    store.list().forEach(function (r) {
      row(r.id, r.name, (r.walker ? G.escapeHtml(r.walker.name) + (r.walker.type === 'robot' ? ' (robot)' : '') + ', ' : '') + fmt(r.distance_m) + ' m, ' + clock(r.duration_s) + ', ' + new Date(r.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        [['show', shown.has(r.id) ? 'Hide' : 'Show'], ['replay', 'Replay'], ['file', 'Download'], ['del', 'Delete']]);
    });
  }
  function toggleShown(rec) {
    if (shown.has(rec.id)) { shown.get(rec.id).forEach(function (l) { map.removeLayer(l); }); shown.delete(rec.id); return; }
    var ll = rec.points.map(function (p) { return [p[0], p[1]]; });
    var lines = [L.polyline(ll, { renderer: routeR, color: '#1A1400', weight: 6, opacity: 0.6, interactive: false }).addTo(map),
                 L.polyline(ll, { renderer: routeR, color: '#FFD23F', weight: 3, interactive: false }).addTo(map)];
    shown.set(rec.id, lines);
    setFollow(false); map.fitBounds(lines[0].getBounds(), { maxZoom: 17, padding: [40, 40] });
  }
  function download(rec) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.toText(rec)], { type: 'application/json' }));
    a.download = rec.name.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() + '.marswalk.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  $('saved').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (id === 'curiosity') { loadRoute(CURIOSITY); return; }
    var rec = store.get(id); if (!rec) { renderSaved(); return; }
    if (act === 'show') { toggleShown(rec); renderSaved(); }
    else if (act === 'replay') loadRoute(routeFromRecord(rec));
    else if (act === 'file') download(rec);
    else if (act === 'del') {
      if (b.getAttribute('data-sure')) {                // second press within 4 s deletes
        if (shown.has(id)) toggleShown(rec);
        if (route.id === id) loadRoute(CURIOSITY);
        store.remove(id); renderSaved(); say('Deleted “' + rec.name + '”.');
      } else { b.setAttribute('data-sure', '1'); b.textContent = 'Delete for good?'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-sure'); b.textContent = 'Delete'; } }, 4000); }
    }
  });
  $('btn-import').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return; this.value = '';
    var rd = new FileReader();
    rd.onload = function () {
      var rec = store.fromText(String(rd.result));
      if (!rec) { say("That file isn't a Marswalk trail. Choose a .marswalk.json file downloaded from this page."); return; }
      store.save(rec); renderSaved(); say('Imported “' + rec.name + '”.');
    };
    rd.readAsText(f);
  });

  /* ================================================================== 7. Readouts and rover view */
  var SUPER = { cooler: 'coolest', warmer: 'warmest', darker: 'darkest', brighter: 'brightest' };
  /* The active layer's value under the walker: number in the strip, tick on both bars. */
  function updateProbe() {
    var def = activeDef, box = $('probe'), pos = null, val = '…', lab = '';
    if (!def.what) { box.hidden = true; $('layer-tick').hidden = true; return; }
    if (def.key === 'topo') {
      val = (S.near.d > 25 ? '≈ ' : '') + minus(S.near.z, 1) + ' m'; lab = "height here, from Curiosity's survey";
    } else {
      var ll = toLL(S.x, S.y), s = dataLayer && dataLayer.sample(ll[0], ll[1]);
      lab = def.what + ' here';
      if (s && s.nodata) val = 'no data';
      else if (s && def.read === 'rgb') {
        pos = s.value; val = s.rgb.map(function (v) { return Math.round(v * 100); }).join(' / ');
        lab = 'roughness here over long, medium and short distances: 0 smooth, 100 rough';
      } else if (s && def.stretch) {
        pos = s.view; val = Math.round(pos * 100) + ' of 100';
        lab = def.what + ' here: 0 is the ' + (SUPER[def.ends[0]] || def.ends[0]) + ' ground in view, 100 the ' + (SUPER[def.ends[1]] || def.ends[1]);
      } else if (s) {
        pos = s.value; val = Math.round(pos * 100) + ' of 100';
        lab = def.what + " here on NASA's map scale: 0 " + def.ends[0] + ', 100 ' + def.ends[1];
      }
    }
    box.hidden = false; $('p-val').textContent = val; $('p-lab').textContent = lab;
    $('p-bar').hidden = pos === null; $('layer-tick').hidden = pos === null;
    if (pos !== null) $('p-tick').style.left = $('layer-tick').style.left = (pos * 100).toFixed(1) + '%';
  }

  var UV = ['', 'low', 'moderate', 'high', 'very high'];
  function updateReadouts() {
    nearestOnRoute();
    var c = conditions(), off = S.near.d > 25;
    var exact = settings.get('display') === 'robot', ll = toLL(S.x, S.y);   // Robot display: full precision
    $('r-pos').textContent = exact ? 'E ' + S.x.toFixed(2) + ' m, N ' + S.y.toFixed(2) + ' m' : 'E ' + G.signed(S.x) + ' m, N ' + G.signed(S.y) + ' m';
    $('r-ll').textContent = ll[0].toFixed(6) + '°, ' + ll[1].toFixed(6) + '°';
    $('r-z').textContent = (off ? '≈ ' : '') + minus(S.near.z, 1) + ' m';
    $('r-z-l').textContent = off ? 'height of nearest route point' : 'height, MOLA datum';
    $('r-hdg').textContent = exact ? norm(S.heading).toFixed(1) + '°' : String(Math.round(norm(S.heading)) % 360).padStart(3, '0') + '° ' + compass(S.heading);
    $('r-dist').textContent = exact ? S.dist.toFixed(1) + ' m' : fmt(S.dist) + ' m';
    if (showBack) { $('r-home').textContent = fmt(MW.Trail.pathLength(trail.wayBack())) + ' m'; $('r-home-l').textContent = 'back to the trail start along your trail'; }
    else { $('r-home').textContent = fmt(Math.hypot(S.x, S.y)) + ' m'; $('r-home-l').textContent = 'straight back to base'; }
    $('r-time').textContent = exact ? Math.round(S.t) + ' s' : clock(S.t);
    $('r-time-l').textContent = 'on the surface, ' + String(Math.floor(c.hour)).padStart(2, '0') + ':' + String(Math.floor(c.hour % 1 * 60)).padStart(2, '0') + ' local';
    $('e-air').textContent = minus(c.air) + ' °C';
    $('e-gnd').textContent = minus(c.gnd) + ' °C';
    $('e-p').textContent = c.p + ' Pa';
    $('e-uv').textContent = UV[c.uv] || '–';
    $('e-rad').textContent = fmt(c.rate, 1) + ' µSv/h';
    $('e-dose').textContent = fmt(S.dose, 1) + ' µSv';
    var w = WP[S.near.i];
    $('e-src').textContent = 'Weather: Curiosity REMS low and high for sol ' + w.sol + (w.wxMeasured ? '' : ' (last sol in the feed)') +
      ', with the hourly curve modelled. Radiation: modelled from the RAD surface average, 0.67 mSv a day.';
    if (recording) { var st = $('rec-status'); st.textContent = 'Recording: ' + fmt(S.dist) + ' m, ' + clock(S.t); st.className = 'rec on'; st.hidden = false; }
    updateProbe(); drawProfile();
  }

  /* Rover view: the nearest Curiosity Navcam photo. */
  function showPov(i) {
    var k = i, step = 0;
    while (!WP[k] || !WP[k].pov) { step++; k = i + (step % 2 ? 1 : -1) * Math.ceil(step / 2); if (step > 12) return; }
    var w = WP[k], url = 'https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/' + String(w.sol).padStart(5, '0') + '/opgs/edr/ncam/NLB_' + w.pov + '_.JPG';
    var img = $('pov-img');
    img.alt = 'Curiosity Navcam photo of the ground at this stop, sol ' + w.sol;
    img.onerror = function () { $('pov-sub').textContent = "The photo didn't load. Check the connection to mars.nasa.gov."; };
    img.src = url;
    $('pov-title').textContent = 'What you will see here';
    $('pov-sub').textContent = 'Curiosity left Navcam, sol ' + w.sol + ', ' + fmt(Math.hypot(w.x - S.x, w.y - S.y)) + ' m from you';
    $('pov-link').href = url;
    $('pov').hidden = false; $('pov-open').hidden = true;
  }
  $('pov-close').addEventListener('click', function () { $('pov').hidden = true; $('pov-open').hidden = false; });
  $('pov-open').addEventListener('click', function () { showPov(S.near.i); });

  /* Height along the reference route, with the walker's place on it. */
  var prof = $('profile'), pg = prof.getContext('2d'), look = { fill: '#ccc', ink: '#000', ink2: '#444' };
  function drawProfile() {
    var W = prof.width, H = prof.height, pad = 16, zs = WP.map(function (w) { return w.z; });
    var lo = Math.min.apply(null, zs), hi = Math.max.apply(null, zs);
    var X = function (s) { return pad + s / G.routeLen * (W - 2 * pad); }, Y = function (z) { return H - pad - (z - lo) / (hi - lo) * (H - 2 * pad - 14); };
    pg.clearRect(0, 0, W, H);
    pg.beginPath(); pg.moveTo(X(0), H - pad);
    WP.forEach(function (w) { pg.lineTo(X(w.s), Y(w.z)); });
    pg.lineTo(X(G.routeLen), H - pad); pg.closePath(); pg.fillStyle = look.fill; pg.fill();
    pg.beginPath(); WP.forEach(function (w, i) { pg[i ? 'lineTo' : 'moveTo'](X(w.s), Y(w.z)); });
    pg.strokeStyle = look.ink; pg.lineWidth = 2.5; pg.stroke();
    pg.fillStyle = look.ink2; pg.font = '500 20px "Barlow Semi Condensed", Arial, sans-serif';
    pg.textAlign = 'left'; pg.fillText(minus(lo) + ' m', pad, 22);
    pg.textAlign = 'right'; pg.fillText(minus(hi) + ' m, ' + fmt(G.routeLen / 1000, 1) + ' km', W - pad, 22);
    var x = X(S.near.s), y = Y(S.near.z);
    pg.beginPath(); pg.moveTo(x, H - pad); pg.lineTo(x, y); pg.strokeStyle = '#0B5FFF'; pg.lineWidth = 2; pg.stroke();
    pg.beginPath(); pg.arc(x, y, 7, 0, 7); pg.fillStyle = '#0B5FFF'; pg.fill(); pg.strokeStyle = '#fff'; pg.lineWidth = 2.5; pg.stroke();
  }

  function updateScale() {
    var mpp = G.metresPerPixel(map.getZoom()), want = mpp * 130;
    var p = Math.pow(10, Math.floor(Math.log10(want))), n = want / p, len = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
    $('scale').firstElementChild.style.width = (len / mpp) + 'px';
    $('scale').lastElementChild.textContent = len >= 1000 ? fmt(len / 1000) + ' km' : fmt(len) + ' m';
  }
  map.on('zoomend', updateScale); updateScale();
  if (window.ResizeObserver) new ResizeObserver(function () { map.invalidateSize({ pan: false }); }).observe($('map'));   // the margins can reflow

  /* ================================================================== 8. Controls and the main loop */
  function setPlaying(p) {
    S.playing = p;
    $('btn-play').textContent = p ? 'Pause'
      : S.mode === 'replay' && atRouteEnd() ? 'Replay from the start'
      : S.dist === 0 ? 'Start' : 'Resume';
  }
  function showMode() {
    $('mode-replay').setAttribute('aria-pressed', S.mode === 'replay'); $('mode-manual').setAttribute('aria-pressed', S.mode === 'manual');
    $('mode-replay').textContent = route === CURIOSITY ? "Replay Curiosity's drive" : 'Replay “' + route.name + '”';
    $('pad').hidden = S.mode !== 'manual';
  }
  function setManual() { S.mode = 'manual'; target = null; showMode(); setPlaying(false); }
  $('mode-replay').addEventListener('click', function () { if (S.mode !== 'replay') loadRoute(route); });
  $('mode-manual').addEventListener('click', function () { if (S.mode !== 'manual') setManual(); });
  $('btn-play').addEventListener('click', function () {
    if (!S.playing && S.mode === 'replay' && atRouteEnd()) loadRoute(route);
    setPlaying(!S.playing);
  });
  $('speed').addEventListener('change', function (e) { S.factor = +e.target.value; });
  function setFollow(f) { S.follow = f; $('btn-follow').setAttribute('aria-pressed', f); }
  $('btn-follow').addEventListener('click', function () { setFollow(!S.follow); if (S.follow) map.panTo(toLL(S.x, S.y)); });
  map.on('dragstart', function () { setFollow(false); });
  $('z-walk').addEventListener('click', function () { setFollow(true); map.setView(toLL(S.x, S.y), 16); });
  $('z-crater').addEventListener('click', function () { setFollow(false); map.setView([-5.1, 137.8], 7); });
  $('z-planet').addEventListener('click', function () { setFollow(false); map.setView([0, 137.4], 1.5); });
  $('z-in').addEventListener('click', function () { map.zoomIn(1); });
  $('z-out').addEventListener('click', function () { map.zoomOut(1); });
  $('btn-clear').addEventListener('click', function () { stopRecording(false); clearTrail(); setPlaying(false); });
  $('btn-back').addEventListener('click', function () {
    showBack = !showBack; this.setAttribute('aria-pressed', showBack); this.textContent = showBack ? 'Hide way back' : 'Show way back';
    drawTrail();
  });
  /* Legend column. Wide screens (Planner, Robot): the tab on its edge folds it away, remembered between
     visits. Narrow screens and the Astronaut display: it is a drawer, opened by "Layers", closed by × or Escape. */
  var COLLAR_KEY = 'marswalk.collarHidden';
  function setCollarHidden(hid) {
    $('app').classList.toggle('collar-hidden', hid);
    var t = $('collar-tab'), lab = hid ? 'Show panel' : 'Hide panel';
    t.setAttribute('aria-expanded', !hid); t.setAttribute('aria-label', lab); t.title = lab;
  }
  try { setCollarHidden(window.localStorage.getItem(COLLAR_KEY) === '1'); } catch (e) { setCollarHidden(false); }
  $('collar-tab').addEventListener('click', function () {
    var hid = !$('app').classList.contains('collar-hidden');
    setCollarHidden(hid);
    try { window.localStorage.setItem(COLLAR_KEY, hid ? '1' : '0'); } catch (e) {}
  });
  function setDrawer(open) { $('collar').classList.toggle('open', open); $('btn-collar').setAttribute('aria-expanded', open); }
  $('btn-collar').addEventListener('click', function () { setDrawer(!$('collar').classList.contains('open')); });
  function closeDrawer() { if ($('collar').classList.contains('open')) { setDrawer(false); $('btn-collar').focus(); } }
  $('collar-close').addEventListener('click', closeDrawer);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  /* The legend column has four parts. The buttons at its bottom choose which one is shown; Menu is shown first. */
  function setTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('#collar > [data-tab]'), function (s) { s.hidden = s.getAttribute('data-tab') !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tab-btn') === name); });
    $('collar').scrollTop = 0; closeInfo();
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab-btn]'); if (b) setTab(b.getAttribute('data-tab-btn')); });

  /* (i) buttons: any button.info with data-info="key" opens the matching GLOSSARY entry (config.js) in one shared pop-up. */
  var infoBtn = null;
  function closeInfo() { $('info-pop').hidden = true; if (infoBtn) infoBtn.setAttribute('aria-expanded', 'false'); infoBtn = null; }
  function openInfo(b) {
    var g = C.GLOSSARY[b.getAttribute('data-info')], pop = $('info-pop'); if (!g) return;
    pop.innerHTML = '<button type="button" id="info-close" aria-label="Close explanation">×</button><h4>' + g.term + '</h4><p>' + g.what + '</p>' +
      '<p><b>Why it matters.</b> ' + g.why + '</p><p class="basis"><b>Where it comes from.</b> ' + g.basis + '</p>';
    pop.hidden = false; infoBtn = b; b.setAttribute('aria-expanded', 'true');
    var r = b.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;     // beside the button, kept on screen
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 12)) + 'px';
    pop.style.top = (r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button.info');
    if (b) { e.preventDefault(); if (infoBtn === b) closeInfo(); else { closeInfo(); openInfo(b); } return; }
    if (!$('info-pop').hidden && (e.target.id === 'info-close' || !e.target.closest('#info-pop'))) closeInfo();
  });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && infoBtn) { var b = infoBtn; closeInfo(); if (b.isConnected) b.focus(); } });
  window.addEventListener('resize', closeInfo);
  $('collar').addEventListener('scroll', closeInfo);

  var KEYMAP = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowDown: 'back', s: 'back', S: 'back', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
  window.addEventListener('keydown', function (e) {
    var k = KEYMAP[e.key]; if (!k || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (settings.get('move') === 'click') return;        // Settings: taps only
    if (S.mode !== 'manual') setManual();
    keys[k] = true; if (!S.playing) setPlaying(true); e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { var k = KEYMAP[e.key]; if (k) keys[k] = false; });
  window.addEventListener('blur', function () { keys.fwd = keys.back = keys.left = keys.right = false; });
  Array.prototype.forEach.call(document.querySelectorAll('#pad button'), function (b) {
    var k = b.getAttribute('data-k');
    b.addEventListener('pointerdown', function (e) { keys[k] = true; if (!S.playing) setPlaying(true); b.setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { b.addEventListener(ev, function () { keys[k] = false; }); });
  });
  map.on('click', function (e) {
    if (inspectTrail(e.latlng)) return;
    if (MW.dustUI && MW.dustUI.inspect(e.latlng)) return;   // dust layer on and zoomed out: the tap reads that dust cell (js/dust-ui.js)
    if (S.mode === 'manual' && settings.get('move') !== 'keys') { target = toENU(e.latlng.lat, e.latlng.lng); setPlaying(true); }   // Settings: keys only switches this off
  });

  var lastTs = 0, lastUi = 0, lastDraw = 0, lastPan = 0, drawn = { x: NaN, y: NaN, h: NaN }, meRot = null;
  function frame(ts) {
    var dt = Math.min(0.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
    if (S.playing) {
      if (!S.external) { if (S.mode === 'replay') stepReplay(dt); else stepManual(dt); }
      var simDt = dt * S.factor; S.t += simDt; S.dose += conditions().rate * simDt / 3600;
    }
    if (S.x !== drawn.x || S.y !== drawn.y) {
      me.setLatLng(toLL(S.x, S.y)); drawn.x = S.x; drawn.y = S.y;
      if (S.follow) {                                  // keep the walker inside the middle of the view
        var p = map.latLngToContainerPoint(toLL(S.x, S.y)), sz = map.getSize();
        if (ts - lastPan > 800 && (p.x < sz.x * 0.3 || p.x > sz.x * 0.7 || p.y < sz.y * 0.3 || p.y > sz.y * 0.7)) { lastPan = ts; map.panTo(toLL(S.x, S.y), { animate: true, duration: 0.6 }); }
      }
    }
    if (S.heading !== drawn.h) {
      meRot = meRot || document.getElementById('me-rot');
      if (meRot) { meRot.setAttribute('transform', 'rotate(' + S.heading.toFixed(1) + ')'); drawn.h = S.heading; }
    }
    if (trail.dirty && ts - lastDraw > 120) { drawTrail(); lastDraw = ts; }
    if (ts - lastUi > 200) { updateReadouts(); lastUi = ts; }
    requestAnimationFrame(frame);
  }

  /* Settings changed (or first run): restyle what CSS variables cannot reach. */
  function applySettings() {
    var cs = getComputedStyle(document.body);
    look = { fill: cs.getPropertyValue('--paper-2').trim(), ink: cs.getPropertyValue('--ink').trim(), ink2: cs.getPropertyValue('--ink-2').trim() };
    styleTrail();
    var mv = settings.get('move');
    $('pad-hint').textContent = mv === 'keys' ? 'W A S D or arrow keys.' : 'W A S D or arrow keys. Tap the map to walk to a spot.';
    if (mv === 'keys') target = null;
    renderSaved();
    setTimeout(function () { map.invalidateSize({ pan: false }); }, 0);   // a display mode can change the map's size
  }
  settings.onChange(applySettings);

  /* ---- start: pointer standing still at base, waiting for Start ---- */
  applySettings();
  setDataLayer('none');
  trail.add(0, 0, 0, meta());
  showMode(); setPlaying(false);
  if (window.innerWidth > 860) showPov(0); else $('pov-open').hidden = false;   // small screens keep the map clear
  requestAnimationFrame(frame);

  /* Hook for real hardware: feed position fixes (IMU, visual odometry, orbital relay) and look direction. */
  window.Marswalk = {
    setPose: function (p) {
      S.external = true;
      if (typeof p.heading === 'number') S.heading = norm(p.heading);
      if (typeof p.lat === 'number' && typeof p.lon === 'number') { var e = toENU(p.lat, p.lon); setPos(e.x, e.y); }
    },
    releasePose: function () { S.external = false; },
    getTrail: function () { return trail.toRecord('live', 'live', settings.walker()); },
    clearTrail: clearTrail,
    savedTrails: function () { return store.list(); },
    _state: S, _map: map, _trail: trail, _waypoints: WP, _layer: function () { return dataLayer; },
    _route: function () { return route; },               // the route being replayed; dust-ui.js checks the dust along it
    setTab: setTab                                       // 'menu', 'overlay', 'dust' or 'time': show that part of the legend column
  };
})();
