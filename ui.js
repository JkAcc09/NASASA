/* ui.js — MW.ui: the line icons on buttons, and the small label that names an icon button.
 *
 *   MW.ui.icon('play')                       the <svg> for one icon, as text
 *   MW.ui.setButton(btn, 'play', 'Start')    give a button an icon and its words (hover label and screen readers;
 *                                            on a button with class "lb" the words are written beside the icon)
 *
 * In the page, data-icon="name" on an element puts that icon inside it. Any element with data-tip="words"
 * shows those words in a label while the pointer rests on it or it has keyboard focus: below it, or to its
 * right with data-tip-side="right". The label floats over everything, so scrolling panels never clip it.
 */
(function () {
  'use strict';
  var P = {
    route:   '<circle cx="5" cy="18.5" r="2.3"/><circle cx="19" cy="5" r="2.3"/><path d="M7.3 18.5H14a3.6 3.6 0 0 0 0-7.2h-4a3.15 3.15 0 0 1 0-6.3h6.7"/>',
    walk:    '<path class="f" d="M8.2 2.8c-1.8 0-3 2.1-3 4.8 0 2 .8 3.5 1 4.7h3.8c.2-1.2 1-2.7 1-4.7 0-2.7-1.1-4.8-2.8-4.8z"/><path class="f" d="M6.4 13.6h3.8v1.5a1.9 1.9 0 0 1-3.8 0z"/>' +
             '<path class="f" d="M16.2 7.8c-1.8 0-3 2.1-3 4.8 0 2 .8 3.5 1 4.7h3.8c.2-1.2 1-2.7 1-4.7 0-2.7-1.1-4.8-2.8-4.8z"/><path class="f" d="M14.4 18.6h3.8v1.1a1.9 1.9 0 0 1-3.8 0z"/>',
    play:    '<path class="f" d="M7 4.5v15L19.5 12z"/>',
    pause:   '<rect class="f" x="6" y="4.5" width="4" height="15" rx="1"/><rect class="f" x="14" y="4.5" width="4" height="15" rx="1"/>',
    restart: '<path d="M5 12.5a7 7 0 1 0 2.1-5"/><path d="M6.6 3v4.6h4.6"/>',
    speed:   '<path d="M3.6 17.5a9 9 0 1 1 16.8 0"/><path d="M12 14.5l4.2-5.2"/><circle class="f" cx="12" cy="14.5" r="1.7"/>',
    person:  '<circle cx="12" cy="7.5" r="3.8"/><path d="M4.5 20.5c.7-4.3 3.7-6.6 7.5-6.6s6.8 2.3 7.5 6.6"/>',
    locate:  '<circle cx="12" cy="12" r="6.5"/><circle class="f" cx="12" cy="12" r="2.3"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>',
    crater:  '<circle cx="12" cy="12" r="9"/><circle cx="12.6" cy="12.6" r="4.3"/><path d="M9.2 15.3a4.3 4.3 0 0 0 6.8-4.9" stroke-width="3.2" opacity=".45"/>',
    globe:   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z"/>',
    record:  '<circle class="f rec-dot" cx="12" cy="12" r="6.5"/>',
    stop:    '<rect class="f" x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    wayback: '<path d="M9 13.5 4 8.5l5-5"/><path d="M4 8.5h10.5a5.5 5.5 0 0 1 0 11H10"/>',
    trash:   '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 13.5h10l1-13.5M10 10.5v6M14 10.5v6"/>',
    upload:  '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 14.5V20h16v-5.5"/>',
    download:'<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 14.5V20h16v-5.5"/>',
    eye:     '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:  '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>',
    menu:    '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    layers:  '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M2.5 12l9.5 5 9.5-5"/><path d="M2.5 16l9.5 5 9.5-5"/>',
    dust:    '<path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h6"/>',
    clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.5 2.1"/>',
    pin:     '<path d="M12 21.5s-6.5-6.4-6.5-11.3a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11.3-6.5 11.3z"/><circle cx="12" cy="10" r="2.4"/>',
    plus:    '<path d="M12 4.5v15M4.5 12h15"/>',
    star:    '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
    starOn:  '<path class="f" d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/><path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
    edit:    '<path d="M4 20h4l10.5-10.5-4-4L4 16z"/><path d="M13 7l4 4"/>',
    target:  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/>',
    search:  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
    refresh: '<path d="M19 12.5a7 7 0 1 1-2.1-5"/><path d="M17.4 3v4.6h-4.6"/>',
    centre:  '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle class="f" cx="12" cy="12" r="2"/>',
    go:      '<path class="f" d="M4 11.2 20 4l-7.2 16-1.9-6.9z"/>',
    close:   '<path d="M6 6l12 12M18 6 6 18"/>',
    save:    '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    undo:    '<path d="M8 13.5 3.5 9 8 4.5"/><path d="M3.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
    check:   '<path d="M4.5 12.5 10 18l9.5-11"/>',
    bell:    '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'
  };
  function icon(name) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>'; }

  /* ---- the hover label ---- */
  var tip = document.createElement('div'), cur = null, timer = null;
  tip.id = 'tip'; tip.setAttribute('aria-hidden', 'true'); tip.hidden = true; document.body.appendChild(tip);
  function show(el) {
    var t = el.getAttribute('data-tip'); if (!t || !el.isConnected || !el.getClientRects().length) { hide(); return; }
    tip.textContent = t; tip.hidden = false;
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, x, y;
    if (el.getAttribute('data-tip-side') === 'right') { x = r.right + 8; y = r.top + r.height / 2 - h / 2; }
    else { x = r.left + r.width / 2 - w / 2; y = r.bottom + 7; if (y + h > window.innerHeight - 4) y = r.top - h - 7; }
    tip.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, x)) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  function hide() { clearTimeout(timer); tip.hidden = true; }
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el === cur) return;
    cur = el; hide(); if (el) timer = setTimeout(function () { show(el); }, 250);
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el && e.target.matches(':focus-visible')) { cur = el; show(el); }
  });
  document.addEventListener('focusout', function () { if (cur && !cur.matches(':hover')) { cur = null; hide(); } });
  document.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { cur = null; hide(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  function setButton(b, name, label) {
    if (b.classList.contains('lb')) { b.innerHTML = icon(name) + '<span>' + label + '</span>'; return; }      // class "lb": the words show beside the icon
    b.innerHTML = icon(name); b.setAttribute('aria-label', label); b.setAttribute('data-tip', label);
    if (b === cur && !tip.hidden) show(b);                 // the words changed under the pointer (Start becomes Pause)
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (el) { el.insertAdjacentHTML('afterbegin', icon(el.getAttribute('data-icon'))); });

  MW.ui = { icon: icon, setButton: setButton, hideTip: hide };
})();