/* settings.js — MW.settings: the user's choices, kept between visits, and the Settings panel.
 *
 *   MW.settings.get('trailColour')        read one value
 *   MW.settings.set('trailColour', 'cyan') change it, save it, tell everyone listening
 *   MW.settings.onChange(fn)              be told after any change (app.js redraws from this)
 *   MW.settings.walker()                  the active walker: { id, name, type }
 *
 * Values live in localStorage under one key. If storage is refused they last for this visit only.
 * The choices offered (palettes, themes, modes) are listed in config.js.
 * Colours that are pure styling (theme, trail swatches, pointer colour and size) are applied here
 * as CSS variables; anything the map has to redraw is left to the listeners.
 */
(function () {
  'use strict';
  var C = MW.config, $ = MW.geo.$, KEY = 'marswalk.settings.v1';
  function readoutDefaults() { var o = {}; C.READOUTS.forEach(function (r) { o[r.key] = r.on; }); return o; }
  var DEFAULTS = {
    theme: 'blue', move: 'hybrid', o2Model: null,       // o2Model: the user's oxygen model (o2-model.js), or null for the defaults
    readouts: readoutDefaults(), roLarge: false, roExact: false, units: 'si', roLayout: 'side',
    alarm: true, alarmSound: true, alarmAt: 50,          // the live safety alarm, and the index below which it sounds
    trailColour: 'magenta', trailWidth: 1,
    pointerColour: 'blue', pointerSize: 1,
    walkers: C.DEFAULT_WALKERS, walker: 'w1'
  };
  var v = JSON.parse(JSON.stringify(DEFAULTS)), listeners = [];
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || '{}'); Object.keys(DEFAULTS).forEach(function (k) { if (saved[k] !== undefined) v[k] = saved[k]; });
    /* Visits from before the readout list kept one of three display modes: carry over what each one meant. */
    if (saved.display === 'astronaut' && saved.roLarge === undefined) v.roLarge = true;
    if (saved.display === 'robot' && saved.roExact === undefined) { v.roExact = true; if (!saved.readouts) v.readouts.ll = true; }
  } catch (e) {}
  /* Never trust stored values blindly: fall back to the default if a choice no longer exists. */
  if (!C.THEMES[v.theme]) v.theme = DEFAULTS.theme;
  var ro = readoutDefaults(); if (v.readouts && typeof v.readouts === 'object') Object.keys(ro).forEach(function (k) { if (typeof v.readouts[k] === 'boolean') ro[k] = v.readouts[k]; }); v.readouts = ro;
  v.roLarge = v.roLarge === true; v.roExact = v.roExact === true;
  if (!v.o2Model || typeof v.o2Model !== 'object') v.o2Model = null;
  if (v.roLayout === 'row' || v.roLayout === 'column') v.roLayout = 'side';   // the strip under the map and the plain column are now the tabs beside it
  if (!C.UNITS[v.units]) v.units = DEFAULTS.units;
  if (!C.RO_LAYOUTS[v.roLayout]) v.roLayout = DEFAULTS.roLayout;
  v.alarm = v.alarm !== false; v.alarmSound = v.alarmSound !== false;
  if (C.ALARM_LEVELS.indexOf(+v.alarmAt) < 0) v.alarmAt = DEFAULTS.alarmAt; else v.alarmAt = +v.alarmAt;
  if (!C.MOVES[v.move]) v.move = DEFAULTS.move;
  if (!C.TRAIL_PALETTES[v.trailColour]) v.trailColour = DEFAULTS.trailColour;
  if (!C.POINTER_COLOURS[v.pointerColour]) v.pointerColour = DEFAULTS.pointerColour;
  if (!Array.isArray(v.walkers) || !v.walkers.length) v.walkers = JSON.parse(JSON.stringify(C.DEFAULT_WALKERS));
  if (!v.walkers.some(function (w) { return w.id === v.walker; })) v.walker = v.walkers[0].id;

  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function walker() { return v.walkers.filter(function (w) { return w.id === v.walker; })[0]; }

  /* Styling that needs no redraw. A new theme fades in over half a second instead of switching at once
     (html.theme-fade in the stylesheet), unless the system asks for less motion. */
  var fadeTimer = null, reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function applyStyle() {
    var root = document.documentElement.style, pal = C.TRAIL_PALETTES[v.trailColour], pc = C.POINTER_COLOURS[v.pointerColour];
    var was = document.body.getAttribute('data-theme');
    if (was && was !== v.theme && !reduceMotion.matches) {
      document.documentElement.classList.add('theme-fade'); clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () { document.documentElement.classList.remove('theme-fade'); }, 700);
    }
    document.body.setAttribute('data-theme', v.theme);
    document.body.classList.toggle('ro-large', v.roLarge);
    document.body.classList.toggle('ro-exact', v.roExact);
    document.body.classList.toggle('ro-col', v.roLayout === 'side');      // the readouts in tabs beside the map (hud.js)
    applyReadouts();
    document.body.classList.toggle('ro-focus', v.roLayout === 'focus' && !document.body.classList.contains('ro-empty'));   // numbers first: needs numbers to show
    document.body.setAttribute('data-move', v.move);
    pal.forEach(function (c, i) { root.setProperty('--t' + (i + 1), c); });
    root.setProperty('--me-colour', pc);
    root.setProperty('--me-edge', v.pointerColour === 'white' ? '#0B2545' : '#FFFFFF');
    root.setProperty('--me-scale', v.pointerSize);
  }
  function changed() { save(); applyStyle(); render(); listeners.forEach(function (fn) { fn(v); }); }

  /* Show or hide each readout along the bottom. A column with nothing ticked folds away, and so does the strip. */
  function applyReadouts() {
    Array.prototype.forEach.call(document.querySelectorAll('#strip [data-ro]'), function (el) { el.classList.toggle('ro-off', !v.readouts[el.getAttribute('data-ro')]); });
    var any = false;
    Array.prototype.forEach.call(document.querySelectorAll('#strip > dl'), function (dl) {
      var on = Array.prototype.some.call(dl.querySelectorAll('[data-ro]'), function (el) { return v.readouts[el.getAttribute('data-ro')]; });
      dl.classList.toggle('ro-off', !on); any = any || on;
    });
    $('strip').classList.toggle('ro-off', !any); document.body.classList.toggle('ro-empty', !any);
  }
  function readoutList() {
    var box = $('set-readouts'); if (box.childElementCount) { syncReadouts(); return; }    // built once; afterwards only the ticks change
    var groups = {};
    C.READOUTS.forEach(function (r) {
      if (!groups[r.group]) {
        var h = document.createElement('h4'); h.textContent = r.group; box.appendChild(h);
        groups[r.group] = document.createElement('div'); groups[r.group].className = 'ro-list'; box.appendChild(groups[r.group]);
      }
      var l = document.createElement('label'), i = document.createElement('input'), t = document.createElement('span'), d = document.createElement('span');
      l.className = 'check'; i.type = 'checkbox'; i.setAttribute('data-ro-set', r.key);
      t.textContent = r.name; d.className = 'dsub'; d.textContent = r.what; t.appendChild(d);
      i.addEventListener('change', function () { v.readouts[r.key] = this.checked; changed(); });
      l.appendChild(i); l.appendChild(t); groups[r.group].appendChild(l);
    });
    syncReadouts();
  }
  function syncReadouts() {
    Array.prototype.forEach.call(document.querySelectorAll('#set-readouts input[data-ro-set]'), function (i) { i.checked = !!v.readouts[i.getAttribute('data-ro-set')]; });
    $('set-ro-large').checked = v.roLarge; $('set-ro-exact').checked = v.roExact;
    $('set-alarm').checked = v.alarm; $('set-alarm-sound').checked = v.alarmSound; $('set-alarm-sound').disabled = !v.alarm;
    var sel = $('set-alarm-at');
    if (!sel.options.length) C.ALARM_LEVELS.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = 'below ' + n; sel.appendChild(o); });
    sel.value = v.alarmAt; sel.disabled = !v.alarm;
  }

  /* The full-screen page: opened by the gear, closed by Done or Escape. Focus stays inside while it is open. */
  var opener = null;
  function openPage() {
    opener = document.activeElement; $('settings').hidden = false; $('btn-settings').setAttribute('aria-expanded', 'true');
    document.body.classList.add('set-open'); $('settings-close').focus();
  }
  function closePage() {
    if ($('settings').hidden) return;
    $('settings').hidden = true; $('btn-settings').setAttribute('aria-expanded', 'false'); document.body.classList.remove('set-open');
    (opener && opener.isConnected ? opener : $('btn-settings')).focus();
  }

  /* ---------------- the panel ---------------- */
  function swatches(boxId, key, choices, paint) {
    var box = $(boxId); box.innerHTML = '';
    Object.keys(choices).forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', v[key] === name);
      b.style.background = paint(choices[name]);
      b.addEventListener('click', function () { v[key] = name; changed(); });
      box.appendChild(b);
    });
  }
  function choice(boxId, key, choices) {
    var box = $(boxId); box.innerHTML = '';
    Object.keys(choices).forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = choices[name]; b.setAttribute('aria-pressed', v[key] === name);
      b.addEventListener('click', function () { v[key] = name; changed(); });
      box.appendChild(b);
    });
  }
  function themeTiles() {                              // one tile per theme, painted in that theme's own colours
    var box = $('set-theme'); box.innerHTML = '';
    Object.keys(C.THEMES).forEach(function (name) {
      var b = document.createElement('button'), pv = document.createElement('span'), t = document.createElement('span');
      b.type = 'button'; b.setAttribute('aria-pressed', v.theme === name);
      pv.className = 'tt-prev'; pv.setAttribute('data-theme-preview', name); pv.setAttribute('aria-hidden', 'true'); pv.innerHTML = '<i></i><i></i><i></i>';
      t.textContent = C.THEMES[name];
      b.appendChild(pv); b.appendChild(t);
      b.addEventListener('click', function () { v.theme = name; changed(); });
      box.appendChild(b);
    });
  }
  function fillWalkers(sel) {
    sel.innerHTML = '';
    v.walkers.forEach(function (w) { var o = document.createElement('option'); o.value = w.id; o.textContent = w.name + (w.type === 'robot' ? ' (robot)' : ''); sel.appendChild(o); });
    sel.value = v.walker;
  }
  function render() {
    readoutList();
    choice('set-units', 'units', C.UNITS);
    choice('set-layout', 'roLayout', C.RO_LAYOUTS);
    themeTiles();
    choice('set-move', 'move', C.MOVES);
    swatches('set-trail-colour', 'trailColour', C.TRAIL_PALETTES, function (p) { return 'linear-gradient(90deg,' + p.join(',') + ')'; });
    swatches('set-pointer-colour', 'pointerColour', C.POINTER_COLOURS, function (c) { return c; });
    $('set-trail-width').value = v.trailWidth; $('set-pointer-size').value = v.pointerSize;
    fillWalkers($('set-walker')); fillWalkers($('walker'));
    var w = walker();
    $('set-walker-name').value = w.name; $('set-walker-type').value = w.type;
    $('set-walker-remove').disabled = v.walkers.length < 2;
  }

  function wire() {
    $('btn-settings').addEventListener('click', function () { if ($('settings').hidden) openPage(); else closePage(); });
    $('settings-close').addEventListener('click', closePage);
    $('settings').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closePage(); return; }
      if (e.key !== 'Tab') return;                                            // keep Tab inside the page
      var f = Array.prototype.filter.call(this.querySelectorAll('button, input, select'), function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    $('set-ro-all').addEventListener('click', function () { Object.keys(v.readouts).forEach(function (k) { v.readouts[k] = true; }); changed(); });
    $('set-ro-none').addEventListener('click', function () { Object.keys(v.readouts).forEach(function (k) { v.readouts[k] = false; }); changed(); });
    $('set-ro-large').addEventListener('change', function () { v.roLarge = this.checked; changed(); });
    $('set-ro-exact').addEventListener('change', function () { v.roExact = this.checked; changed(); });
    $('set-alarm').addEventListener('change', function () { v.alarm = this.checked; changed(); });
    $('set-alarm-sound').addEventListener('change', function () { v.alarmSound = this.checked; changed(); });
    $('set-alarm-at').addEventListener('change', function () { v.alarmAt = +this.value; changed(); });
    $('set-trail-width').addEventListener('input', function () { v.trailWidth = +this.value; changed(); });
    $('set-pointer-size').addEventListener('input', function () { v.pointerSize = +this.value; changed(); });
    [$('set-walker'), $('walker')].forEach(function (sel) { sel.addEventListener('change', function () { v.walker = this.value; changed(); }); });
    $('set-walker-name').addEventListener('change', function () { var n = this.value.trim().slice(0, 30); if (n) { walker().name = n; changed(); } else this.value = walker().name; });
    $('set-walker-type').addEventListener('change', function () { walker().type = this.value; changed(); });
    $('set-walker-add').addEventListener('click', function () {
      var id = 'w' + Date.now().toString(36);
      v.walkers.push({ id: id, name: 'Walker ' + (v.walkers.length + 1), type: 'astronaut' }); v.walker = id; changed();
      $('set-walker-name').focus(); $('set-walker-name').select();
    });
    $('set-walker-remove').addEventListener('click', function () {
      if (v.walkers.length < 2) return;
      v.walkers = v.walkers.filter(function (w) { return w.id !== v.walker; }); v.walker = v.walkers[0].id; changed();
    });
    $('set-reset').addEventListener('click', function () {
      var keep = { walkers: v.walkers, walker: v.walker , o2Model: v.o2Model };                 // resetting looks does not delete people
      v = JSON.parse(JSON.stringify(DEFAULTS)); v.walkers = keep.walkers; v.o2Model = keep.o2Model; v.walker = keep.walker; changed();
    });
  }

  MW.settings = {
    get: function (k) { return v[k]; },
    set: function (k, val) { v[k] = val; changed(); },
    onChange: function (fn) { listeners.push(fn); },
    walker: walker,
    open: openPage, close: closePage
  };
  applyStyle(); wire(); render();
})();
