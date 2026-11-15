/* trail-edit.js — MW.trailEdit: edit the trail walked so far, on the map.
 *
 * Useful when planning (draw a trail by tapping, then tidy it) and for a robot's track. Tap the trail and choose
 * "Edit this trail", or press the pencil under "Your trail".
 *
 *   drag a point             move it
 *   tap a point              delete it, end the trail there, or start the trail there
 *   tap the line             add a point
 *   Undo, Done, Cancel       in the bar on the map
 *
 * The trail holds a point every 1.5 m, far too many to drag. So the editor works on a thinned copy: the fewest
 * points that stay within a metre of the walked line (Douglas-Peucker), widened if that is still over 120 points.
 * "Done" hands the edited line to app.js (Marswalk.replaceTrail), which lays the trail again along it: points
 * every 1.5 m, pass counts worked out afresh, times at the pace walked so far, the walker at its end.
 *
 * Loads after app.js and reaches the map through window.Marswalk.
 */
(function () {
  'use strict';
  var G = MW.geo, $ = G.$, app = window.Marswalk, map = app._map;
  var on = false, verts = [], history = [], handles = [], line = null, casing = null;

  /* The fewest points that keep the line within `tol` metres of the original. */
  function thin(pts, tol) {
    var keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      var r = stack.pop(), a = pts[r[0]], b = pts[r[1]], vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy, worst = 0, at = -1;
      for (var i = r[0] + 1; i < r[1]; i++) {
        var t = L2 ? Math.max(0, Math.min(1, ((pts[i].x - a.x) * vx + (pts[i].y - a.y) * vy) / L2)) : 0, d = Math.hypot(pts[i].x - (a.x + vx * t), pts[i].y - (a.y + vy * t));
        if (d > worst) { worst = d; at = i; }
      }
      if (worst > tol) { keep[at] = 1; stack.push([r[0], at], [at, r[1]]); }
    }
    var out = [];
    for (var k = 0; k < pts.length; k++) if (keep[k]) out.push({ x: pts[k].x, y: pts[k].y });
    return out;
  }
  function ll(v) { return G.toLL(v.x, v.y); }
  function remember() { history.push(verts.map(function (v) { return { x: v.x, y: v.y }; })); if (history.length > 50) history.shift(); $('edit-undo').disabled = false; }

  function draw() {
    handles.forEach(function (h) { map.removeLayer(h); }); handles = [];
    var path = verts.map(ll);
    casing.setLatLngs(path); line.setLatLngs(path);
    verts.forEach(function (v, i) {
      var cls = 'te-h' + (i === 0 ? ' a' : i === verts.length - 1 ? ' z' : ''), name = i === 0 ? 'Start of the trail' : i === verts.length - 1 ? 'End of the trail' : 'Trail point ' + (i + 1);
      var h = L.marker(ll(v), { icon: L.divIcon({ className: cls, html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 13] }), draggable: true, title: name, alt: name, keyboard: true, zIndexOffset: 950 }).addTo(map);
      h.on('dragstart', function () { remember(); map.closePopup(); });
      h.on('drag', function () { var p = h.getLatLng(), e = G.toENU(p.lat, p.lng); v.x = e.x; v.y = e.y; var path2 = verts.map(ll); casing.setLatLngs(path2); line.setLatLngs(path2); });
      h.on('click', function (e) { L.DomEvent.stop(e); menu(i); });
      handles.push(h);
    });
  }
  function menu(i) {
    var n = verts.length, last = i === n - 1, first = i === 0, can = n > 2;
    var html = '<div class="pop"><h3>' + (first ? 'Start of the trail' : last ? 'End of the trail' : 'Trail point ' + (i + 1) + ' of ' + n) + '</h3><div class="te-menu">' +
      (can ? '<button type="button" data-te="del" data-i="' + i + '">Delete this point</button>' : '') +
      (!last && i > 0 ? '<button type="button" data-te="end" data-i="' + i + '">End the trail here</button>' : '') +
      (!first && i < n - 1 ? '<button type="button" data-te="start" data-i="' + i + '">Start the trail here</button>' : '') +
      (can ? '' : '<p>A trail needs two points. Drag this one to move it.</p>') + '</div></div>';
    L.popup({ maxWidth: 240, className: 'te-pop', offset: [0, -8] }).setLatLng(ll(verts[i])).setContent(html).openOn(map);
  }
  document.addEventListener('click', function (e) {        // capture phase: Leaflet popups swallow clicks
    var b = e.target.closest && e.target.closest('[data-te]'); if (!b || !on) return;
    var i = +b.getAttribute('data-i'), act = b.getAttribute('data-te');
    remember(); map.closePopup();
    if (act === 'del') verts.splice(i, 1); else if (act === 'end') verts = verts.slice(0, i + 1); else verts = verts.slice(i);
    draw();
  }, true);

  function start() {
    if (on) return true;
    var pts = app._trail.pts;
    if (pts.length < 2) { app.saveTrail(); return false; }                      // nothing walked yet: the trail panel says so
    app.pause(); map.closePopup();
    var tol = 1; do { verts = thin(pts, tol); tol *= 1.6; } while (verts.length > 120);
    history = []; on = true;
    casing = L.polyline([], { color: '#000', weight: 7, opacity: 0.55, interactive: false }).addTo(map);
    line = L.polyline([], { color: '#fff', weight: 3, dashArray: '8 6', interactive: false }).addTo(map);
    draw();
    $('edit-bar').hidden = false; $('edit-undo').disabled = true; map.getContainer().classList.add('editing');
    if (app.closeDrawer) app.closeDrawer();
    return true;
  }
  function stop() {
    on = false; map.closePopup();
    handles.forEach(function (h) { map.removeLayer(h); }); handles = [];
    if (line) { map.removeLayer(line); map.removeLayer(casing); line = casing = null; }
    $('edit-bar').hidden = true; map.getContainer().classList.remove('editing');
  }
  /* A tap on the map while editing: on the line it adds a point there; anywhere else it does nothing (and never walks). */
  function mapClick(e) {
    if (!on) return false;
    var p = e.containerPoint, best = null;
    for (var i = 0; i < verts.length - 1; i++) {
      var a = map.latLngToContainerPoint(ll(verts[i])), b = map.latLngToContainerPoint(ll(verts[i + 1])), vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1e-6;
      var t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2)), d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
      if (d <= 14 && (!best || d < best.d)) best = { d: d, i: i };
    }
    if (best) { var en = G.toENU(e.latlng.lat, e.latlng.lng); remember(); verts.splice(best.i + 1, 0, { x: en.x, y: en.y }); draw(); }
    return true;
  }
  $('edit-undo').addEventListener('click', function () { if (!history.length) return; verts = history.pop(); this.disabled = !history.length; map.closePopup(); draw(); });
  $('edit-cancel').addEventListener('click', stop);
  $('edit-done').addEventListener('click', function () { var v = verts; stop(); if (v.length >= 2 && history.length) app.replaceTrail(v); });     // untouched: the trail stays exactly as walked
  window.addEventListener('keydown', function (e) { if (on && e.key === 'Escape' && $('settings').hidden) stop(); });

  MW.trailEdit = { start: start, cancel: stop, mapClick: mapClick, get active() { return on; } };
})();
