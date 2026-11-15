/* markers.js — MW.markers: the user's own markers, their icons and the filter that says which are shown.
 * No map and no panel here (those are in nav-ui.js): this file keeps the data and draws an icon as text.
 *
 * A marker is a point anywhere on the planet with a name, a description and an icon:
 *   { id, name, note, icon, lat, lon, radius, by, createdAt }
 *   icon     'pin' (default), 'home', 'crater', 'danger', or 'c:<id>' for a picture the user uploaded
 *   radius   danger markers only: the keep-clear distance in metres that routes respect
 *   by       the walker who placed it
 * What the route-finder does with each icon is listed in MARKER_ICONS in config.js.
 *
 *   MW.markers.list() / get(id) / save(marker) / remove(id)
 *   MW.markers.icons.custom() / add(dataUrl, name) / remove(id)     uploaded pictures, kept as small PNGs
 *   MW.markers.filter.get() / set(f) / shows(marker)                which markers the map shows; all on at first
 *   MW.markers.badge(icon)        the teardrop badge for the map, as HTML
 *   MW.markers.art(icon)          the bare icon, as HTML (for buttons and lists)
 *   MW.markers.render(note)       a description as safe HTML: **bold**, *italic*, `code`, lists, [links](https://…)
 *   MW.markers.onChange(fn)       be told after any change
 *
 * Everything lives in the browser's localStorage. If storage is refused it lasts for this visit only and
 * MW.markers.persistent is false, so the page can say so.
 */
