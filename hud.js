/* hud.js — the readout tabs beside the map, and the mission status in the bottom-right corner of the map.
 *
 *   Readout tabs   The readouts (in #strip) are in three groups: Position, Conditions and Budget. In the side
 *                  layout one group shows at a time; its tab chooses it. A tab with nothing ticked in Settings >
 *                  Display is left out. The choice is kept in the browser (marswalk.roTab). In "Numbers first"
 *                  every group shows at once and the tabs are not needed.
 *   Mission status Oxygen, battery and the live safety index as three small symbols that are always on the map,
 *                  whatever tab or layout is chosen. They turn amber and red at the thresholds below; a press
 *                  explains them. The values are the ones the readouts show (budget.js, router.js live).
 *
 * Loads after app.js and nav-ui.js and reaches them through window.Marswalk and MW.navUI.
 */
(function () {
  'use strict';
  var C = MW.config, $ = MW.geo.$, app = window.Marswalk, settings = MW.settings, KEY = 'marswalk.roTab';
  var WARN = 30, DANGER = 100 * C.BUDGET.RESERVE;      // % left: amber at 30 %, red at the reserve (15 %)

  /* ================================================================ readout tabs */
  var TABS = ['nav', 'env', 'budget-ro'], cur = 'nav';
  try { cur = window.localStorage.getItem(KEY) || 'nav'; } catch (e) {}
  function tabBtn(id) { return document.querySelector('#ro-tabs [data-ro-tab="' + id + '"]'); }
  function syncTabs() {
    var avail = TABS.filter(function (id) { return !$(id).classList.contains('ro-off'); });
    if (avail.indexOf(cur) < 0) cur = avail[0] || 'nav';
    TABS.forEach(function (id) {
      var b = tabBtn(id), sel = id === cur;
      b.hidden = avail.indexOf(id) < 0;
      b.setAttribute('aria-selected', sel); b.tabIndex = sel ? 0 : -1;
      $(id).classList.toggle('ro-active', sel);
    });
    $('ro-tabs').hidden = avail.length < 2;             // one group: no choice to make
  }
  function choose(id) {
    cur = id; syncTabs();
    try { window.localStorage.setItem(KEY, id); } catch (e) {}
  }
  $('ro-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-ro-tab]'); if (b) choose(b.getAttribute('data-ro-tab')); });
  $('ro-tabs').addEventListener('keydown', function (e) {
    var vis = TABS.filter(function (id) { return !tabBtn(id).hidden; }), i = vis.indexOf(cur), j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % vis.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + vis.length - 1) % vis.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = vis.length - 1;
    if (j === null) return;
    e.preventDefault(); e.stopPropagation();             // the arrow keys must not also walk the pointer
    choose(vis[j]); tabBtn(vis[j]).focus();
  });
  settings.onChange(syncTabs);
  syncTabs();

  /* ================================================================ mission status */
  function level(pct) { return pct === null || pct === undefined ? '' : pct <= DANGER ? 'danger' : pct <= WARN ? 'warn' : 'ok'; }
  function set(id, value, state, tip) {
    var b = $(id), v = b.querySelector('b');
    if (v.textContent !== value) v.textContent = value;
    b.className = 'mchip' + (state ? ' ' + state : '');
    b.setAttribute('data-tip', tip); b.setAttribute('aria-label', tip);
  }
  function update() {
    var bu = app.budget(), live = MW.navUI && MW.navUI.live ? MW.navUI.live() : null;
    if (bu) {
      var late = bu.turnS !== null && bu.turnS <= 0;
      if (bu.o2Pct === null) set('m-o2', 'n/a', 'off', 'Oxygen: a robot needs none');
      else set('m-o2', Math.max(0, Math.round(bu.o2Pct)) + '%', late && bu.limit === 'oxygen' ? 'danger' : level(bu.o2Pct),
        'Oxygen left: ' + Math.max(0, Math.round(bu.o2Pct)) + ' % (modelled)' + (late && bu.limit === 'oxygen' ? '. Turn back now' : ''));
      set('m-batt', Math.max(0, Math.round(bu.battPct)) + '%', late && bu.limit === 'battery' ? 'danger' : level(bu.battPct),
        'Battery left: ' + Math.max(0, Math.round(bu.battPct)) + ' % (modelled)' + (bu.chargingW > 0 ? ', charging in sunlight' : '') + (late && bu.limit === 'battery' ? '. Turn back now' : ''));
    }
    if (live && typeof live.index === 'number') {         // the same bands as the route cards (nav-ui.js): 75 and over low risk, 50 to 74 some risk
      var st = live.index >= 75 ? 'ok' : live.index >= 50 ? 'warn' : 'danger', worst = live.worst && live.worst.state !== 'good' ? ' Worst: ' + live.worst.text + '.' : '';
      set('m-risk', String(live.index), st, 'Safety index here: ' + live.index + ' of 100 (' + (st === 'ok' ? 'low risk' : st === 'warn' ? 'some risk' : 'high risk') + ').' + worst);
    } else set('m-risk', '–', 'off', 'Safety index: not worked out (turn on "Safety index, live" in Settings > Display)');
  }
  $('mission').addEventListener('click', function (e) {
    var b = e.target.closest('.mchip'); if (!b) return;
    e.stopPropagation();                                 // the page closes the explanation on any other click; this one opens it
    app.explain(b);
  });
  setInterval(update, 1000); update();

  MW.hud = { tab: function (id) { if (TABS.indexOf(id) >= 0) choose(id); return cur; }, update: update };
})();
