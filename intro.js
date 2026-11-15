/* intro.js — the start screen, the question a first visit is asked, and the guided tour.
 *
 *   Start screen   #intro in index.html, shown from the first moment while the scripts and the NASA data load.
 *                  When the page is ready it says "Tap anywhere to begin"; a tap, a click or any key enters the app.
 *                  A tap before then is remembered and enters as soon as the page is ready.
 *   First visit    after entering, a browser that has never answered is asked whether it wants the tour
 *                  (#tour-ask). Either answer is kept (localStorage marswalk.tour.v1), so it is asked once.
 *   The tour       a spotlight on one part of the screen at a time, with a card that says what it is for. Back, Next,
 *                  End tour; the arrow keys and Escape work too. It only looks: clicks outside the card are held back,
 *                  so nothing changes by accident. It opens the panel each step talks about. The Tutorial button in the
 *                  top bar (#btn-tour) starts it any time.
 *
 *   MW.intro.skip()         hide the start screen at once and do not ask about the tour on this visit (tests, embeds);
 *                           index.html?intro=0 does the same
 *   MW.intro.tour.start()   start the tour; .end(), .go(i), .active, .steps
 *
 * Loads last.
 */
(function () {
  'use strict';
  var $ = MW.geo.$, app = window.Marswalk, KEY = 'marswalk.tour.v1';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stored() { try { return window.localStorage.getItem(KEY); } catch (e) { return 'unavailable'; } }
  function remember(v) { try { window.localStorage.setItem(KEY, v); } catch (e) {} }

  /* ================================================================ the start screen */
  var intro = $('intro'), ready = false, queued = false, gone = false, noAsk = false, shownAt = Date.now();
  document.body.classList.add('intro-open');
  function setReady() {
    if (ready || gone) return;
    var wait = Math.max(0, 900 - (Date.now() - shownAt));            // long enough to be read, never a wait for its own sake
    setTimeout(function () {
      ready = true; intro.classList.add('ready');
      /* the app is drawn under the start screen from now on, with its panels already in their "before" places on layers
         of their own, so a tap only has to start them moving (style.css, "the panels arrive") */
      document.body.classList.add('intro-ready', 'landing', 'arriving');
      $('intro-status').textContent = app && app._map ? 'Ready. Map, route and NASA data loaded.' : 'Ready.';
      $('intro-go').removeAttribute('aria-hidden');
      if (queued) enter();
    }, wait);
  }
  /* The scene (globe.js) draws itself, in a worker of its own where the browser allows, so nothing here runs per frame.
     Once its first frame is up it fades in over the painted planet. */
  var globeOn = false;
  if (MW.globe) MW.globe.ready.then(function (ok) { if (!ok || gone) return; globeOn = true; intro.classList.add('globe-on'); });
  function finish() {                                               // the start screen is gone: the app is the user's
    clearTimeout(leaving); leaving = 0;
    intro.hidden = true; document.body.classList.remove('intro-open', 'intro-ready', 'arriving', 'landing');
    if (MW.globe) MW.globe.stop();
    if (app && app._map) app._map.invalidateSize({ pan: false });
    var first = document.querySelector('#bar button'); if (first) first.focus({ preventScroll: true });
    if (!noAsk && !stored()) ask();
  }
  /* Entering: Mars, its moon and the orbiter drift off to the left and fade, the words drift right and fade, the dark
     sky fades to show the map, and the panels slide in from their own edges, one after another (style.css, "the panels
     arrive"). About 1.3 s; a tap or key during it skips to the end. With reduced motion asked for, everything fades. */
  var leaving = 0;
  function enter() {
    if (gone) { if (leaving) finish(); return; }
    if (!ready) { queued = true; $('intro-status').textContent = 'Almost ready…'; return; }
    gone = true; MW.quietUntil = performance.now() + 1700;            // background work waits until the panels are in (dust-ui.js)
    document.body.classList.add('intro-ready', 'landing', 'arriving'); intro.classList.add('leaving');
    if (MW.globe) setTimeout(function () { MW.globe.stop(); }, reduce ? 0 : 800);   // faded out by then: the GPU is the panels'
    setTimeout(function () { document.body.classList.remove('arriving'); }, reduce ? 0 : 380);
    leaving = setTimeout(finish, reduce ? 300 : 1350);
  }
  function skip() { noAsk = true; gone = true; ready = true; finish(); }
  intro.addEventListener('pointerdown', function (e) { e.preventDefault(); enter(); });
  window.addEventListener('keydown', function (e) {                 // capture: no key reaches the map while it shows
    if (gone && !leaving) return;
    if (e.key === 'Tab' || e.key === 'Shift' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation(); enter();
  }, true);
  if (/[?&]intro=0\b/.test(location.search)) skip();
  else {
    if (document.readyState === 'complete') setReady(); else window.addEventListener('load', setReady);
    setTimeout(setReady, 5000);                                     // a slow tile server never holds the door shut
    intro.tabIndex = -1; intro.focus({ preventScroll: true });
  }

  /* ================================================================ the question for a first visit */
  function ask() { $('tour-ask').hidden = false; $('tour-yes').focus(); }
  function answer(yes) { $('tour-ask').hidden = true; remember(yes ? 'taken' : 'declined'); if (yes) tour.start(); else $('btn-tour').focus(); }
  $('tour-yes').addEventListener('click', function () { answer(true); });
  $('tour-no').addEventListener('click', function () { answer(false); });
  $('tour-ask').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); answer(false); }
    if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === $('tour-yes') ? $('tour-no') : $('tour-yes')).focus(); }
    e.stopPropagation();                                            // the arrow keys must not walk the pointer behind it
  });

  /* ================================================================ the tour */
  function el(sel) { return document.querySelector(sel); }
  function openTab(name) { if (app && app.openTab) app.openTab(name); }
  function shown(e) { if (!e || e.hidden) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; }
  var STEPS = [
    { title: 'Welcome to Marswalk',
      text: 'A field map for one walk on Mars, at the Mount Sharp boxwork in Gale crater, built from NASA data. It shows where the walker is, what the ground and the weather are like, how safe it is, and the way back. This tour points out each part.' },
    { at: function () { return el('.me svg') || el('.me'); }, pad: 34, title: 'You are the arrow',
      text: 'The arrow is the walker, an astronaut or a robot, pointing the way it faces. The magenta line behind it is your trail: it darkens each time you cross the same ground. Drag the map to look around and scroll or pinch to zoom.' },
    { at: function () { return el('#bar .seg'); }, title: 'Who moves the walker',
      text: 'Left: replay Curiosity’s real drive. Right: walk it yourself with W A S D or the arrow keys, or tap the map to walk to a spot.' },
    { at: function () { return [el('#btn-play'), el('#speed')]; }, title: 'Start and speed',
      text: 'Start, pause and resume the walk, and choose how fast time runs: real time up to 120 times faster.' },
    { at: function () { return [el('#tp-undo'), el('#tp-redo')]; }, pad: 8, title: 'Undo a teleport',
      text: 'Teleporting moves the walker somewhere at once. These two undo and redo it: the walker goes back with the trail it had, its distance, time and walk budget. Ctrl+Z and Ctrl+Y do the same.' },
    { at: function () { return el('#tabs'); }, title: 'The panels',
      text: 'These five buttons open the panel beside them: Menu, Markers and routes, Map overlay (NASA data layers), Dust storm and Timeline. Press the open one again to fold the panel away and give the map more room.' },
    { before: function () { openTab('menu'); }, at: function () { return el('#places-sec'); }, title: 'Go to a place',
      text: 'Search for a place, a marker, a checkpoint or a Curiosity stop. Beside each one: the arrow shows it on the map, the route symbol finds the safest ways to walk there, and the bolt teleports the walker there at once.' },
    { before: function () { openTab('nav'); }, at: function () { return el('#nav-route'); }, title: 'Find a route',
      text: 'Type a destination or pick it on the map. Every way there gets a safety index from 0 to 100, with the reasons: dust, slope, climb, time out, daylight, distance from base. If there is no safe way, it says why.' },
    { at: function () { return [el('#strip'), el('#ro-tabs')]; }, title: 'Readouts',
      text: 'Where the walker is and how it is going: position, height, slope, bearing, distance and time; the weather, radiation and dust; and the walk budget. The three square buttons switch between Position, Conditions and Budget. Settings chooses which show.' },
    { at: function () { return el('#mission'); }, pad: 10, title: 'Oxygen, battery and safety',
      text: 'Always on the map, whatever is open. They turn amber, then red, when oxygen or battery runs low or the ground gets risky. Press one for what it means.' },
    { title: 'Right-click the map',
      text: 'Right-click any spot (hold a finger on it on a touch screen) for a menu: reveal what is known about it, see a NASA picture of it, find routes there, teleport there, or mark it as a landmark.' },
    { before: function () { openTab('menu'); var t = el('#trail-sec'); if (t) t.scrollIntoView({ block: 'start' }); }, at: function () { return [el('#trail-sec'), el('#saved-sec')]; }, title: 'Trails and sample trails',
      text: 'Record a trail, save it, edit it, or show the way back. Saved trails can be replayed, downloaded as a file and imported again. Five sample trails are ready to try.' },
    { at: function () { return el('#btn-settings'); }, pad: 8, title: 'Settings',
      text: 'Choose the readouts, the units, the layout, the safety alarm, the oxygen model, the walkers, the trail and pointer colours, and eight colour themes.' },
    { at: function () { return el('#btn-tour'); }, pad: 8, title: 'That’s the tour',
      text: 'The Tutorial button brings it back any time. Small (i) buttons beside technical words explain them. Have a good walk.' }
  ];
  var cur = -1, box = $('tour'), hole = $('tour-hole'), card = $('tour-card');
  function targetRect(s) {
    if (!s.at) return null;
    var list = [].concat(s.at()).filter(shown); if (!list.length) return null;
    var r = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, p = s.pad === undefined ? 6 : s.pad;
    list.forEach(function (e) { var b = e.getBoundingClientRect(); r.left = Math.min(r.left, b.left); r.top = Math.min(r.top, b.top); r.right = Math.max(r.right, b.right); r.bottom = Math.max(r.bottom, b.bottom); });
    r.left = Math.max(4, r.left - p); r.top = Math.max(4, r.top - p); r.right = Math.min(innerWidth - 4, r.right + p); r.bottom = Math.min(innerHeight - 4, r.bottom + p);
    return r;
  }
  function place() {
    if (cur < 0) return;
    var r = targetRect(STEPS[cur]), gap = 14, w = card.offsetWidth, h = card.offsetHeight, x, y;
    box.classList.toggle('free', !r);
    if (!r) { x = (innerWidth - w) / 2; y = (innerHeight - h) / 2; }
    else {
      hole.style.left = r.left + 'px'; hole.style.top = r.top + 'px'; hole.style.width = (r.right - r.left) + 'px'; hole.style.height = (r.bottom - r.top) + 'px';
      var room = { right: innerWidth - r.right, left: r.left, below: innerHeight - r.bottom, above: r.top };
      if (room.right >= w + gap + 8) { x = r.right + gap; y = r.top; }
      else if (room.left >= w + gap + 8) { x = r.left - gap - w; y = r.top; }
      else if (room.below >= h + gap + 8) { x = r.left; y = r.bottom + gap; }
      else if (room.above >= h + gap + 8) { x = r.left; y = r.top - gap - h; }
      else { x = (innerWidth - w) / 2; y = innerHeight - h - 16; }          // a big target: the card sits over its lower edge
    }
    card.style.left = Math.round(Math.max(8, Math.min(x, innerWidth - w - 8))) + 'px';
    card.style.top = Math.round(Math.max(8, Math.min(y, innerHeight - h - 8))) + 'px';
  }
  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    cur = i; var s = STEPS[i];
    if (s.before) s.before();
    $('tour-step').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    $('tour-title').textContent = s.title; $('tour-text').textContent = s.text;
    $('tour-back').disabled = i === 0;
    $('tour-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    requestAnimationFrame(function () { place(); requestAnimationFrame(place); });      // after the panel it opened has laid out
    card.focus({ preventScroll: true });
  }
  function start() {
    if (!gone) skip();
    $('tour-ask').hidden = true; if (MW.settings && MW.settings.close) MW.settings.close();
    if (window.MW && MW.ctxMenu && MW.ctxMenu.close) MW.ctxMenu.close();
    box.hidden = false; document.body.classList.add('touring'); go(0);
  }
  function end() {
    if (cur < 0) return;
    cur = -1; box.hidden = true; document.body.classList.remove('touring'); remember('taken');
    if (window.matchMedia('(max-width: 860px)').matches) { if (app.closeDrawer) app.closeDrawer(); } else openTab('menu');   // a phone gets its map back
    $('btn-tour').focus();
  }
  $('tour-next').addEventListener('click', function () { if (cur === STEPS.length - 1) end(); else go(cur + 1); });
  $('tour-back').addEventListener('click', function () { go(cur - 1); });
  $('tour-end').addEventListener('click', end);
  $('tour-shade').addEventListener('click', function () { card.focus(); });
  window.addEventListener('keydown', function (e) {                  // capture: while touring, keys drive the tour only
    if (cur < 0) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); $('tour-next').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (cur > 0) go(cur - 1); }
    else if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(card.querySelectorAll('button'), function (b) { return !b.disabled; }), k = f.indexOf(document.activeElement);
      e.preventDefault(); f[(k + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
    }
    else if (e.key !== 'Enter' && e.key !== ' ') e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);
  $('btn-tour').addEventListener('click', start);

  var tour = { start: start, end: end, go: go, steps: STEPS, get active() { return cur >= 0; }, get step() { return cur; } };
  MW.intro = { skip: skip, enter: enter, ask: ask, tour: tour, get ready() { return ready; }, get shown() { return !intro.hidden; }, get leaving() { return !!leaving; }, get globe() { return globeOn; } };
})();
