/* places-ui.js — "Go to a place" in the Menu tab: the location selector, checkpoints and view links.
 * The data is in places.js; this file only shows it and moves the map or the walker.
 *
 *   View             moves the map there. The walker stays where it is. Works anywhere on Mars.
 *   Walk from here   moves the walker there with a fresh trail. Within PLACES.LOCAL_KM of base the base stays;
 *                    farther away a new site starts with its own base (app.js, moveWalker).
 *
 * The address bar always holds the current view (#map=lat,lon,zoom and, once the dust has loaded, &dust=MY,Ls),
 * so a copied link opens the same view. Loads after app.js, dust-ui.js and nav-ui.js.
 */
(function () {
  'use strict';
  var C = MW.config, K = C.PLACES, G = MW.geo, $ = G.$, P = MW.places, CP = P.checkpoints, esc = G.escapeHtml;
  var app = window.Marswalk, map = app._map, icon = MW.ui.icon;
  var query = '', pending = null, ORDER = ['Your checkpoints', 'Your markers', 'Gale crater', 'Landing sites', 'Planet', 'Saved trails', 'Curiosity stops', 'Dust storm peaks'];
  var OPEN = { 'Your checkpoints': true, 'Your markers': true, 'Gale crater': true };

  /* ================================================================ everything that can be gone to */
  function stormPeaks() {
    var D = MW.dust, out = [];
    if (!D || !D.pack || !D.record) return out;
    D.pack.years.forEach(function (y) {
      var rec = D.record(y.my); if (!rec) return;
      rec.events.forEach(function (e) {
        var base = e.peakFrame * D.pack.n, best = -1, bestTau = -1;
        for (var c = 0; c < D.pack.n; c++) {
          if (rec.cls[base + c] < 3 || y.obs[base + c] === 255) continue;
          var t = D.pack.lut[y.obs[base + c]]; if (t > bestTau) { bestTau = t; best = c; }
        }
        if (best < 0) return;
        var b = D.cellBounds(best);
        out.push({ id: 'storm:' + y.my + ':' + e.peakFrame, kind: 'storm', group: 'Dust storm peaks', name: 'Dust storm, MY' + y.my + ', Ls ' + Math.round(e.lsPeak) + '°',
                   sub: C.DUST.CLASSES[e.worst] + ', up to ' + Math.round(e.peak * 100) + ' % of the observed area; densest cell, optical depth ' + bestTau.toFixed(2) + ' (HISTORICAL)',
                   lat: b.lat, lon: ((b.lon + 540) % 360) - 180, my: y.my, ls: e.lsPeak });
      });
    });
    return out;
  }
  function items(all) {
    var cps = CP.list().map(function (c) {
      return { id: 'cp:' + c.id, kind: 'checkpoint', group: 'Your checkpoints', name: c.name, lat: c.lat, lon: c.lon, zoom: c.zoom, cp: c,
               sub: (c.kind === 'walker' ? 'walker position' + (c.walker ? ' of ' + c.walker : '') : 'map view') + (c.site && c.site !== G.GALE.name ? ', ' + c.site : '') };
    });
    return cps.concat(P.markers(MW.markers ? MW.markers.list() : []), P.nasa(), P.trailEnds(app.savedTrails()), P.stops(all), stormPeaks());
  }

  /* ================================================================ the list */
  function away(it) {
    var km = P.kmFrom(app.here(), it), local = P.isLocal(it.lat, it.lon);
    return (km < 1 ? Math.round(km * 1000) + ' m' : km < 100 ? km.toFixed(km < 10 ? 1 : 0) + ' km' : G.fmt(Math.round(km / 10) * 10) + ' km') + ' from the walker' + (local ? '' : ', beyond base');
  }
  function row(it, showGroup) {
    var walk = P.isLocal(it.lat, it.lon) ? 'Walk from here' : G.haversine(it, G.GALE) <= K.LOCAL_KM * 1000 ? 'Walk from here (back to the Gale base)' : 'Start a walk here (new base)';
    return '<li data-id="' + esc(it.id) + '"><div class="pl-name"><b>' + esc(it.name) + '</b><span>' + esc(it.sub || '') + (showGroup ? ' · ' + esc(it.group) : '') + ' · ' + away(it) + '</span></div><div class="pl-acts">' +
      '<button type="button" class="ib sm" data-pl="view" aria-label="View ' + esc(it.name) + ' on the map" data-tip="View on the map">' + icon('go') + '</button>' +
      '<button type="button" class="ib sm" data-pl="walk" aria-label="' + walk + ': ' + esc(it.name) + '" data-tip="' + walk + '">' + icon('walk') + '</button>' +
      (it.kind === 'checkpoint' ? '<button type="button" class="ib sm" data-pl="del" aria-label="Delete the checkpoint ' + esc(it.name) + '" data-tip="Delete this checkpoint">' + icon('trash') + '</button>' : '') +
      '</div></li>';
  }
  var current = [];
  function render() {
    var box = $('pl-list'), list = items(!!query);
    if (query) {
      current = P.search(query, list);
      box.innerHTML = current.length ? '<ul class="pl-ul">' + current.map(function (it) { return row(it, true); }).join('') + '</ul>'
        : '<p class="note">Nothing called “' + esc(query) + '”. Try a place name, a marker, a checkpoint, or a sol such as “sol 4700”.</p>';
      return;
    }
    current = list;
    box.innerHTML = ORDER.map(function (g) {
      var its = list.filter(function (it) { return it.group === g; });
      if (!its.length && g !== 'Your checkpoints') return '';
      var empty = g === 'Your checkpoints' && !its.length ? '<p class="note">None yet. Save the map view or the walker’s position with the buttons below.</p>' : '';
      var hint = g === 'Curiosity stops' ? '<p class="note">Every ' + K.STOP_EVERY + 'th stop. Search “sol 4700” for any of the ' + G.WP.length + '.</p>'
        : g === 'Dust storm peaks' ? '<p class="note">Where each storm the dust detection found was densest. Viewing one also sets the Timeline to it.</p>' : '';
      return '<details' + (OPEN[g] ? ' open' : '') + ' data-group="' + g + '"><summary>' + g + ' <span class="pl-n">' + its.length + '</span></summary>' + hint + empty +
        (its.length ? '<ul class="pl-ul">' + its.map(function (it) { return row(it, false); }).join('') + '</ul>' : '') + '</details>';
    }).join('');
  }
  function find(id) { for (var i = 0; i < current.length; i++) if (current[i].id === id) return current[i]; return null; }
  function say(text) { var m = $('pl-msg'); m.innerHTML = text || ''; m.hidden = !text; }

  /* ================================================================ going there */
  function imageryNote(lat, lon) {
    var im = P.imageryAt(lat, lon);
    return 'Sharpest imagery here: ' + im.name + ', ' + im.res + '.' + (im.zoom < 13 ? ' Zooming in further only enlarges it.' : '');
  }
  function view(it) {
    app.setFollow(false);
    var im = P.imageryAt(it.lat, it.lon), cap = Math.min(im.zoom, 17);
    if (it.kind === 'checkpoint') map.setView([it.lat, it.lon], Math.min(it.zoom || cap, 18));
    else if (it.outline && it.outline.length > 2) map.fitBounds(L.latLngBounds(it.outline), { maxZoom: cap, padding: [30, 30] });
    else map.setView([it.lat, it.lon], it.kind === 'storm' ? 4 : cap);
    if (it.kind === 'storm' && MW.dustUI) { MW.dustUI.show(true); MW.dustUI.goTo(it.my, it.ls); }
    if (MW.dustUI && MW.dustUI.pinAt) MW.dustUI.pinAt(it.lat, it.lon);
    var lm = it.landmark;
    L.popup({ maxWidth: 290, className: 'pl-pop' }).setLatLng([it.lat, it.lon]).setContent('<div class="pop"><h3>' + esc(it.name) + '</h3>' +
      (lm ? '<p>' + esc(lm.role) + ', ' + esc(lm.size) + '. ' + lm.note + '</p>' : it.sub ? '<p>' + esc(it.sub) + '</p>' : '') +
      '<p>' + imageryNote(it.lat, it.lon) + '</p><div class="row"><button type="button" data-pl-pop="' + esc(it.id) + '">' +
      (P.isLocal(it.lat, it.lon) ? 'Walk from here' : 'Start a walk here') + '</button></div></div>').openOn(map);
    say('Showing <b>' + esc(it.name) + '</b>. ' + imageryNote(it.lat, it.lon) + ' The walker has not moved; “Back to the walker” returns the map to it.');
  }
  function walk(it, sure) {
    var S = app._state;
    if (!sure && S.dist > 5) {                          // a walk is under way: say what moving does before doing it
      pending = it;
      $('pl-confirm-text').textContent = 'Moving the walker to ' + it.name + ' starts a new trail. The trail walked so far (' + Math.round(S.dist) + ' m) is not kept unless you save it.';
      $('pl-confirm').hidden = false; $('pl-confirm').scrollIntoView({ block: 'nearest' });
      return;
    }
    $('pl-confirm').hidden = true; pending = null; map.closePopup();
    var site = G.SITE.name, res = app.moveWalker(it.lat, it.lon, it.kind === 'nasa' || it.kind === 'marker' || it.kind === 'checkpoint' ? it.name : null);
    var im = P.imageryAt(it.lat, it.lon);
    map.setView([it.lat, it.lon], Math.min(im.zoom, it.kind === 'checkpoint' && it.zoom ? it.zoom : 16));
    if (MW.dustUI && MW.dustUI.state) { MW.dustUI.state.pin = null; }
    say(res === 'same' ? 'The walker is at <b>' + esc(it.name) + '</b>, with the same base. A new trail has started. ' + imageryNote(it.lat, it.lon)
      : res === 'gale' ? 'Back at Gale crater: the base is Curiosity’s first stop again, and the weather readings and rover view are back. ' + imageryNote(it.lat, it.lon)
      : 'New site: the base is now at <b>' + esc(G.SITE.name) + '</b> (it was ' + esc(site) + '). Distances, the route-finder and the walk budget count from here. ' +
        'The weather readings and rover photos are from Curiosity at Gale, so they are blank here; height and slope come from the regional terrain model. ' + imageryNote(it.lat, it.lon));
    render();
  }
  document.addEventListener('click', function (e) {     // capture: Leaflet popups swallow clicks
    var b = e.target.closest && e.target.closest('[data-pl-pop]'); if (!b) return;
    var it = find(b.getAttribute('data-pl-pop')) || items(true).filter(function (x) { return x.id === b.getAttribute('data-pl-pop'); })[0];
    if (it) { app.openTab('menu'); walk(it); }
  }, true);

  /* ================================================================ checkpoints */
  var saving = null;
  function askName(kind) {
    saving = kind;
    var n = CP.list().length + 1;
    $('pl-save-lab').textContent = kind === 'walker' ? 'Name this walker position' : 'Name this map view';
    $('pl-save-name').value = (kind === 'walker' ? 'Position ' : 'View ') + n;
    $('pl-save').hidden = false; $('pl-save-name').focus(); $('pl-save-name').select();
  }
  $('pl-save').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = saving === 'walker' ? app.here() : { lat: map.getCenter().lat, lon: map.getCenter().lng };
    var cp = CP.save({ name: $('pl-save-name').value.trim() || 'Checkpoint', lat: c.lat, lon: c.lon, zoom: map.getZoom(), kind: saving,
                       walker: saving === 'walker' ? MW.settings.walker().name : null, site: G.SITE.name });
    $('pl-save').hidden = true;
    say('Saved the checkpoint <b>' + esc(cp.name) + '</b>.' + (CP.persistent ? '' : ' This browser is not keeping data between visits, so download your checkpoints.'));
  });
  $('pl-save-cancel').addEventListener('click', function () { $('pl-save').hidden = true; });
  $('pl-cp-view').addEventListener('click', function () { askName('view'); });
  $('pl-cp-walker').addEventListener('click', function () { askName('walker'); });
  $('pl-cp-file').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([CP.toText()], { type: 'application/json' }));
    a.download = 'marswalk-checkpoints.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  $('pl-cp-import').addEventListener('click', function () { $('pl-cp-input').click(); });
  $('pl-cp-input').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return; this.value = '';
    var rd = new FileReader();
    rd.onload = function () {
      var n = CP.fromText(String(rd.result));
      say(n < 0 ? 'That file is not a Marswalk checkpoints file (marswalk-checkpoints.json).' : 'Added ' + n + ' checkpoint' + (n === 1 ? '' : 's') + '.');
    };
    rd.readAsText(f);
  });
  CP.onChange(render);

  /* ================================================================ view links */
  function viewHash() {
    var c = map.getCenter(), v = { map: { lat: c.lat, lon: c.lng, zoom: map.getZoom() } }, st = MW.dustUI && MW.dustUI.state, D = MW.dust;
    if (D && D.pack && st && st.my !== null && st.my !== undefined) v.dust = { my: st.my, ls: D.year(st.my).ls[st.frame] };
    return P.formatHash(v);
  }
  var hashTimer = 0, applying = false;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      var h = viewHash();
      if (h && h !== location.hash) try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) {}
    }, 500);
  }
  function applyHash() {
    var v = P.parseHash(location.hash);
    if (v.map) { app.setFollow(false); map.setView([v.map.lat, v.map.lon], v.map.zoom || map.getZoom(), { animate: false }); }
    if (v.dust && MW.dust) MW.dust.load().then(function () {
      var tries = 0;
      (function wait() {                                // the dust panel picks its first year shortly after loading
        var st = MW.dustUI && MW.dustUI.state;
        if (st && st.my !== null && st.my !== undefined && MW.dust.year(v.dust.my)) { MW.dustUI.goTo(v.dust.my, v.dust.ls); return; }
        if (++tries < 40) setTimeout(wait, 150);
      })();
    }, function () {});
    return !!v.map;
  }
  map.on('moveend', writeHash);
  window.addEventListener('hashchange', function () { if (!applying) applyHash(); });
  $('pl-link').addEventListener('click', function () {
    var url = location.href.split('#')[0] + viewHash();
    var done = function () { say('Link to this view copied: <span class="pl-url">' + esc(url) + '</span>'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { say('Copy this link: <span class="pl-url">' + esc(url) + '</span>'); });
    else say('Copy this link: <span class="pl-url">' + esc(url) + '</span>');
  });
  $('pl-home').addEventListener('click', function () { $('z-walk').click(); say(''); });

  /* ================================================================ wiring */
  $('pl-q').addEventListener('input', function () { query = this.value.trim(); render(); });
  $('pl-q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && current.length && query) { e.preventDefault(); view(current[0]); }
    e.stopPropagation();                                // typing here never walks the pointer
  });
  $('pl-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pl]'); if (!b) return;
    var it = find(b.closest('li').getAttribute('data-id')); if (!it) return;
    var act = b.getAttribute('data-pl');
    if (act === 'view') view(it);
    else if (act === 'walk') walk(it);
    else if (act === 'del') { CP.remove(it.cp.id); say('Deleted the checkpoint <b>' + esc(it.name) + '</b>.'); }
  });
  $('pl-list').addEventListener('toggle', function (e) { var d = e.target; if (d.tagName === 'DETAILS') OPEN[d.getAttribute('data-group')] = d.open; }, true);
  $('pl-go').addEventListener('click', function () { if (pending) walk(pending, true); });
  $('pl-save-first').addEventListener('click', function () { $('pl-confirm').hidden = true; pending = null; app.saveTrail(); });
  $('pl-cancel').addEventListener('click', function () { $('pl-confirm').hidden = true; pending = null; });
  if (MW.markers) MW.markers.onChange(render);
  if (MW.store) MW.store.onChange(render);
  /* Distances in the list follow the walker; storm peaks appear as the dust record is read. Look every few seconds. */
  var lastKey = '';
  setInterval(function () {
    var h = app.here(), D = MW.dust, recs = D && D.pack && D.record ? D.pack.years.filter(function (y) { return D.record(y.my); }).length : 0;
    var key = Math.round(h.lat * 200) + ',' + Math.round(h.lon * 200) + '|' + recs + '|' + G.SITE.name + '|' + app.savedTrails().length;
    if (key !== lastKey && !document.activeElement.closest('#pl-list')) { lastKey = key; render(); }
    writeHash();                                        // the Timeline's date may have changed without the map moving
  }, 3000);

  render();
  applying = true; applyHash(); applying = false;
  writeHash();
  MW.placesUI = { render: render, view: function (id) { var it = items(true).filter(function (x) { return x.id === id; })[0]; if (it) view(it); return !!it; },
                  walk: function (id, sure) { var it = items(true).filter(function (x) { return x.id === id; })[0]; if (it) walk(it, sure); return !!it; } };
})();