(function () {
  'use strict';
  var C = MW.config, KEY = 'marswalk.markers.v1', ICON_KEY = 'marswalk.marker-icons.v1', FILTER_KEY = 'marswalk.marker-filter.v1';
  var persistent = true, mem = {}, listeners = [];

  function read(key, fallback) {
    try { var t = window.localStorage.getItem(key); return t ? JSON.parse(t) : (mem[key] !== undefined ? mem[key] : fallback); }
    catch (e) { persistent = false; return mem[key] !== undefined ? mem[key] : fallback; }
  }
  function write(key, value) {
    mem[key] = value;
    try { window.localStorage.setItem(key, JSON.stringify(value)); persistent = true; return true; }
    catch (e) { persistent = false; return false; }
  }
  function changed(what) { listeners.forEach(function (fn) { fn(what); }); }
  function newId(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  /* ---------------- the four built-in icons: 24 x 24 line drawings, the same family as the buttons (ui.js) ---------------- */
  var ART = {
    pin:    '<path d="M12 21.5s-6.5-6.4-6.5-11.3a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11.3-6.5 11.3z"/><circle cx="12" cy="10" r="2.4"/>',
    home:   '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 9.8V20h12V9.8"/><path d="M10 20v-5.5h4V20"/>',
    crater: '<ellipse cx="12" cy="13.5" rx="9" ry="5"/><path d="M6.2 12.6c1.6 2.3 10 2.3 11.6 0"/><path d="M12 5.5V3M7 6.8 5.6 4.8M17 6.8l1.4-2"/>',
    danger: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v5"/><circle class="f" cx="12" cy="17.2" r="1.1"/>'
  };
  function isCustom(icon) { return typeof icon === 'string' && icon.indexOf('c:') === 0; }
  function customIcons() { var l = read(ICON_KEY, []); return Array.isArray(l) ? l : []; }
  function customOf(icon) { var id = icon.slice(2); return customIcons().filter(function (c) { return c.id === id; })[0] || null; }
  function valid(icon) { return C.MARKER_ICONS[icon] ? icon : isCustom(icon) && customOf(icon) ? icon : 'pin'; }
  function colourOf(icon) { return C.MARKER_ICONS[icon] ? C.MARKER_ICONS[icon].colour : '#FFFFFF'; }
  function nameOf(icon) { var c; return C.MARKER_ICONS[icon] ? C.MARKER_ICONS[icon].name : (c = isCustom(icon) && customOf(icon)) ? c.name : 'Pin'; }
  /* The bare icon: a line drawing, or the uploaded picture. */
  function art(icon) {
    icon = valid(icon);
    if (isCustom(icon)) return '<img class="mk-art-img" alt="" src="' + customOf(icon).data + '">';
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ART[icon] + '</svg>';
  }
  /* The badge on the map: a teardrop in the icon's colour whose tip is the exact spot. */
  function badge(icon) {
    icon = valid(icon);
    var custom = isCustom(icon);
    return '<svg class="mk-drop" viewBox="0 0 36 46" aria-hidden="true" focusable="false"><path d="M18 44.5C18 44.5 3.5 28.5 3.5 17a14.5 14.5 0 0 1 29 0C32.5 28.5 18 44.5 18 44.5z" fill="' + (custom ? '#FFFFFF' : colourOf(icon)) + '" stroke="' + (custom ? '#14202B' : '#FFFFFF') + '" stroke-width="2.4"/>' +
      (custom ? '' : '<g class="mk-art" transform="translate(7.2 6.2) scale(0.9)">' + ART[icon] + '</g>') + '</svg>' +
      (custom ? '<img class="mk-drop-img" alt="" src="' + customOf(icon).data + '">' : '');
  }

  /* ---------------- markers ---------------- */
  function clean(m) {
    if (!m || !isFinite(m.lat) || !isFinite(m.lon) || Math.abs(m.lat) > 90) return null;
    var icon = valid(m.icon), r = +m.radius;
    return {
      id: m.id || newId('m'), name: String(m.name || '').trim().slice(0, 60) || 'Marker', note: String(m.note || '').slice(0, 2000),
      icon: icon, lat: +(+m.lat).toFixed(7), lon: +((((+m.lon + 540) % 360) - 180)).toFixed(7),
      radius: icon === 'danger' ? Math.max(5, Math.min(5000, isFinite(r) && r > 0 ? r : C.ROUTER.DANGER_RADIUS)) : null,
      by: m.by ? String(m.by).slice(0, 30) : null, createdAt: m.createdAt || new Date().toISOString()
    };
  }
  function list() { var l = read(KEY, []); return Array.isArray(l) ? l.map(clean).filter(Boolean) : []; }
  function save(m) {
    var rec = clean(m); if (!rec) return null;
    var l = list().filter(function (x) { return x.id !== rec.id; }); l.push(rec); write(KEY, l); changed('markers'); return rec;
  }
  function remove(id) { write(KEY, list().filter(function (x) { return x.id !== id; })); var f = filterGet(); delete f.hidden[id]; write(FILTER_KEY, f); changed('markers'); }

  /* ---------------- uploaded icons ---------------- */
  function addIcon(dataUrl, name) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png;base64,') !== 0) return { error: 'That picture could not be read.' };
    var l = customIcons();
    if (l.length >= C.MARKER_MAX_ICONS) return { error: 'You can keep ' + C.MARKER_MAX_ICONS + ' icons of your own. Remove one first.' };
    var rec = { id: newId('i'), name: String(name || 'My icon').replace(/\.[a-z0-9]+$/i, '').slice(0, 30) || 'My icon', data: dataUrl };
    l.push(rec);
    if (!write(ICON_KEY, l)) { mem[ICON_KEY] = l; }                              // storage full or refused: keep it for this visit
    changed('icons'); return { icon: 'c:' + rec.id, persistent: persistent };
  }
  function removeIcon(id) {
    id = String(id).replace(/^c:/, '');
    write(ICON_KEY, customIcons().filter(function (c) { return c.id !== id; }));
    var l = list(), hit = false; l.forEach(function (m) { if (m.icon === 'c:' + id) { m.icon = 'pin'; hit = true; } });   // markers that used it fall back to the pin
    if (hit) write(KEY, l);
    changed('icons');
  }

  /* ---------------- the filter: which markers the map shows. Everything is on until the user turns something off. ---------------- */
  function filterGet() {
    var f = read(FILTER_KEY, null), out = { icons: {}, custom: true, places: true, hidden: {} };
    Object.keys(C.MARKER_ICONS).forEach(function (k) { out.icons[k] = !(f && f.icons && f.icons[k] === false); });
    if (f) { out.custom = f.custom !== false; out.places = f.places !== false; if (f.hidden && typeof f.hidden === 'object') Object.keys(f.hidden).forEach(function (id) { if (f.hidden[id]) out.hidden[id] = true; }); }
    return out;
  }
  function filterSet(f) { write(FILTER_KEY, f); changed('filter'); }
  function shows(m, f) {
    f = f || filterGet();
    if (f.hidden[m.id]) return false;
    return isCustom(m.icon) ? f.custom : f.icons[m.icon] !== false;
  }
  function filterAllOn() { var f = filterGet(), h = Object.keys(f.hidden).length; Object.keys(f.icons).forEach(function (k) { if (!f.icons[k]) h++; }); return !h && f.custom && f.places; }

  /* ---------------- descriptions: a little Markdown, made safe ---------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(t) {
    return t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  }
  function render(note) {
    var out = '', inList = false;
    String(note || '').split(/\r?\n/).forEach(function (line) {
      var t = esc(line.trim()), li = /^[-*]\s+(.*)$/.exec(t), h = /^#{1,3}\s+(.*)$/.exec(t);
      if (li) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inline(li[1]) + '</li>'; return; }
      if (inList) { out += '</ul>'; inList = false; }
      if (!t) return;
      out += h ? '<p><strong>' + inline(h[1]) + '</strong></p>' : '<p>' + inline(t) + '</p>';
    });
    return out + (inList ? '</ul>' : '');
  }

  MW.markers = {
    get persistent() { return persistent; },
    list: list, get: function (id) { return list().filter(function (m) { return m.id === id; })[0] || null; }, save: save, remove: remove,
    icons: { custom: customIcons, add: addIcon, remove: removeIcon, isCustom: isCustom, name: nameOf, colour: colourOf, valid: valid },
    filter: { get: filterGet, set: filterSet, shows: shows, allOn: filterAllOn },
    badge: badge, art: art, render: render, escape: esc,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
