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
  var DEFAULTS = {
    theme: 'blue', display: 'planner', move: 'hybrid',
    trailColour: 'magenta', trailWidth: 1,
    pointerColour: 'blue', pointerSize: 1,
    walkers: C.DEFAULT_WALKERS, walker: 'w1'
  };
  var v = JSON.parse(JSON.stringify(DEFAULTS)), listeners = [];
  try { var saved = JSON.parse(window.localStorage.getItem(KEY) || '{}'); Object.keys(DEFAULTS).forEach(function (k) { if (saved[k] !== undefined) v[k] = saved[k]; }); } catch (e) {}
  /* Never trust stored values blindly: fall back to the default if a choice no longer exists. */
  if (!C.THEMES[v.theme]) v.theme = DEFAULTS.theme;
  if (!C.DISPLAYS[v.display]) v.display = DEFAULTS.display;
  if (!C.MOVES[v.move]) v.move = DEFAULTS.move;
  if (!C.TRAIL_PALETTES[v.trailColour]) v.trailColour = DEFAULTS.trailColour;
  if (!C.POINTER_COLOURS[v.pointerColour]) v.pointerColour = DEFAULTS.pointerColour;
  if (!Array.isArray(v.walkers) || !v.walkers.length) v.walkers = JSON.parse(JSON.stringify(C.DEFAULT_WALKERS));
  if (!v.walkers.some(function (w) { return w.id === v.walker; })) v.walker = v.walkers[0].id;

  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function walker() { return v.walkers.filter(function (w) { return w.id === v.walker; })[0]; }

  /* Styling that needs no redraw. */
  function applyStyle() {
    var root = document.documentElement.style, pal = C.TRAIL_PALETTES[v.trailColour], pc = C.POINTER_COLOURS[v.pointerColour];
    document.body.setAttribute('data-theme', v.theme);
    document.body.setAttribute('data-display', v.display);
    document.body.setAttribute('data-move', v.move);
    pal.forEach(function (c, i) { root.setProperty('--t' + (i + 1), c); });
    root.setProperty('--me-colour', pc);
    root.setProperty('--me-edge', v.pointerColour === 'white' ? '#0B2545' : '#FFFFFF');
    root.setProperty('--me-scale', v.pointerSize);
  }
  function changed() { save(); applyStyle(); render(); listeners.forEach(function (fn) { fn(v); }); }

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
  function fillWalkers(sel) {
    sel.innerHTML = '';
    v.walkers.forEach(function (w) { var o = document.createElement('option'); o.value = w.id; o.textContent = w.name + (w.type === 'robot' ? ' (robot)' : ''); sel.appendChild(o); });
    sel.value = v.walker;
  }
  function render() {
    choice('set-display', 'display', C.DISPLAYS);
    choice('set-theme', 'theme', C.THEMES);
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
    $('btn-settings').addEventListener('click', function () { var p = $('settings'); p.hidden = !p.hidden; this.setAttribute('aria-expanded', !p.hidden); });
    $('settings-close').addEventListener('click', function () { $('settings').hidden = true; $('btn-settings').setAttribute('aria-expanded', 'false'); $('btn-settings').focus(); });
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
      var keep = { walkers: v.walkers, walker: v.walker };                 // resetting looks does not delete people
      v = JSON.parse(JSON.stringify(DEFAULTS)); v.walkers = keep.walkers; v.walker = keep.walker; changed();
    });
  }

  MW.settings = {
    get: function (k) { return v[k]; },
    set: function (k, val) { v[k] = val; changed(); },
    onChange: function (fn) { listeners.push(fn); },
    walker: walker
  };
  applyStyle(); wire(); render();
})();
