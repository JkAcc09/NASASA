/* companions.js — "Walk together" in the Menu tab: the other walkers on the map at the same time.
 *
 * The active walker (the one chosen in the top bar) is the pointer, as before. Every other walker can be shown as
 * a companion: standing where it was put, replaying Curiosity's drive or a saved trail alongside the active walker
 * (it moves while Start is pressed, at the same pace and speed-up), or following real position fixes:
 *
 *   Marswalk.setPose({ walker: 'w2', lat: -4.8012, lon: 137.3829, heading: 215 })   // 'w2' is the walker's id
 *
 * Positions are latitude and longitude, so companions work at any site. Loads after app.js.
 */
(function () {
  'use strict';
  var C = MW.config, G = MW.geo, $ = G.$, settings = MW.settings, app = window.Marswalk, map = app._map, esc = G.escapeHtml, DEG = G.DEG;
  var mates = new Map();                               // walker id -> { id, lat, lon, heading, shown, plan, route, seg, f, external, marker }

  function art(type) {                                 // a smaller, white-edged arrow with the walker's name under it
    return '<svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true"><g class="mate-rot">' +
      '<path d="M0 -12 L8 9 L0 4.5 L-8 9 Z" fill="' + (type === 'robot' ? '#19C37D' : '#FFD400') + '" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></g></svg>';
  }
  function icon(w) { return L.divIcon({ className: 'mate', iconSize: [34, 34], iconAnchor: [17, 17], html: art(w.type) + '<span>' + esc(w.name) + '</span>' }); }
  function walkers() { var me = settings.walker().id; return settings.get('walkers').filter(function (w) { return w.id !== me; }); }
  function mate(w) {
    var m = mates.get(w.id);
    if (!m) {
      var h = app.here(), off = 6 * (mates.size + 1);  // beside the active walker at first, a few metres east
      m = { id: w.id, lat: h.lat, lon: h.lon + off / (G.M_PER_DEG * Math.cos(h.lat * DEG)), heading: 0, shown: false, plan: 'stand', route: null, seg: 0, f: 0, external: false, marker: null };
      mates.set(w.id, m);
    }
    m.w = w; return m;
  }
  function metres(a, b) { return G.haversine(a, b); }
  function bearing(a, b) { return G.bearing((b.lon - a.lon) * Math.cos(a.lat * DEG), b.lat - a.lat); }

  /* ---------------------------------------------------------------- plans: stand still, or replay a route */
  function routeOf(plan) {
    if (plan === 'curiosity') return G.WP.map(function (w) { return [w.lat, w.lon]; });
    var rec = MW.store.get(plan); return rec && rec.points.length > 1 ? rec.points.map(function (p) { return [p[0], p[1]]; }) : null;
  }
  function setPlan(m, plan) {
    m.plan = plan; m.external = false; m.route = plan === 'stand' ? null : routeOf(plan); m.seg = 0; m.f = 0;
    if (m.route) { m.lat = m.route[0][0]; m.lon = m.route[0][1]; }
    show(m, true);
  }
  function show(m, on) {
    m.shown = on;
    if (on && !m.marker) m.marker = L.marker([m.lat, m.lon], { icon: icon(m.w), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
    if (!on && m.marker) { map.removeLayer(m.marker); m.marker = null; }
    place(m); render();
  }
  function place(m) {
    if (!m.marker) return;
    m.marker.setLatLng([m.lat, m.lon]);
    var g = m.marker.getElement() && m.marker.getElement().querySelector('.mate-rot');
    if (g) g.setAttribute('transform', 'rotate(' + (m.heading || 0).toFixed(1) + ')');
  }
  function step(m, dt) {                               // move along the route at walking pace times the speed-up
    var R = m.route; if (!R || m.seg >= R.length - 1) return;
    var move = C.WALK * app.speed() * dt;
    while (move > 0 && m.seg < R.length - 1) {
      var a = { lat: R[m.seg][0], lon: R[m.seg][1] }, b = { lat: R[m.seg + 1][0], lon: R[m.seg + 1][1] }, len = Math.max(0.01, metres(a, b)), left = len * (1 - m.f);
      m.heading = bearing(a, b);
      if (move < left) { m.f += move / len; move = 0; }
      else { move -= left; m.seg++; m.f = 0; }
    }
    var i = Math.min(m.seg, R.length - 1), j = Math.min(i + 1, R.length - 1);
    m.lat = R[i][0] + (R[j][0] - R[i][0]) * m.f; m.lon = R[i][1] + (R[j][1] - R[i][1]) * m.f;
  }

  /* ---------------------------------------------------------------- the panel */
  function options(sel) {
    var o = [['stand', 'Stands still'], ['curiosity', "Replays Curiosity's drive"]];
    MW.store.list().forEach(function (r) { o.push([r.id, 'Replays “' + r.name + '”']); });
    return o.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('');
  }
  function status(m) {
    if (!m.shown) return 'not on the map';
    var h = app.here(), d = metres(h, m), b = bearing(h, m), what = m.external ? 'following position fixes' : m.route ? (m.seg >= m.route.length - 1 ? 'at the end of its route' : 'replaying') : 'standing';
    return (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(d < 10000 ? 1 : 0) + ' km') + ' ' + G.compass(b) + ' of you, ' + what;
  }
  function render() {
    var box = $('mates'), ws = walkers();
    if (!ws.length) { box.innerHTML = '<p class="note">There is only one walker. Add another in Settings to walk together.</p>'; return; }
    box.innerHTML = ws.map(function (w) {
      var m = mate(w);
      return '<li data-id="' + esc(w.id) + '"><div class="mate-head"><b>' + esc(w.name) + '</b><span>' + (w.type === 'robot' ? 'robot' : 'astronaut') + '</span>' +
        '<button type="button" class="ib sm" data-mate="eye" aria-pressed="' + m.shown + '" aria-label="' + (m.shown ? 'Hide ' : 'Show ') + esc(w.name) + ' on the map" data-tip="' + (m.shown ? 'Hide from the map' : 'Show on the map') + '">' + MW.ui.icon(m.shown ? 'eye' : 'eyeoff') + '</button></div>' +
        '<label class="select"><span class="sr">What ' + esc(w.name) + ' does</span><select data-mate="plan">' + options(m.external ? 'stand' : m.plan) + '</select></label>' +
        '<p class="note" data-mate="status">' + status(m) + '</p></li>';
    }).join('');
  }
  function tick() {                                    // the status lines only
    Array.prototype.forEach.call(document.querySelectorAll('#mates li[data-id]'), function (li) {
      var m = mates.get(li.getAttribute('data-id')), p = li.querySelector('[data-mate="status"]');
      if (m && p) { var t = status(m); if (p.textContent !== t) p.textContent = t; }
    });
  }
  $('mates').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mate="eye"]'); if (!b) return;
    var m = mates.get(b.closest('li').getAttribute('data-id')); if (m) show(m, !m.shown);
  });
  $('mates').addEventListener('change', function (e) {
    if (e.target.getAttribute('data-mate') !== 'plan') return;
    var m = mates.get(e.target.closest('li').getAttribute('data-id')); if (m) setPlan(m, e.target.value);
  });
  settings.onChange(function () {                      // the active walker may have changed: it is not its own companion
    var me = settings.walker().id, m = mates.get(me);
    if (m) { show(m, false); mates.delete(me); }
    render();
  });
  MW.store.onChange(render);

  var last = 0, lastTick = 0;
  function frame(ts) {
    var dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    if (app.playing()) mates.forEach(function (m) { if (m.shown && !m.external && m.route) { step(m, dt); place(m); } });
    if (ts - lastTick > 1000) { tick(); lastTick = ts; }
    requestAnimationFrame(frame);
  }
  render(); requestAnimationFrame(frame);

  MW.companions = {
    setPose: function (p) {                            // a real position fix for another walker
      var w = settings.get('walkers').filter(function (x) { return x.id === p.walker; })[0]; if (!w) return false;
      var m = mate(w); m.external = true; m.route = null;
      if (typeof p.lat === 'number' && typeof p.lon === 'number') { m.lat = p.lat; m.lon = p.lon; }
      if (typeof p.heading === 'number') m.heading = p.heading;
      if (!m.shown) show(m, true); else place(m);
      return true;
    },
    list: function () { var out = []; mates.forEach(function (m) { out.push({ id: m.id, name: m.w.name, lat: m.lat, lon: m.lon, shown: m.shown, plan: m.plan, external: m.external }); }); return out; },
    show: function (id, on, plan) { var w = walkers().filter(function (x) { return x.id === id; })[0]; if (!w) return false; var m = mate(w); if (plan) setPlan(m, plan); else show(m, on !== false); return true; }
  };
})();
