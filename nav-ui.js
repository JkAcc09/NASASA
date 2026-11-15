/* nav-ui.js — the "Markers and routes" part of the legend column, and what it draws on the map.
 * The data is in markers.js and the route-finding in router.js; this file only shows them and listens.
 *
 * Sections:  1. State and helpers          5. Route search, results and the lines on the map
 *            2. Markers on the map         6. The live safety index and its alarm
 *            3. The marker form and icons  7. Wiring and start
 *            4. Marker list and the filter
 *
 * Loads after app.js and dust-ui.js and reaches the map through window.Marswalk.
 *   MW.navUI.mapClick(latlng)        app.js asks this first on every tap: true means the tap was used here
 *   MW.navUI.routeTo({ lat, lon, name })   work out routes to a point
 *   MW.navUI.safetyAt(lat, lon, seconds)   the live safety index at a spot, that many seconds from now
 *   MW.navUI.live()                        the latest live reading for the walker: { index, factors, worst, … }
 */
(function () {
  'use strict';
  var C = MW.config, K = C.ROUTER, G = MW.geo, $ = G.$, MK = MW.markers, RT = MW.router, T = MW.terrain, store = MW.store, settings = MW.settings;
  var app = window.Marswalk, map = app._map, esc = G.escapeHtml, icon = MW.ui.icon;

  /* ================================================================== 1. State and helpers */
  var mode = null;                 // null, 'place' (the next tap places a marker) or 'dest' (the next tap is the destination)
  var editing = null;              // the marker in the form: { id, lat, lon, icon, by, createdAt }
  var draft = null;                // its pin on the map while the form is open
  var plan = null;                 // { to, result, sel }: the routes on show

  function us() { return settings.get('units') === 'us'; }
  function dist(m) {
    if (!us()) return RT.format.dist(m);
    var ft = m * 3.28084;
    return ft >= 5280 ? G.fmt(ft / 5280, ft >= 52800 ? 0 : 1) + ' mi' : G.fmt(ft >= 100 ? Math.round(ft / 10) * 10 : Math.round(ft)) + ' ft';
  }
  function drop(c) { return us() ? Math.round(c * 1.8) + ' °F' : Math.round(c) + ' °C'; }
  function height(z) { return us() ? G.minus(z * 3.28084) + ' ft' : G.minus(z) + ' m'; }
  function llText(lat, lon) { return Math.abs(lat).toFixed(4) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(4) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function here() { var s = app._state, p = G.toLL(s.x, s.y); return { lat: p[0], lon: p[1] }; }
  function hourNow() { return (C.START_HOUR + app._state.t / C.MARS_HOUR) % 24; }
  function fromHere(lat, lon) { return RT.haversine(here(), { lat: lat, lon: lon }); }
  function nb(t) { return esc(t).replace(/(\d) (m|km|ft|mi|°C|°F|h|min|%|sols?)(?![a-z])/g, '$1\u00a0$2'); }      // a number never parts from its unit at a line end
  function say(id, text) { var m = $(id); m.textContent = text || ''; m.hidden = !text; }
  function setMode(m) {
    mode = m;
    $('mk-add').setAttribute('aria-pressed', m === 'place'); $('rt-pick').setAttribute('aria-pressed', m === 'dest'); $('mk-hint').hidden = m !== 'place';
    map.getContainer().classList.toggle('picking', !!m);
    var h = $('pick-hint');
    h.innerHTML = m ? (m === 'place' ? 'Tap the map to place the marker.' : 'Tap the map, or a marker, to set the destination.') + ' <button type="button" id="pick-cancel">Cancel</button>' : '';
    h.hidden = !m;
    if (m && app.closeDrawer) app.closeDrawer();            // narrow screens: get the panel out of the way of the map
  }

  /* ================================================================== 2. Markers on the map */
  map.createPane('plan').style.zIndex = 415;      // planned routes: above saved trails, below the live trail
  map.getPane('plan').style.pointerEvents = 'none';
  var planR = L.canvas({ pane: 'plan', padding: 0.3 }), planLayer = L.layerGroup().addTo(map), badgeLayer = L.layerGroup().addTo(map);
  var zoneLayer = L.layerGroup().addTo(map), markerLayer = L.layerGroup().addTo(map);
  var EARTH_R = 6378137;                           // Leaflet sizes a circle for Earth; this puts it right for Mars

  function markerIcon(m, cls) {
    return L.divIcon({ className: 'mk' + (cls ? ' ' + cls : ''), html: MK.badge(m.icon) + (m.name ? '<span class="mk-name">' + esc(m.name) + '</span>' : ''), iconSize: [36, 46], iconAnchor: [18, 45] });
  }
  function drawMarkers() {
    var f = MK.filter.get();
    markerLayer.clearLayers(); zoneLayer.clearLayers();
    MK.list().forEach(function (m) {
      if (!MK.filter.shows(m, f) || (editing && editing.id === m.id)) return;
      if (m.icon === 'danger') {
        L.circle([m.lat, m.lon], { renderer: planR, radius: m.radius * EARTH_R / C.R_MARS, color: '#D7263D', weight: 2, dashArray: '6 5', fillColor: '#D7263D', fillOpacity: 0.14, interactive: false }).addTo(zoneLayer);
      }
      var mk = L.marker([m.lat, m.lon], { icon: markerIcon(m), title: m.name, alt: m.name, keyboard: true, zIndexOffset: 600 });
      mk.on('click', function (e) {
        L.DomEvent.stop(e);
        if (mode === 'dest') { setMode(null); routeTo({ lat: m.lat, lon: m.lon, name: m.name, markerId: m.id }); }
        else if (mode === 'place') mapClick(e.latlng);
        else openMarker(m);
      });
      markerLayer.addLayer(mk);
    });
    if (app._landmarks) app._landmarks.setVisible(f.places);
  }
  function openMarker(m) {
    var d = fromHere(m.lat, m.lon), z = T.ready ? T.heightAt(m.lat, m.lon) : null;
    var html = '<div class="pop mkp"><h3>' + MK.art(m.icon) + '<span>' + esc(m.name) + '</span></h3>' + (m.note ? '<div class="mk-text">' + MK.render(m.note) + '</div>' : '') + '<dl>' +
      '<dt>Position</dt><dd>' + llText(m.lat, m.lon) + '</dd>' +
      (z !== null ? '<dt>Height</dt><dd>about ' + height(z) + ' <span class="dsub">regional, from the MOLA shape model</span></dd>' : '') +
      '<dt>From the walker</dt><dd>' + dist(d) + ' in a straight line</dd>' +
      (m.icon === 'danger' ? '<dt>Keep clear</dt><dd>' + dist(m.radius) + ': routes stay outside it</dd>' : '') +
      (m.icon === 'home' ? '<dt>Counts as</dt><dd>a base, for the route safety index</dd>' : '') +
      (m.by ? '<dt>Placed by</dt><dd>' + esc(m.by) + '</dd>' : '') + '</dl>' +
      '<div class="row"><button type="button" data-mk="route" data-id="' + m.id + '">Route here</button><button type="button" data-mk="edit" data-id="' + m.id + '">Edit</button></div></div>';
    L.popup({ maxWidth: 300, className: 'mk-pop', offset: [0, -36] }).setLatLng([m.lat, m.lon]).setContent(html).openOn(map);
  }
  document.addEventListener('click', function (e) {        // capture phase: Leaflet popups swallow clicks
    var b = e.target.closest && e.target.closest('[data-mk]'); if (!b || !b.closest('.leaflet-popup')) return;
    var m = MK.get(b.getAttribute('data-id')); map.closePopup(); if (!m) return;
    if (b.getAttribute('data-mk') === 'route') { app.openTab('nav'); routeTo({ lat: m.lat, lon: m.lon, name: m.name, markerId: m.id }); }
    else openForm(m);
  }, true);

  /* ================================================================== 3. The marker form and icons */
  function openForm(m) {
    setMode(null); map.closePopup();
    editing = { id: m.id || null, lat: m.lat, lon: m.lon, icon: MK.icons.valid(m.icon || 'pin'), by: m.by || null, createdAt: m.createdAt || null };
    $('mk-name').value = m.name || ''; $('mk-note').value = m.note || ''; $('mk-radius').value = m.radius || K.DANGER_RADIUS;
    $('mk-form').hidden = false; say('mk-msg', '');
    drawIcons(); drawDraft(); drawMarkers(); showWhere();
    app.openTab('nav'); $('mk-form').scrollIntoView({ block: 'nearest' }); $('mk-name').focus();
    $('mk-name').placeholder = m.id ? m.name : 'Marker ' + (MK.list().length + 1);
  }
  function closeForm() {
    editing = null; $('mk-form').hidden = true;
    if (draft) { map.removeLayer(draft); draft = null; }
    drawMarkers();
  }
  function drawDraft() {
    if (draft) map.removeLayer(draft);
    draft = L.marker([editing.lat, editing.lon], { icon: markerIcon({ icon: editing.icon, name: '' }, 'mk-draft'), draggable: true, keyboard: false, zIndexOffset: 900 }).addTo(map);
    draft.on('dragend', function () { var p = draft.getLatLng(); editing.lat = Math.max(-90, Math.min(90, p.lat)); editing.lon = p.lng; showWhere(); });
  }
  function showWhere() {
    var z = T.ready ? T.heightAt(editing.lat, editing.lon) : null;
    $('mk-where').textContent = llText(editing.lat, editing.lon) + (z !== null ? ', about ' + height(z) + ' (regional)' : '') + ', ' + dist(fromHere(editing.lat, editing.lon)) + ' from the walker. Drag the pin on the map to move it.';
  }
  /* The picker: the four built-in icons, then the + that uploads a picture, then the pictures already uploaded. */
  function drawIcons() {
    var box = $('mk-icons'), html = '';
    var one = function (key, name, custom) {
      return '<button type="button" class="mk-ic' + (custom ? ' own' : '') + '" role="radio" aria-checked="' + (editing.icon === key) + '" data-icon-key="' + key + '" aria-label="' + esc(name) + '" data-tip="' + esc(name) + '"' +
        (custom ? '' : ' style="--mk:' + MK.icons.colour(key) + '"') + '>' + MK.art(key) + '</button>';
    };
    Object.keys(C.MARKER_ICONS).forEach(function (k) { html += one(k, C.MARKER_ICONS[k].name, false); });
    html += '<button type="button" id="mk-upload" class="mk-ic add" aria-label="Add your own icon: upload a picture" data-tip="Add your own icon: upload a picture">' + icon('plus') + '</button>';
    MK.icons.custom().forEach(function (c) { html += one('c:' + c.id, c.name, true); });
    box.innerHTML = html;
    var own = MK.icons.isCustom(editing.icon), role = C.MARKER_ICONS[editing.icon];
    $('mk-role').innerHTML = own ? esc(MK.icons.name(editing.icon)) + ': your own icon. <button type="button" id="mk-icon-del" class="link">Remove this icon</button>' : esc(role.name + '. ' + role.role);
    $('mk-radius-row').hidden = editing.icon !== 'danger';
  }
  function pickIcon(key) { editing.icon = MK.icons.valid(key); drawIcons(); drawDraft(); }
  /* An uploaded picture is drawn into a small square PNG, so it is safe to show and small enough to keep. */
  function upload(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { say('mk-msg', 'That file is not a picture. Choose a PNG, JPEG, GIF, WebP or SVG image.'); return; }
    if (file.size > 12 * 1024 * 1024) { say('mk-msg', 'That picture is larger than 12 MB. Choose a smaller one.'); return; }
    var rd = new FileReader();
    rd.onerror = function () { say('mk-msg', "The picture couldn't be read. Try another file."); };
    rd.onload = function () {
      var im = new Image();
      im.onerror = function () { say('mk-msg', "The browser can't show that picture. Try a PNG or JPEG."); };
      im.onload = function () {
        var px = C.MARKER_ICON_PX, cv = document.createElement('canvas'), w = im.naturalWidth || px, h = im.naturalHeight || px, k = Math.min(px / w, px / h);
        cv.width = cv.height = px;
        var g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(im, (px - w * k) / 2, (px - h * k) / 2, w * k, h * k);                    // the whole picture, centred, never stretched
        var r = MK.icons.add(cv.toDataURL('image/png'), file.name);
        if (r.error) { say('mk-msg', r.error); return; }
        say('mk-msg', r.persistent ? 'Icon added. It is kept in this browser for your other markers.' : 'Icon added for this visit. This browser is not keeping it between visits.');
        if (editing) pickIcon(r.icon);
      };
      im.src = String(rd.result);
    };
    rd.readAsDataURL(file);
  }

  /* ================================================================== 4. Marker list and the filter */
  function renderList() {
    var ul = $('mk-list'), f = MK.filter.get(), l = MK.list();
    if (!l.length) { ul.innerHTML = '<li class="none">No markers yet. Press + and tap the map, or right-click (long-press) the map.</li>'; return; }
    ul.innerHTML = l.map(function (m) {
      var hid = !!f.hidden[m.id], off = !hid && !MK.filter.shows(m, f);
      var act = function (a, ic, label, extra) { return '<button type="button" class="ib sm" data-act="' + a + '" data-id="' + m.id + '" aria-label="' + label + '" data-tip="' + label + '"' + (extra || '') + '>' + icon(ic) + '</button>'; };
      return '<li' + (hid || off ? ' class="off"' : '') + '><span class="mk-li-ic"' + (MK.icons.isCustom(m.icon) ? '' : ' style="--mk:' + MK.icons.colour(m.icon) + '"') + '>' + MK.art(m.icon) + '</span>' +
        '<strong>' + esc(m.name) + '</strong><span data-d="' + m.lat + ',' + m.lon + '">' + dist(fromHere(m.lat, m.lon)) + ' away' + (off ? ', hidden by the filter' : '') + '</span><div>' +
        act('route', 'route', 'Find a route here') + act('centre', 'centre', 'Show on the map') +
        act('eye', hid ? 'eyeoff' : 'eye', hid ? 'Hidden: show this marker' : 'Hide this marker', ' aria-pressed="' + !hid + '"') + act('edit', 'edit', 'Edit') + act('del', 'trash', 'Delete') + '</div></li>';
    }).join('');
  }
  function renderFilter() {
    var f = MK.filter.get(), l = MK.list(), count = function (test) { return l.filter(test).length; }, html = '';
    var row = function (key, art, name, on, n, style) {
      return '<label class="check"><input type="checkbox" data-f="' + key + '"' + (on ? ' checked' : '') + '><span class="mk-f"' + (style || '') + '>' + art + esc(name) + '</span><span class="res">' + n + '</span></label>';
    };
    Object.keys(C.MARKER_ICONS).forEach(function (k) {
      html += row('i:' + k, MK.art(k), C.MARKER_ICONS[k].name + ' markers', f.icons[k], count(function (m) { return m.icon === k; }), ' style="--mk:' + MK.icons.colour(k) + '"');
    });
    html += row('custom', icon('plus'), 'Markers with my own icons', f.custom, count(function (m) { return MK.icons.isCustom(m.icon); }));
    html += row('places', icon('globe'), 'NASA place names', f.places, MW.landmarks.list.length);
    $('mk-filter').innerHTML = html; $('mk-all').disabled = MK.filter.allOn();
  }

  /* ================================================================== 5. Route search, results and the lines on the map */
  /* --- the search bar: markers first, then named places, or a typed latitude and longitude --- */
  var sug = [], sugAt = -1;
  function parseLL(t) {
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(t); if (!m) return null;
    var lat = +m[1] * (/s/i.test(m[2] || '') ? -1 : 1), lon = +m[3] * (/w/i.test(m[4] || '') ? -1 : 1);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
    lon = ((lon + 540) % 360) - 180;
    return { lat: lat, lon: lon, name: llText(lat, lon), kind: 'Point' };
  }
  function suggest(text) {
    var t = text.trim().toLowerCase(), out = [], p = parseLL(text);
    if (p) out.push(p);
    MK.list().forEach(function (m) { if (!t || m.name.toLowerCase().indexOf(t) >= 0) out.push({ lat: m.lat, lon: m.lon, name: m.name, markerId: m.id, kind: MK.icons.name(m.icon) + ' marker', art: MK.art(m.icon), colour: MK.icons.colour(m.icon), d: fromHere(m.lat, m.lon) }); });
    var places = [];
    MW.landmarks.list.forEach(function (lm) { if (t ? lm.name.toLowerCase().indexOf(t) >= 0 : true) places.push({ lat: lm.at[0], lon: lm.at[1], name: lm.name, kind: lm.role, d: fromHere(lm.at[0], lm.at[1]) }); });
    places.sort(function (a, b) { return a.d - b.d; });
    return out.concat(places).slice(0, 8);
  }
  function showSug() {
    var box = $('rt-sug'); sug = suggest($('rt-q').value); sugAt = -1;
    box.innerHTML = sug.length ? sug.map(function (s, i) {
      return '<li role="option" id="rt-s' + i + '" data-i="' + i + '"><span class="mk-li-ic"' + (s.colour ? ' style="--mk:' + s.colour + '"' : '') + '>' + (s.art || icon(s.markerId ? 'pin' : s.kind === 'Point' ? 'target' : 'globe')) + '</span><b>' + esc(s.name) + '</b><span>' + esc(s.kind) + (s.d !== undefined ? ', ' + dist(s.d) : '') + '</span></li>';
    }).join('') : '<li class="none">Nothing by that name. Type a latitude and longitude, such as −4.82, 137.40, or tap the target and then the map.</li>';
    box.hidden = false; $('rt-q').setAttribute('aria-expanded', 'true');
  }
  function hideSug() { $('rt-sug').hidden = true; $('rt-q').setAttribute('aria-expanded', 'false'); $('rt-q').removeAttribute('aria-activedescendant'); }
  function moveSug(d) {
    if ($('rt-sug').hidden) { showSug(); return; }
    if (!sug.length) return;
    sugAt = (sugAt + d + sug.length) % sug.length;
    Array.prototype.forEach.call($('rt-sug').children, function (li, i) { li.classList.toggle('on', i === sugAt); });
    $('rt-q').setAttribute('aria-activedescendant', 'rt-s' + sugAt);
  }

  /* --- the question put to router.js: everything the page knows at this moment --- */
  function dustState() {
    var D = MW.dust, st = MW.dustUI && MW.dustUI.state;
    if (!D || !D.pack || !st || st.my === null || st.my === undefined) return null;
    var y = D.year(st.my), when = 'MY' + st.my + ', Ls ' + Math.round(y.ls[st.frame]) + '°';
    return { ls: y.ls[st.frame], when: when, at: function (lat, lon) { var a = D.assess(st.my, st.frame, D.cellAt(lat, lon).c); return a ? { cls: a.cls, trend: a.trend, tau: a.tau, when: when } : null; } };
  }
  var setting = null;              // bases, hazards and known trails: worked out once, thrown away when a marker or a trail changes
  function surroundings() {
    if (setting) return setting;
    var pref = store.preferred(), ms = MK.list();
    var known = [{ id: 'curiosity', name: "Curiosity's drive", points: app._waypoints.map(function (p) { return [p.lat, p.lon]; }), preferred: pref === 'curiosity' }];
    store.list().forEach(function (r) { if (r.points.length > 1) known.push({ id: r.id, name: r.name, points: r.points, preferred: pref === r.id }); });
    setting = {
      known: known,
      bases: [{ lat: G.ORIGIN.lat, lon: G.ORIGIN.lon, name: 'Base' }].concat(ms.filter(function (m) { return m.icon === 'home'; }).map(function (m) { return { lat: m.lat, lon: m.lon, name: m.name }; })),
      hazards: ms.filter(function (m) { return m.icon === 'danger'; }).map(function (m) { return { lat: m.lat, lon: m.lon, radius: m.radius, name: m.name }; }),
      zones: MW.landmarks.list.filter(function (l) { return /^Hazard/.test(l.role) && l.outline; }).map(function (l) { return { name: l.name, role: l.role, outline: l.outline }; })
    };
    return setting;
  }
  function wxNear(lat, lon) { return RT.haversine({ lat: lat, lon: lon }, { lat: G.GALE.lat, lon: G.GALE.lon }) <= K.WX_RADIUS ? app._waypoints[app._state.near.i].wx : null; }   // REMS is at Gale, wherever the base is
  function question(to) {
    var w = settings.walker(), sel = $('rt-hour').value, dust = dustState(), c = surroundings(), from = here();
    var live = app._trail.pts, known = live.length > 3 ? c.known.concat([{ id: 'live', name: 'This walk', points: live.map(function (p) { return p.ll; }), preferred: false }]) : c.known;
    return {
      from: from, to: to, walker: w.type === 'robot' ? 'robot' : 'astronaut', hour: sel === 'now' ? hourNow() : +sel, ls: dust ? dust.ls : null,
      wx: wxNear(from.lat, from.lon), height: T.ready ? T.heightAt : null, dust: dust ? dust.at : null,
      bases: c.bases, hazards: c.hazards, zones: c.zones, known: known, fmt: { dist: dist, drop: drop }, _dustWhen: dust ? dust.when : null, _walker: w
    };
  }
  function routeTo(to, keepView) {
    hideSug(); $('rt-q').value = to.name || llText(to.lat, to.lon);
    var q = question(to), res;
    try { res = RT.plan(q); } catch (e) { res = { ok: false, reason: 'The route could not be worked out (' + e.message + ').', options: [], notes: [] }; }
    var same = plan && keepView && plan.result.ok && res.ok ? Math.min(plan.sel, res.options.length - 1) : 0;
    plan = { to: to, q: q, result: res, sel: same };
    renderPlan(); drawPlan(!keepView);
  }
  function replan() { if (plan) routeTo(plan.to, true); }
  function clearPlan() { plan = null; $('rt-q').value = ''; renderPlan(); drawPlan(false); }

  /* --- the results: one card per route, safest first. The numbers are set large on purpose. --- */
  function band(i) { return i >= 75 ? ['hi', 'low risk'] : i >= 50 ? ['mid', 'some risk'] : ['lo', 'high risk']; }
  function renderPlan() {
    var list = $('rt-list'), notes = $('rt-notes');
    $('rt-tools').hidden = !plan;
    if (!plan) { list.innerHTML = ''; notes.innerHTML = ''; say('rt-msg', ''); $('rt-from').textContent = ''; return; }
    var q = plan.q, r = plan.result, f = RT.format;
    $('rt-hour').options[0].textContent = 'Now (' + f.hhmm(hourNow()) + ')';
    $('rt-from').textContent = 'From ' + q._walker.name + ' (' + (q.walker === 'robot' ? 'robot' : 'astronaut') + ') at ' + llText(q.from.lat, q.from.lon) + ', leaving ' + f.hhmm(q.hour) + ' local time' +
      (q._dustWhen ? '. Dust as observed on ' + q._dustWhen + ' (change it on the Timeline).' : '.');
    if (!r.ok) { say('rt-msg', r.reason); list.innerHTML = ''; }
    else {
      say('rt-msg', '');
      list.innerHTML = r.options.map(function (o, i) {
        var m = o.metrics, b = band(o.index), sel = i === plan.sel;
        var time = q.walker === 'robot'
          ? '<b>' + (m.sols < 1 ? f.dur(m.moveTime) : '≈ ' + G.fmt(Math.ceil(m.sols)) + ' sols') + '</b><span>of driving at ' + K.WALKERS.robot.speed * 100 + ' cm/s' + (m.sols < 1 ? ', inside one sol' : ', ' + K.WALKERS.robot.driveHours + ' h a sol') + '</span>'
          : '<b>' + f.dur(m.moveTime) + '</b><span>' + (m.returnTime ? 'out; back at base by ' + f.hhmm(m.back) : 'arrives ' + f.hhmm(m.arrive)) + '</span>';
        return '<li class="rt-card' + (sel ? ' sel' : '') + '" data-i="' + i + '">' +
          '<button type="button" class="rt-head" data-rt="show" aria-pressed="' + sel + '" aria-label="Route ' + o.rank + ', ' + esc(o.label) + ': show on the map"><span class="rt-rank">' + o.rank + '</span>' +
          '<span class="rt-title">' + esc(o.label) + (o.also.length ? '<small>also: ' + esc(o.also.join(', ').toLowerCase()) + '</small>' : '') + '</span>' + (o.recommended ? '<span class="rt-rec">Recommended</span>' : '') + '</button>' +
          '<div class="rt-nums"><div class="rt-idx ' + b[0] + '"><b>' + o.index + '</b><span>safety index</span><i>' + b[1] + '</i></div>' +
          '<div><b>' + dist(m.distance) + '</b><span>travel distance</span></div><div>' + time + '</div></div>' + budgetLine(q, m) +
          (o.good.length ? '<ul class="rt-tags good" aria-label="Why it is safe">' + o.good.map(function (t) { return '<li>' + nb(t) + '</li>'; }).join('') + '</ul>' : '') +
          (o.bad.length ? '<ul class="rt-tags bad" aria-label="Why it is unsafe">' + o.bad.map(function (t) { return '<li>' + nb(t) + '</li>'; }).join('') + '</ul>' : '') +
          '<div class="row"><button type="button" data-rt="follow">Follow this route</button></div></li>';
      }).join('');
    }
    var extra = (r.refused || r.tried || []).filter(function (o) { return !o.viable; }).map(function (o) { return '<p class="note"><b>Not offered: ' + esc(o.label.toLowerCase()) + '.</b> ' + esc(o.refused.charAt(0).toUpperCase() + o.refused.slice(1)) + '.</p>'; });
    notes.innerHTML = extra.join('') + (r.notes || []).map(function (n) { return '<p class="note">' + esc(n) + '</p>'; }).join('');
  }
  /* The walk budget for a planned route (budget.js): oxygen and battery left on getting back. Astronauts only. */
  function budgetLine(q, m) {
    if (q.walker === 'robot' || !MW.budget) return '';
    var air = q.wx ? RT.airAt(q.wx, q.hour) : null, b = MW.budget.forRoute('astronaut', m, air);
    return '<p class="rt-budget' + (b.short ? ' short' : '') + '">' + (m.returnTime ? 'Back at base with about ' : 'On arrival, about ') +
      Math.max(0, Math.round(b.o2Pct)) + ' % oxygen and ' + Math.max(0, Math.round(b.battPct)) + ' % battery left' +
      (b.short ? ': under the ' + Math.round(C.BUDGET.RESERVE * 100) + ' % reserve' : '') + ' <span class="dtag">MODELLED</span></p>';
  }
  function drawPlan(fit) {
    planLayer.clearLayers(); badgeLayer.clearLayers();
    if (!plan) return;
    var to = plan.to, r = plan.result, bounds = L.latLngBounds([[plan.q.from.lat, plan.q.from.lon], [to.lat, to.lon]]);
    L.marker([to.lat, to.lon], { icon: L.divIcon({ className: 'rt-dest' + (r.ok ? '' : ' no'), html: '<i></i>', iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(badgeLayer);
    if (r.ok) {
      var order = r.options.map(function (o, i) { return i; }).sort(function (a, b) { return (a === plan.sel) - (b === plan.sel); });      // the chosen one is drawn last, on top
      order.forEach(function (i) {
        var o = r.options[i], sel = i === plan.sel;
        L.polyline(o.line, { renderer: planR, color: '#04211D', weight: sel ? 10 : 6, opacity: sel ? 0.75 : 0.5, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(planLayer);
        L.polyline(o.line, { renderer: planR, color: sel ? '#19E3C2' : '#FFFFFF', weight: sel ? 5 : 2.5, opacity: sel ? 1 : 0.9, dashArray: sel ? null : '3 8', interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(planLayer);
        o.line.forEach(function (p) { bounds.extend(p); });
        var at = o.line[Math.max(0, Math.min(o.line.length - 1, Math.round(o.line.length * [0.5, 0.33, 0.67, 0.25, 0.8][i % 5])))];
        L.marker(at, { icon: L.divIcon({ className: 'rt-badge' + (sel ? ' sel' : ''), html: '<b>' + o.rank + '</b>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: 'Route ' + o.rank + ': ' + o.label + ', safety index ' + o.index, keyboard: false, zIndexOffset: sel ? 560 : 540 })
          .on('click', function (e) { L.DomEvent.stop(e); select(i); }).addTo(badgeLayer);
      });
    }
    if (fit) {
      app._state.follow = false; $('z-walk').setAttribute('aria-pressed', 'false');
      if (r.ok || r.code !== 'far') map.fitBounds(bounds, { maxZoom: 17, padding: [60, 60] }); else map.setView([to.lat, to.lon], Math.max(map.getZoom(), 5));
    }
  }
  function select(i) { if (!plan || !plan.result.ok) return; plan.sel = i; renderPlan(); drawPlan(false); }
  function follow(i) {
    var o = plan.result.options[i]; select(i);
    app.followPlan({ name: 'Route to ' + (plan.to.name || 'the destination'), line: o.line });
    say('rt-msg', ''); $('rt-from').textContent = 'Following route ' + o.rank + '. Press Start in the top bar to set off; the pointer keeps to the line.';
    if (app.closeDrawer) app.closeDrawer();
  }

  /* ================================================================== 6. The live safety index and its alarm */
  /* The same index as a route's, for where the walker stands now (router.js, live). It is worked out once a second,
     shown as a readout beside the map (Settings > Display ticks it on or off) and watched by the alarm. */
  function liveQuestion(at, ahead) {
    var w = settings.walker(), dust = dustState(), c = surroundings(), el = app._state.t + (ahead || 0);
    return { at: at, walker: w.type === 'robot' ? 'robot' : 'astronaut', hour: (C.START_HOUR + el / C.MARS_HOUR) % 24, elapsed: el, ls: dust ? dust.ls : null,
      wx: wxNear(at.lat, at.lon), height: T.ready ? T.heightAt : null, slope: T.ready ? T.slopeAt : null, dust: dust ? dust.at : null,
      bases: c.bases, hazards: c.hazards, zones: c.zones, known: c.known, fmt: { dist: dist, drop: drop } };
  }
  function safetyAt(lat, lon, ahead) {
    var r; try { r = RT.live(liveQuestion({ lat: lat, lon: lon }, ahead)); } catch (e) { return null; }
    return { index: r.index, band: band(r.index)[0], worst: r.worst && r.worst.state !== 'good' ? r.worst.text : band(r.index)[1] };
  }
  var liveNow = null, seen = [], lastT = 0, active = {}, quiet = {}, audio = null;
  function showLive(r) {
    var b = band(r.index), w = r.worst && r.worst.state !== 'good' ? r.worst : null;
    $('e-safe-n').textContent = r.index; $('e-safe').className = b[0]; $('e-safe-w').textContent = b[1];
    $('e-safe-l').textContent = 'safety index here' + (w ? ': ' + w.text : '');
    $('e-safe-f').innerHTML = r.factors.slice().sort(function (x, y) { return y.risk - x.risk; }).map(function (f) { return '<li class="' + f.state + '">' + nb(f.text) + '</li>'; }).join('');
  }
  /* Three short beeps. Browsers only allow sound after the page has been touched; if it is refused, the banner still shows. */
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      [0, 0.28, 0.56].forEach(function (at) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
        o.type = 'square'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.22);
      });
    } catch (e) {}
  }
  /* The alarm rings when: the index is below the limit chosen in Settings; one factor is critical; or the index
     or a factor has changed a lot within the last ten minutes of the walk. Each cause rings once, and again only
     after it has cleared and come back. "Dismiss" silences the causes now showing. Thresholds: ROUTER.LIVE. */
  function watch(r) {
    var s = app._state, L = K.LIVE, limit = settings.get('alarmAt'), causes = {}, box = $('safe-alarm');
    if (s.t < lastT) seen = [];                             // the walk began again
    lastT = s.t;
    var risks = {}; r.factors.forEach(function (f) { risks[f.key] = f.risk; });
    seen.push({ t: s.t, index: r.index, risks: risks });
    while (seen.length > 1 && (s.t - seen[0].t > L.WINDOW || seen.length > 900)) seen.shift();
    if (!settings.get('alarm')) { active = {}; quiet = {}; box.hidden = true; $('safe-read').classList.remove('alarm'); return; }
    if (r.index < limit || (active.index && r.index < limit + L.INDEX_CLEAR)) causes.index = 'Safety index ' + r.index + ', below your limit of ' + limit;
    var top = Math.max.apply(null, seen.map(function (h) { return h.index; }));
    if (top - r.index >= L.DROP) causes.drop = 'Safety index fell ' + (top - r.index) + ' points, from ' + top + ' to ' + r.index;
    r.factors.forEach(function (f) {
      var low = Math.min.apply(null, seen.map(function (h) { return h.risks[f.key] === undefined ? f.risk : h.risks[f.key]; }));
      if (f.risk >= L.FACTOR_ALARM || (active['f:' + f.key] && f.risk >= L.FACTOR_CLEAR)) causes['f:' + f.key] = f.text;
      else if (f.risk - low >= L.JUMP && f.risk >= K.TAG_BAD) causes['j:' + f.key] = 'changing fast: ' + f.text;
    });
    var fresh = Object.keys(causes).some(function (k) { return !active[k] && !quiet[k]; });
    Object.keys(quiet).forEach(function (k) { if (!causes[k]) delete quiet[k]; });      // cleared: it may ring again later
    active = causes;
    var showing = Object.keys(causes).filter(function (k) { return !quiet[k]; });
    $('safe-read').classList.toggle('alarm', Object.keys(causes).length > 0);
    if (!showing.length) { box.hidden = true; return; }
    box.innerHTML = icon('bell') + '<div><b>Safety alarm</b><ul>' + showing.slice(0, 4).map(function (k) { var t = causes[k]; return '<li>' + nb(t.charAt(0).toUpperCase() + t.slice(1)) + '</li>'; }).join('') + '</ul></div><button type="button" id="alarm-off">Dismiss</button>';
    box.hidden = false;
    if (fresh && settings.get('alarmSound')) beep();
  }
  document.addEventListener('click', function (e) { if (e.target.id === 'alarm-off') { Object.keys(active).forEach(function (k) { quiet[k] = true; }); $('safe-alarm').hidden = true; } });
  function tickLive() {
    var want = settings.get('readouts').safety || settings.get('alarm');
    if (!want) { liveNow = null; $('safe-alarm').hidden = true; return; }
    try { liveNow = RT.live(liveQuestion(here())); } catch (e) { return; }
    showLive(liveNow); watch(liveNow);
  }

  /* The date the dust and the season are taken from: the Timeline's, shown and changeable here too. */
  var dateKey = '';
  function tickDate() {
    var D = MW.dust, st = MW.dustUI && MW.dustUI.state; if (!D || !D.pack || !st || st.my === null || st.my === undefined) return;
    var my$ = $('rt-my'), ls$ = $('rt-ls');
    if (my$.disabled) { my$.innerHTML = D.years().map(function (y) { return '<option value="' + y + '">Martian Year ' + y + '</option>'; }).join(''); my$.disabled = ls$.disabled = false; }
    var key = st.my + '|' + st.frame; if (key === dateKey) return;
    dateKey = key; my$.value = st.my; if (document.activeElement !== ls$) ls$.value = Math.round(D.year(st.my).ls[st.frame]);
    replan(); tickLive();
  }
  function setDate() { var ls = Math.max(0, Math.min(359.9, +$('rt-ls').value || 0)); MW.dustUI.goTo(+$('rt-my').value, ls); }

  /* ================================================================== 7. Wiring and start */
  function mapClick(latlng) {
    if (mode === 'place') { setMode(null); openForm({ lat: latlng.lat, lon: latlng.lng }); return true; }
    if (mode === 'dest') { setMode(null); app.openTab('nav'); routeTo({ lat: latlng.lat, lon: ((latlng.lng + 540) % 360) - 180, name: 'Point at ' + llText(latlng.lat, latlng.lng) }); return true; }
    return false;
  }
  /* Right-click or long-press opens the map's menu (context-menu.js); its "Mark as landmark" calls addMarker. */
  document.addEventListener('click', function (e) { if (e.target.id === 'pick-cancel') setMode(null); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && mode) setMode(null); });

  $('mk-add').addEventListener('click', function () { if (editing) closeForm(); setMode(mode === 'place' ? null : 'place'); });
  $('mk-here').addEventListener('click', function () { var p = here(); openForm({ lat: p.lat, lon: p.lon }); });
  $('mk-cancel').addEventListener('click', closeForm);
  $('mk-form').addEventListener('submit', function (e) {
    e.preventDefault(); if (!editing) return;
    var rec = MK.save({ id: editing.id, lat: editing.lat, lon: editing.lon, icon: editing.icon, name: $('mk-name').value.trim() || $('mk-name').placeholder || 'Marker',
      note: $('mk-note').value, radius: +$('mk-radius').value, by: editing.by || settings.walker().name, createdAt: editing.createdAt });
    closeForm();
    say('mk-msg', rec ? 'Saved “' + rec.name + '”.' + (MK.persistent ? '' : ' This browser is not keeping markers between visits.') : "The marker couldn't be saved.");
  });
  $('mk-icons').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !editing) return;
    if (b.id === 'mk-upload') { $('mk-file').click(); return; }
    pickIcon(b.getAttribute('data-icon-key'));
  });
  $('mk-file').addEventListener('change', function () { var f = this.files[0]; this.value = ''; upload(f); });
  $('mk-role').addEventListener('click', function (e) {
    if (e.target.id !== 'mk-icon-del' || !editing) return;
    MK.icons.remove(editing.icon); editing.icon = 'pin'; drawIcons(); drawDraft(); say('mk-msg', 'Icon removed. Markers that used it now show the pin.');
  });
  $('mk-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), m = MK.get(b.getAttribute('data-id')); if (!m) { renderList(); return; }
    if (act === 'route') routeTo({ lat: m.lat, lon: m.lon, name: m.name, markerId: m.id });
    else if (act === 'centre') { app._state.follow = false; $('z-walk').setAttribute('aria-pressed', 'false'); map.setView([m.lat, m.lon], Math.max(map.getZoom(), 14)); openMarker(m); if (app.closeDrawer) app.closeDrawer(); }
    else if (act === 'eye') { var f = MK.filter.get(); if (f.hidden[m.id]) delete f.hidden[m.id]; else f.hidden[m.id] = true; MK.filter.set(f); }
    else if (act === 'edit') openForm(m);
    else if (act === 'del') {
      if (b.getAttribute('data-sure')) { if (editing && editing.id === m.id) closeForm(); MK.remove(m.id); say('mk-msg', 'Deleted “' + m.name + '”.'); }      // second press within 4 s deletes
      else { b.setAttribute('data-sure', '1'); b.classList.add('sure'); MW.ui.setButton(b, 'trash', 'Delete for good?'); setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-sure'); b.classList.remove('sure'); MW.ui.setButton(b, 'trash', 'Delete'); } }, 4000); }
    }
  });
  $('mk-filter').addEventListener('change', function (e) {
    var key = e.target.getAttribute('data-f'), f = MK.filter.get(); if (!key) return;
    if (key === 'custom') f.custom = e.target.checked; else if (key === 'places') f.places = e.target.checked; else f.icons[key.slice(2)] = e.target.checked;
    MK.filter.set(f);
  });
  $('mk-all').addEventListener('click', function () { var f = MK.filter.get(); Object.keys(f.icons).forEach(function (k) { f.icons[k] = true; }); f.custom = f.places = true; f.hidden = {}; MK.filter.set(f); });

  var q$ = $('rt-q');
  q$.addEventListener('input', showSug);
  q$.addEventListener('focus', showSug);
  q$.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); }
    else if (e.key === 'Escape') { hideSug(); e.stopPropagation(); }
    else if (e.key === 'Enter') {
      e.preventDefault(); if ($('rt-sug').hidden) showSug();
      var s = sug[sugAt >= 0 ? sugAt : 0];
      if (s) routeTo(s); else { say('rt-msg', 'No place or marker called “' + q$.value.trim() + '”. Pick one from the list, type a latitude and longitude, or tap the target and then the map.'); hideSug(); }
    }
  });
  $('rt-sug').addEventListener('mousedown', function (e) { e.preventDefault(); });                 // keep the focus in the box while choosing
  $('rt-sug').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) routeTo(sug[+li.getAttribute('data-i')]); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#rt-bar, #rt-sug')) hideSug(); });
  $('rt-pick').addEventListener('click', function () { if (editing) closeForm(); setMode(mode === 'dest' ? null : 'dest'); });
  $('rt-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-rt]'), li = e.target.closest('li[data-i]'); if (!li) return;
    if (b && b.getAttribute('data-rt') === 'follow') follow(+li.getAttribute('data-i')); else select(+li.getAttribute('data-i'));
  });
  $('rt-again').addEventListener('click', replan);
  $('rt-clear').addEventListener('click', clearPlan);
  $('rt-hour').addEventListener('change', replan);
  $('rt-pref').addEventListener('change', function () { store.setPreferred(this.value || null); });

  function fillHours() {
    var sel = $('rt-hour'), keep = sel.value || 'now', html = '<option value="now">Now</option>';
    for (var h = 5; h <= 21; h++) html += '<option value="' + h + '">' + String(h).padStart(2, '0') + ':00</option>';
    sel.innerHTML = html; sel.value = keep;
  }
  function fillPreferred() {
    var sel = $('rt-pref'), pref = store.preferred() || '', html = '<option value="">None</option><option value="curiosity">Curiosity\'s drive</option>';
    store.list().forEach(function (r) { html += '<option value="' + r.id + '">' + esc(r.name) + '</option>'; });
    sel.innerHTML = html; sel.value = pref;
  }
  function refresh() { drawMarkers(); renderList(); renderFilter(); }

  MK.onChange(function () { setting = null; refresh(); if (editing) drawIcons(); replan(); tickLive(); });
  store.onChange(function () { setting = null; fillPreferred(); replan(); });
  settings.onChange(function () { renderList(); if (editing) showWhere(); replan(); tickLive(); });
  $('rt-my').addEventListener('change', setDate);
  $('rt-ls').addEventListener('change', setDate);
  setInterval(function () { tickDate(); tickLive(); }, 1000);
  setInterval(function () {                                 // the walker moves: keep the "away" distances in the list current
    if ($('nav-markers').hidden) return;
    Array.prototype.forEach.call(document.querySelectorAll('#mk-list span[data-d]'), function (el) {
      var p = el.getAttribute('data-d').split(','), t = dist(fromHere(+p[0], +p[1])) + ' away', rest = el.textContent.replace(/^.*? away/, '');
      if (el.textContent !== t + rest) el.textContent = t + rest;
    });
  }, 2000);

  fillHours(); fillPreferred(); refresh(); renderPlan();
  T.load().then(function () { if (plan) replan(); tickLive(); }, function (e) { say('rt-msg', e.message + ' Routes are still found, without slope or climb.'); });

  tickLive();
  MW.navUI = { mapClick: mapClick, routeTo: routeTo, clear: clearPlan, addMarker: openForm, get plan() { return plan; }, refresh: refresh,
    reset: function () { setting = null; if (plan) clearPlan(); tickLive(); },     // the site moved (app.js, setSite): bases and plans are out of date
    picking: function () { return !!mode; }, safetyAt: safetyAt, live: function () { return liveNow; },
    dustAt: function (lat, lon) { var d = dustState(); return d ? d.at(lat, lon) : null; } };
})();
