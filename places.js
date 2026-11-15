/* places.js — MW.places: everything the location selector can take you to, the user's checkpoints, and shareable
 * view links. No map and no panel here (those are in places-ui.js). It also runs under Node (see features_test.js).
 *
 *   MW.places.nasa()                 the 31 NASA places, each { id, kind: 'nasa', group, name, sub, lat, lon, outline, metres, rank }
 *                                    group is 'Planet', 'Landing sites' or 'Gale crater'
 *   MW.places.stops(all)             Curiosity's stops ('Curiosity stops'); every STOP_EVERY-th unless all is true
 *   MW.places.trailEnds(records)     the start and end of each saved trail ('Saved trails')
 *   MW.places.markers(list)          the user's markers ('Your markers')
 *   MW.places.search(q, items)       the items matching q, best first; "sol 4700" also finds that stop
 *   MW.places.checkpoints            list() / save(cp) / remove(id) / toText() / fromText(text) / onChange(fn)
 *                                    a checkpoint: { id, name, lat, lon, zoom, kind: 'view' | 'walker', walker, savedAt }
 *   MW.places.parseHash(hash)        '#map=-4.8,137.38,14&dust=34,205' -> { map: { lat, lon, zoom }, dust: { my, ls } }
 *   MW.places.formatHash(view)       the reverse
 *   MW.places.imageryAt(lat, lon)    the sharpest photo base there: { name, res, zoom }
 *   MW.places.isLocal(lat, lon)      true if the walker can be moved there and keep the present base (within LOCAL_KM)
 *   MW.places.kmFrom(a, b)           distance in km between two { lat, lon }
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var C = MW.config, K = C.PLACES, G = MW.geo, KEY = 'marswalk.checkpoints.v1';

  function kmFrom(a, b) { return G.haversine(a, b) / 1000; }
  function inside(b, lat, lon) { return !b || (lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1]); }
  function imageryAt(lat, lon) { for (var i = 0; i < K.IMAGERY.length; i++) if (inside(K.IMAGERY[i].bounds, lat, lon)) return K.IMAGERY[i]; return K.IMAGERY[K.IMAGERY.length - 1]; }
  function isLocal(lat, lon) { return kmFrom({ lat: lat, lon: lon }, G.ORIGIN) <= K.LOCAL_KM; }

  /* ---------------------------------------------------------------- what can be gone to */
  function nasa() {
    return MW.landmarks.list.map(function (lm) {
      var gale = kmFrom({ lat: lm.at[0], lon: lm.at[1] }, G.GALE) < 120;
      var group = gale ? 'Gale crater' : /^Landing site/.test(lm.role) ? 'Landing sites' : 'Planet';
      return { id: 'lm:' + lm.name, kind: 'nasa', group: group, name: lm.name, sub: lm.role, lat: lm.at[0], lon: lm.at[1],
               outline: lm.outline, metres: lm.metres, rank: lm.rank, landmark: lm };
    });
  }
  function stops(all) {
    var out = [], n = G.WP.length;
    G.WP.forEach(function (w, i) {
      if (!all && i % K.STOP_EVERY && i !== n - 1) return;
      out.push({ id: 'sol:' + w.sol + ':' + i, kind: 'auto', group: 'Curiosity stops', name: 'Curiosity stop, sol ' + w.sol, sub: (i ? 'stop ' + (i + 1) + ' of ' + n : 'Base: the first stop') + ', height ' + Math.round(w.z) + ' m', lat: w.lat, lon: w.lon, sol: w.sol, stop: i });
    });
    return out;
  }
  function trailEnds(records) {
    var out = [];
    (records || []).forEach(function (r) {
      if (!r.points || !r.points.length) return;
      var a = r.points[0], b = r.points[r.points.length - 1], who = r.walker ? r.walker.name + ', ' : '';
      out.push({ id: 'ts:' + r.id, kind: 'auto', group: 'Saved trails', name: r.name + ': start', sub: who + (r.site || ''), lat: a[0], lon: a[1], record: r.id, site: r.site, base: r.base });
      if (r.points.length > 1) out.push({ id: 'te:' + r.id, kind: 'auto', group: 'Saved trails', name: r.name + ': end', sub: who + Math.round(r.distance_m || 0) + ' m from its start along the trail', lat: b[0], lon: b[1], record: r.id, site: r.site, base: r.base });
    });
    return out;
  }
  function markers(list) {
    return (list || []).map(function (m) { return { id: 'mk:' + m.id, kind: 'marker', group: 'Your markers', name: m.name || 'Marker', sub: m.note ? String(m.note).split('\n')[0].slice(0, 80) : 'your marker', lat: m.lat, lon: m.lon, marker: m.id, icon: m.icon }; });
  }
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.\- ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function search(q, items) {
    var t = norm(q); if (!t) return items.slice();
    var sol = /^(?:sol\s*)?(\d{3,5})$/.exec(t), scored = [];
    items.forEach(function (it) {
      var n = norm(it.name), s = norm(it.sub || ''), score = -1;
      if (sol && it.sol !== undefined) { var d = Math.abs(it.sol - +sol[1]); if (d <= 15) score = 100 - d; }
      else if (n === t) score = 90; else if (n.indexOf(t) === 0) score = 80; else if (n.indexOf(' ' + t) >= 0) score = 70;
      else if (n.indexOf(t) >= 0) score = 60; else if (s.indexOf(t) >= 0) score = 40;
      else if (t.split(' ').every(function (w) { return (n + ' ' + s).indexOf(w) >= 0; })) score = 30;
      if (score >= 0) scored.push({ it: it, s: score + (it.rank ? 4 - it.rank : 0) });
    });
    return scored.sort(function (a, b) { return b.s - a.s; }).slice(0, K.MAX_RESULTS).map(function (x) { return x.it; });
  }

  /* ---------------------------------------------------------------- checkpoints, kept in the browser */
  var mem = null, persistent = true, listeners = [];
  function readAll() {
    if (mem) return mem;
    try { mem = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || '[]'); if (!Array.isArray(mem)) mem = []; }
    catch (e) { mem = []; persistent = false; }
    mem = mem.filter(valid);
    return mem;
  }
  function writeAll() {
    try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(mem)); else persistent = false; } catch (e) { persistent = false; }
    listeners.forEach(function (fn) { fn(); });
  }
  function valid(c) { return c && typeof c.lat === 'number' && typeof c.lon === 'number' && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && typeof c.name === 'string'; }
  function clean(c) {
    return { id: c.id || 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: String(c.name).slice(0, 60) || 'Checkpoint',
             lat: +(+c.lat).toFixed(7), lon: +(+c.lon).toFixed(7), zoom: typeof c.zoom === 'number' ? Math.max(1, Math.min(18, c.zoom)) : 14,
             kind: c.kind === 'walker' ? 'walker' : 'view', walker: c.walker || null, site: c.site || null, savedAt: c.savedAt || new Date().toISOString() };
  }
  var checkpoints = {
    list: function () { return readAll().slice(); },
    save: function (c) { var all = readAll(), x = clean(c), i = all.findIndex(function (o) { return o.id === x.id; }); if (i >= 0) all[i] = x; else all.push(x); writeAll(); return x; },
    remove: function (id) { mem = readAll().filter(function (c) { return c.id !== id; }); writeAll(); },
    toText: function () { return JSON.stringify({ format: 'marswalk-checkpoints', version: 1, checkpoints: readAll() }, null, 1); },
    fromText: function (text) {                        // adds the checkpoints in a file; returns how many, or -1 if it is not one
      var d; try { d = JSON.parse(text); } catch (e) { return -1; }
      if (!d || d.format !== 'marswalk-checkpoints' || !Array.isArray(d.checkpoints)) return -1;
      var all = readAll(), ids = new Set(all.map(function (c) { return c.id; })), n = 0;
      d.checkpoints.filter(valid).forEach(function (c) { var x = clean(c); if (ids.has(x.id)) x.id = clean({ name: 'x', lat: 0, lon: 0 }).id; all.push(x); n++; });
      writeAll(); return n;
    },
    onChange: function (fn) { listeners.push(fn); },
    get persistent() { readAll(); return persistent; }
  };

  /* ---------------------------------------------------------------- view links */
  function parseHash(h) {
    var out = {}, s = String(h || '').replace(/^#/, '');
    s.split('&').forEach(function (part) {
      var kv = part.split('='), k = kv[0], v = (kv[1] || '').split(',').map(Number);
      if (k === 'map' && v.length >= 2 && v.every(isFinite) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180)
        out.map = { lat: v[0], lon: v[1], zoom: v.length > 2 ? Math.max(1, Math.min(18, v[2])) : null };
      if (k === 'dust' && v.length === 2 && v.every(isFinite)) out.dust = { my: Math.round(v[0]), ls: ((v[1] % 360) + 360) % 360 };
    });
    return out;
  }
  function formatHash(v) {
    var parts = [];
    if (v.map) parts.push('map=' + v.map.lat.toFixed(5) + ',' + v.map.lon.toFixed(5) + ',' + (+v.map.zoom).toFixed(1).replace(/\.0$/, ''));
    if (v.dust) parts.push('dust=' + v.dust.my + ',' + Math.round(v.dust.ls));
    return parts.length ? '#' + parts.join('&') : '';
  }

  MW.places = { nasa: nasa, stops: stops, trailEnds: trailEnds, markers: markers, search: search, checkpoints: checkpoints,
                parseHash: parseHash, formatHash: formatHash, imageryAt: imageryAt, isLocal: isLocal, kmFrom: kmFrom };
})();
