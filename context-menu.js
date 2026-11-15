/* context-menu.js — the menu that opens when the map is right-clicked (or long-pressed on a touch screen).
 *
 *   Reveal information   a popup at that spot: coordinates, height, slope, distance and walking time from you,
 *                        conditions on arrival, the safety index and dust there, the map layer's value, the place it
 *                        lies in, the sharpest imagery and the nearest Curiosity stop (app.js, spotInfo)
 *   Find routes here     the route-finder (Markers and routes, nav-ui.js) with this spot as the destination: the
 *                        ways to walk there from where the walker stands, safest first, or why there is none
 *   Teleport here        moves the walker there at once, as the bolt in "Go to a place" does (places-ui.js): within
 *                        60 km the base stays, farther away a new site starts. If a trail is under way it asks first.
 *   Mark as landmark     opens the marker form at that spot, to name it and choose its icon (nav-ui.js)
 *
 * The browser's own right-click menu is held back on the map only (Leaflet does that for a map with a contextmenu
 * listener). The menu closes on Escape, on a click elsewhere, or when the map moves. Loads after nav-ui.js and
 * places-ui.js.
 */
(function () {
  'use strict';
  var G = MW.geo, $ = G.$, app = window.Marswalk, map = app._map, esc = G.escapeHtml, icon = MW.ui.icon;
  var menu = $('ctx'), at = null, swallow = false;

  function llText(lat, lon) { return Math.abs(lat).toFixed(4) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(4) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function items() {
    return '<p class="ctx-where">' + llText(at.lat, at.lng) + '</p><div role="none">' +
      '<button type="button" role="menuitem" data-ctx="info">' + icon('search') + '<span>Reveal information</span></button>' +
      '<button type="button" role="menuitem" data-ctx="image">' + icon('eye') + '<span>View location image</span></button>' +
      '<button type="button" role="menuitem" data-ctx="route">' + icon('route') + '<span>Find routes here</span></button>' +
      '<button type="button" role="menuitem" data-ctx="go">' + icon('teleport') + '<span>Teleport here</span></button>' +
      '<button type="button" role="menuitem" data-ctx="mark">' + icon('pin') + '<span>Mark as landmark</span></button></div>';
  }
  /* Keep the menu on screen: beside the spot, flipped left or up where it would run off the edge. */
  function place(pt) {
    var w = menu.offsetWidth, h = menu.offsetHeight, x = pt.x + 6, y = pt.y + 6;
    if (x + w > window.innerWidth - 6) x = pt.x - w - 6;
    if (y + h > window.innerHeight - 6) y = pt.y - h - 6;
    menu.style.left = Math.max(6, x) + 'px'; menu.style.top = Math.max(6, y) + 'px';
  }
  var anchor = null;
  function open(e) {
    if (MW.trailEdit && MW.trailEdit.active) return;     // the trail editor has its own taps
    if (MW.navUI && MW.navUI.picking()) return;           // placing a marker or picking a destination
    at = e.latlng; map.closePopup();
    var r = map.getContainer().getBoundingClientRect();
    anchor = { x: r.left + e.containerPoint.x, y: r.top + e.containerPoint.y };
    menu.innerHTML = items(); menu.hidden = false; place(anchor);
    var first = menu.querySelector('[role="menuitem"]'); if (first) first.focus({ preventScroll: true });
  }
  function close() { if (menu.hidden) return; menu.hidden = true; menu.innerHTML = ''; at = null; }

  function pad(right) {                                  // keep popups in the open part of the map, clear of the floating panels (style.css, 1.7)
    var f = MW.ui.fitPad(12); return { tl: f.paddingTopLeft, br: [Math.max(f.paddingBottomRight[0], right || 0), Math.max(f.paddingBottomRight[1], 60)] };
  }
  function reveal() {
    var info = app.spotInfo(at), pov = $('pov'), right = pov && !pov.hidden && pov.offsetWidth ? pov.offsetWidth + 24 : 12;
    // the padding keeps the popup clear of the rover photo (top right) and the status symbols (bottom right)
    L.popup({ maxWidth: 340, className: 'spot-pop', autoPanPaddingTopLeft: pad().tl, autoPanPaddingBottomRight: pad(right).br }).setLatLng(at).setContent('<div class="pop spot"><h3>' + info.title + '</h3><dl>' + info.rows + '</dl>' +
      (info.notes ? '<p>' + info.notes + '</p>' : '') + '</div>').openOn(map);
  }
  /* A small preview of the best NASA picture of the spot (imagery.js), with where it comes from. */
  function picture(spot) {
    var pov = $('pov'), right = pov && !pov.hidden && pov.offsetWidth ? pov.offsetWidth + 72 : 60;     // clear of the picture panel and the tabs
    var pop = L.popup({ maxWidth: 270, minWidth: 240, className: 'spot-pop img-pop', autoPanPaddingTopLeft: pad().tl, autoPanPaddingBottomRight: pad(right).br })
      .setLatLng(spot).setContent('<div class="pop"><h3>Looking for a NASA picture…</h3><p>' + llText(spot.lat, spot.lng) + '</p></div>').openOn(map);
    MW.imagery.best(spot.lat, spot.lng, {}).then(function (r) {
      if (!map.hasLayer(pop)) return;
      if (r.kind === 'none') { pop.setContent('<div class="pop"><h3>No imagery available for this location.</h3><p>' + esc(r.note) + '</p></div>'); return; }
      pop.setContent('<div class="pop locimg"><h3>' + esc(r.title) + '</h3><img src="' + esc(r.src) + '" alt="' + esc(r.title + ': ' + r.where) + '" ' +
        'onerror="this.replaceWith(Object.assign(document.createElement(\'p\'),{textContent:\'No imagery available for this location: the picture did not load (it needs an internet connection).\'}))">' +
        '<p>' + esc(r.where) + '</p><p class="meta">' + esc(r.source) + '<br>' + esc(r.date) + (r.note ? '<br>' + esc(r.note) : '') + '</p>' +
        (r.link ? '<p><a href="' + esc(r.link) + '" target="_blank" rel="noopener">' + (r.kind === 'rover' ? 'Open the full image at NASA' : 'Open NASA Mars Trek') + '</a></p>' : '') + '</div>');
    });
  }
  function travel(sure) {
    var S = app._state;
    if (!sure && S.dist > 5) {                           // a walk is under way: say what travelling does first
      menu.innerHTML = '<p class="ctx-ask">Teleporting to ' + llText(at.lat, at.lng) + ' starts a new trail. The trail walked so far (' + Math.round(S.dist) + ' m) is not kept unless you save it.</p>' +
        '<div role="none" class="ctx-row"><button type="button" role="menuitem" data-ctx="save">Save the trail first</button><button type="button" role="menuitem" data-ctx="go-sure">Teleport anyway</button>' +
        '<button type="button" role="menuitem" data-ctx="cancel">Cancel</button></div>';
      place(anchor); menu.querySelector('[data-ctx="go-sure"]').focus({ preventScroll: true });
      return;
    }
    var spot = at, msg = MW.placesUI.walkTo({ lat: spot.lat, lon: spot.lng }, true);
    close();
    if (msg) L.popup({ maxWidth: 320, className: 'spot-pop' }).setLatLng(spot).setContent('<div class="pop"><p>' + msg + '</p></div>').openOn(map);
  }
  menu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ctx]'); if (!b || !at) return;
    var act = b.getAttribute('data-ctx'), spot = at;
    if (act === 'info') { reveal(); close(); }
    else if (act === 'image') { picture(spot); close(); }
    else if (act === 'route') { close(); app.openTab('nav'); MW.navUI.routeTo({ lat: spot.lat, lon: ((spot.lng + 540) % 360) - 180, name: 'Point at ' + llText(spot.lat, spot.lng) }); }
    else if (act === 'go') travel(false);
    else if (act === 'go-sure') travel(true);
    else if (act === 'save') { close(); app.saveTrail(); }
    else if (act === 'cancel') close();
    else if (act === 'mark') { close(); MW.navUI.addMarker({ lat: spot.lat, lon: spot.lng }); }
  });
  menu.addEventListener('keydown', function (e) {
    var bs = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus(); }
    else if (e.key === 'Tab') close();
    if (/^(Arrow|Home|End)/.test(e.key)) e.stopPropagation();
  });

  map.on('contextmenu', open);                            // Leaflet also stops the browser's own menu, on the map only
  /* Touch screens: holding a finger still on the map for HOLD ms opens the same menu. Not every touch browser sends
     a contextmenu event for a long press, so this does it here; moving, a second finger or lifting early cancels it. */
  var HOLD = 600, hold = null;
  function cancelHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  map.getContainer().addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    if (hold) { cancelHold(); return; }                    // a second finger: pinch, not a press
    var r = map.getContainer().getBoundingClientRect(), x = e.clientX, y = e.clientY;
    hold = { x: x, y: y, opened: false, timer: setTimeout(function () {
      if (!hold) return;
      var pt = L.point(x - r.left, y - r.top);
      open({ latlng: map.containerPointToLatLng(pt), containerPoint: pt }); hold.opened = true;
    }, HOLD) };
  }, true);
  map.getContainer().addEventListener('pointermove', function (e) { if (hold && !hold.opened && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) cancelHold(); }, true);
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    map.getContainer().addEventListener(ev, function () { if (hold && hold.opened) swallow = Date.now(); cancelHold(); }, true);   // lifting the finger is not a tap to walk
  });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); close(); } }, true);
  document.addEventListener('pointerdown', function (e) {
    if (menu.hidden || menu.contains(e.target)) return;
    if (map.getContainer().contains(e.target)) swallow = Date.now();   // the press that closes the menu does not also walk the pointer
    close();
  }, true);
  map.on('movestart zoomstart', close);
  window.addEventListener('resize', close);

  MW.ctxMenu = {
    open: function (lat, lon) { var p = map.latLngToContainerPoint([lat, lon]); open({ latlng: L.latLng(lat, lon), containerPoint: p }); },
    close: close,
    swallow: function () { var s = swallow && Date.now() - swallow < 800; swallow = false; return s; },   // app.js asks on every map click; a drag never clicks, so it expires
    get isOpen() { return !menu.hidden; }
  };
})();
