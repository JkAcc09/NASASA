/* season.js — MW.season: the best season for a walk at one place, from the whole dust record.
 * The arithmetic runs under Node too (features_test.js); the chart and text in the Dust Storm tab are drawn
 * only in a page that has them (#season-chart).
 *
 *   MW.season.profile(cell)           for every 5° of Ls: { ls, med, p90, n, stormYears, years } from OBSERVED values
 *                                     of all Martian Years (HISTORICAL); storm years count HIGH or SEVERE in ±LS_WINDOW
 *   MW.season.window(prof, width, worst)  the clearest (or dustiest) run of `width` degrees: { from, to, med }
 *   MW.season.dates(lsFrom, lsTo, now)    the next time that window comes round: { my, start, end } (Earth dates,
 *                                     approximate: Ls is turned into a sol with the newest year in the record)
 *
 * This is a record of past years. It is not a forecast: a storm can start in any season.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var K = MW.config.DUST, STEP = 5, SOL_S = 88775.244, YEAR_D = 686.973;

  function lsDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function q(sorted, p) { var x = (sorted.length - 1) * p, k = Math.floor(x); return k + 1 < sorted.length ? sorted[k] + (sorted[k + 1] - sorted[k]) * (x - k) : sorted[k]; }

  function profile(c) {
    var D = MW.dust, P = D.pack, n = P.n, pts = [], recs = [];
    P.years.forEach(function (y) {
      var rec = D.record ? D.record(y.my) : null;
      for (var f = 0; f < y.frames; f++) { var b = y.obs[f * n + c]; if (b !== 255) pts.push({ ls: y.ls[f], tau: P.lut[b], my: y.my, cls: rec ? rec.cls[f * n + c] : -1 }); }
      if (rec) recs.push(y.my);
    });
    var out = [];
    for (var ls = STEP / 2; ls < 360; ls += STEP) {
      var v = [], seen = {}, storm = {};
      pts.forEach(function (p) {
        if (lsDiff(p.ls, ls) > K.LS_WINDOW) return;
        v.push(p.tau); seen[p.my] = 1; if (p.cls >= 3) storm[p.my] = 1;
      });
      v.sort(function (a, b) { return a - b; });
      var yrsRec = Object.keys(seen).filter(function (my) { return recs.indexOf(+my) >= 0; });
      out.push({ ls: ls, n: v.length, years: Object.keys(seen).length, med: v.length ? q(v, 0.5) : null, p90: v.length ? q(v, 0.9) : null,
                 stormYears: Object.keys(storm).length, recYears: yrsRec.length });
    }
    out.complete = recs.length === P.years.length;
    return out;
  }
  function span(prof, width, worst) {
    var k = Math.max(1, Math.round(width / STEP)), best = null, N = prof.length;
    for (var i = 0; i < N; i++) {
      var s = 0, m = 0;
      for (var j = 0; j < k; j++) { var p = prof[(i + j) % N]; if (p.med !== null) { s += p.med; m++; } }
      if (m < k * 0.75) continue;                       // too little data in that stretch to judge it
      var mean = s / m;
      if (!best || (worst ? mean > best.med : mean < best.med)) best = { from: prof[i].ls - STEP / 2, to: (prof[i].ls - STEP / 2 + k * STEP) % 360 || 360, med: mean };
    }
    return best;
  }
  /* Earth dates. Ls 0 of each Martian Year is in DUST.MY_START up to MY36; later years follow at 686.973 days. */
  function yearStart(my) {
    var s = K.MY_START[my]; if (s) return Date.parse(s + 'T00:00:00Z');
    var last = Math.max.apply(null, Object.keys(K.MY_START).map(Number));
    return Date.parse(K.MY_START[last] + 'T00:00:00Z') + (my - last) * YEAR_D * 86400000;
  }
  function solAt(ls) {                                 // sol of the year at which Ls is reached, from the newest year in the record
    var y = MW.dust.pack.years[MW.dust.pack.years.length - 1];
    for (var f = 1; f < y.frames; f++) if (y.ls[f] >= ls) { var a = y.ls[f - 1], b = y.ls[f]; return y.sol[f - 1] + (y.sol[f] - y.sol[f - 1]) * (ls - a) / Math.max(1e-6, b - a); }
    return y.sol[y.frames - 1] + (ls - y.ls[y.frames - 1]) / 0.52;
  }
  function dates(lsFrom, lsTo, now) {
    now = now || Date.now();
    var my = Math.min.apply(null, Object.keys(K.MY_START).map(Number));          // the Martian Year that `now` falls in
    while (yearStart(my + 1) <= now) my++;
    for (var k = 0; k < 3; k++, my++) {
      var start = yearStart(my) + (solAt(lsFrom) - 1) * SOL_S * 1000;
      var endLs = lsTo > lsFrom ? lsTo : lsTo + 360, end = endLs > 360 ? yearStart(my + 1) + (solAt(endLs - 360) - 1) * SOL_S * 1000 : yearStart(my) + (solAt(endLs) - 1) * SOL_S * 1000;
      if (end > now) return { my: my, start: new Date(Math.max(start, now)), end: new Date(end), already: start <= now };
    }
    return null;
  }
  MW.season = { profile: profile, window: span, dates: dates };

  /* ================================================================ the chart and text (page only) */
  if (typeof document === 'undefined' || !document.getElementById('season-chart')) return;
  var G = MW.geo, $ = G.$, cv = $('season-chart'), g = cv.getContext('2d'), lastKey = '';
  function draw() {
    var D = MW.dust, st = MW.dustUI && MW.dustUI.state;
    if (!D || !D.pack || !st || st.focus === undefined || st.focus < 0 || st.my === null) return;
    var c = st.focus, prof = profile(c), y = D.year(st.my), now = y.ls[st.frame];
    var cs = getComputedStyle(document.body), ink = cs.getPropertyValue('--ink').trim(), ink2 = cs.getPropertyValue('--ink-2').trim(), rule = cs.getPropertyValue('--rule').trim();
    var W = cv.width, H = cv.height, pl = 44, pr = 10, pt = 12, pb = 30, top = 0.3;
    prof.forEach(function (p) { if (p.p90 !== null && p.p90 > top) top = p.p90; });
    top = Math.ceil(top * 4) / 4;
    var X = function (ls) { return pl + ls / 360 * (W - pl - pr); }, Y = function (v) { return H - pb - v / top * (H - pt - pb); };
    var best = span(prof, 60, false), worst = span(prof, 60, true);
    g.clearRect(0, 0, W, H);
    if (best) {                                       // the clearest 60°: shaded green
      g.fillStyle = 'rgba(46,139,139,0.22)';
      var a = X(best.from), b = X(best.to > best.from ? best.to : 360);
      g.fillRect(a, pt, b - a, H - pt - pb);
      if (best.to < best.from) g.fillRect(X(0), pt, X(best.to) - X(0), H - pt - pb);
    }
    prof.forEach(function (p) {                       // storm years: red bars from the bottom, full height = every year
      if (!p.recYears || !p.stormYears) return;
      var h = (H - pt - pb) * 0.45 * p.stormYears / p.recYears;
      g.fillStyle = 'rgba(176,30,60,0.55)'; g.fillRect(X(p.ls - 2.5) + 0.5, H - pb - h, X(5) - X(0) - 1, h);
    });
    g.beginPath(); var open = false;                  // HISTORICAL band: median to 90th percentile
    var pts = prof.filter(function (p) { return p.med !== null; });
    pts.forEach(function (p, i) { g[i ? 'lineTo' : 'moveTo'](X(p.ls), Y(p.p90)); });
    for (var i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i].ls), Y(pts[i].med));
    g.closePath(); g.fillStyle = rule; g.globalAlpha = 0.6; g.fill(); g.globalAlpha = 1;
    g.beginPath(); open = false;
    prof.forEach(function (p) { if (p.med === null) { open = false; return; } g[open ? 'lineTo' : 'moveTo'](X(p.ls), Y(p.med)); open = true; });
    g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke();
    g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pl, pt); g.lineTo(pl, H - pb); g.lineTo(W - pr, H - pb); g.stroke();
    g.fillStyle = ink2; g.font = '500 19px "JetBrains Mono", ui-monospace, Consolas, monospace';
    g.textAlign = 'right'; g.fillText(top.toFixed(2), pl - 6, pt + 12); g.fillText('0', pl - 6, H - pb);
    g.textAlign = 'center'; [0, 90, 180, 270, 360].forEach(function (l) { g.fillText('Ls ' + l + '°', Math.min(W - 30, Math.max(pl + 24, X(l))), H - 8); });
    g.strokeStyle = '#0B5FFF'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(now), pt); g.lineTo(X(now), H - pb); g.stroke();

    var b = D.cellBounds(c), txt = [], fmtD = function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
    if (!best) txt.push('Too few observations at this place to judge the seasons.');
    else {
      txt.push('<b>Clearest 60° of the year here: Ls ' + Math.round(best.from) + '°–' + Math.round(best.to) + '°</b> (median optical depth ' + best.med.toFixed(2) + ').' +
        (worst ? ' Dustiest: Ls ' + Math.round(worst.from) + '°–' + Math.round(worst.to) + '° (' + worst.med.toFixed(2) + ').' : ''));
      var dt = dates(best.from, best.to, Date.now());
      if (dt) txt.push((dt.already ? 'That season is under way now, until about ' + fmtD(dt.end) : 'Next time round: about ' + fmtD(dt.start) + ' to ' + fmtD(dt.end)) + ' (MY' + dt.my + '; dates approximate).');
      var here = prof[Math.min(prof.length - 1, Math.floor(((now % 360) + 360) % 360 / 5))];
      if (here && here.recYears) txt.push('At the Timeline\'s season (Ls ' + Math.round(now) + '°) this place was HIGH or SEVERE in ' + here.stormYears + ' of ' + here.recYears + ' observed years.');
    }
    if (!prof.complete) txt.push('Still reading the other Martian Years: the red storm bars fill in as they are analysed.');
    $('season-where').textContent = 'For the cell centred ' + Math.abs(b.lat).toFixed(1) + '° ' + (b.lat < 0 ? 'S' : 'N') + ', ' + Math.abs(((b.lon + 540) % 360) - 180).toFixed(1) + '° ' + (((b.lon + 540) % 360) - 180 < 0 ? 'W' : 'E') + ' (the one the dust monitor describes).';
    $('season-text').innerHTML = txt.map(function (t) { return '<p>' + t + '</p>'; }).join('');
  }
  setInterval(function () {
    var D = MW.dust, st = MW.dustUI && MW.dustUI.state;
    if (!D || !D.pack || !st || $('season-sec').hidden) return;
    var recs = D.pack.years.filter(function (y) { return D.record && D.record(y.my); }).length;
    var key = st.focus + '|' + st.my + '|' + st.frame + '|' + recs + '|' + document.body.getAttribute('data-theme');
    if (key !== lastKey) { lastKey = key; draw(); }
  }, 800);
})();
