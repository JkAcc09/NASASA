/* dust-ui.js — the DUST STORM ACTIVITY layer, its timeline, the dust monitor and the route warnings.
 * All the science is in dust.js; this file only draws what MW.dust returns.
 *
 * Sections:  1. State and helpers        4. Dust monitor (panel, strip readout, map click)
 *            2. Map layer and legend     5. Route exposure
 *            3. Timeline and chart       6. Wiring and start
 *
 * The layer is drawn as one rectangle per data cell, at the cell's true size, so a coarse regional value is
 * never made to look like a local one. Loads after app.js and reaches the map through window.Marswalk.
 */
(function () {
  'use strict';
  var C = MW.config, K = C.DUST, G = MW.geo, $ = G.$, D = MW.dust, app = window.Marswalk, map = app._map, esc = G.escapeHtml;

  /* ================================================================== 1. State and helpers */
  var st = { on: false, view: 'tau', fill: false, opacity: 0.6,
             my: null, frame: 0, cmp: null, lsFrom: 0, lsTo: 360, frames: [], playing: false, fps: 4,
             pin: null,            // a cell chosen by tapping the map; null = follow the walker
             focus: -1 };          // the cell the monitor describes
  var timer = null, ready = false;
  var TREND = { '1': 'increasing', '0': 'stable', '-1': 'decreasing', '-2': 'unknown' };
  var ARROW = { increasing: '▲', decreasing: '▼', stable: '■', unknown: '' };
  var VIEWS = { tau: 'Dust optical depth', dev: 'Deviation from the seasonal baseline', cls: 'Activity class', trend: 'Recent trend' };

  function rgb(a) { return 'rgb(' + a.join(',') + ')'; }
  function tau(v) { return v === null || v !== v ? '–' : v.toFixed(2); }
  function pct(v) { return (v < 0 ? '−' : '+') + G.fmt(Math.abs(Math.round(v))) + ' %'; }
  function ll(lat, lon) { lon = ((lon + 540) % 360) - 180; return Math.abs(lat).toFixed(1) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(1) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function tag(label) { return '<span class="dtag ' + label.toLowerCase().replace(' ', '-') + '">' + label + '</span>'; }
  function badge(cls) { return '<span class="dcls c' + cls + '">' + K.CLASSES[cls] + '</span>'; }
  /* Earth date of a sol of a Martian Year. Approximate (whole sols from the year's start), so only the month is shown. */
  function earthMonth(my, sol) {
    var s = K.MY_START[my]; if (!s) return '';
    return new Date(Date.parse(s + 'T00:00:00Z') + (sol - 1) * 88775.244 * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function when(a) { return 'MY' + a.my + ', Ls ' + a.ls.toFixed(1) + '°, sols ' + a.sols[0] + '–' + a.sols[1] + ' (about ' + earthMonth(a.my, a.sol) + ')'; }
  function walkerCell() { var p = G.toLL(app._state.x, app._state.y); return D.cellAt(p[0], p[1]).c; }
  function cellText(c) { var b = D.cellBounds(c); return 'cell centred ' + ll(b.lat, b.lon) + ', ' + D.pack.grid.dlon + '° × ' + D.pack.grid.dlat + '° (about ' + G.fmt(b.kmEW) + ' × ' + G.fmt(b.kmNS) + ' km)'; }

  /* ================================================================== 2. Map layer and legend */
  map.createPane('dust').style.zIndex = 300;          // above the data layer, below routes, trail and names
  map.getPane('dust').style.pointerEvents = 'none';
  map.createPane('dusthl').style.zIndex = 405;        // highlighted route sections, just under the route line
  map.getPane('dusthl').style.pointerEvents = 'none';
  var rend = L.canvas({ pane: 'dust', padding: 0.3 }), hlRend = L.canvas({ pane: 'dusthl', padding: 0.3 });
  var group = L.layerGroup(), hlGroup = L.layerGroup(), rects = null, rings = null, tris = null, lastFill = null;
  var hiLine, itpLine, incMarks, pinLine;

  function buildCells() {
    var n = D.pack.n, g = D.pack.grid;
    rects = new Array(n); rings = new Array(n); tris = new Array(n); lastFill = new Array(n);
    for (var c = 0; c < n; c++) {
      var b = D.cellBounds(c), parts = b.west < -180 ? [[-180, b.east], [b.west + 360, 180]] : [[b.west, b.east]];   // column 0 straddles the date line
      rings[c] = parts.map(function (p) { return [[b.south, p[0]], [b.north, p[0]], [b.north, p[1]], [b.south, p[1]]]; });
      rects[c] = parts.map(function (p) {
        return L.rectangle([[b.south, p[0]], [b.north, p[1]]], { renderer: rend, stroke: false, fillOpacity: 0, interactive: false }).addTo(group);
      });
      var mid = (parts[0][0] + parts[0][1]) / 2, h = g.dlat * 0.13, w = g.dlon * 0.1 * (parts.length > 1 ? 0.5 : 1);
      tris[c] = [[b.lat + h, mid], [b.lat - h, mid - w], [b.lat - h, mid + w]];
    }
    itpLine = L.polygon([], { renderer: rend, fill: false, color: '#fff', weight: 1, dashArray: '2 4', opacity: 0.9, interactive: false }).addTo(group);
    hiLine = L.polyline([], { renderer: rend, color: '#fff', weight: 2.5, lineCap: 'square', interactive: false }).addTo(group);
    incMarks = L.polygon([], { renderer: rend, color: '#fff', weight: 0.75, fillColor: K.TREND_COLOURS.increasing, fillOpacity: 1, interactive: false }).addTo(group);
    pinLine = L.polygon([], { renderer: rend, fill: false, color: '#0B5FFF', weight: 3, interactive: false }).addTo(group);
  }

  /* The sides of a cell that face a cell which is not HIGH or SEVERE: together they outline the storm region. */
  function regionEdges(isHi, c, out) {
    var g = D.pack.grid, i = c % g.nx, j = (c - i) / g.nx, b = D.cellBounds(c);
    var spans = b.west < -180 ? [[-180, b.east], [b.west + 360, 180]] : [[b.west, b.east]];
    var west = b.west < -180 ? b.west + 360 : b.west;
    if (j === 0 || !isHi[c - g.nx]) spans.forEach(function (s) { out.push([[b.north, s[0]], [b.north, s[1]]]); });
    if (j === g.ny - 1 || !isHi[c + g.nx]) spans.forEach(function (s) { out.push([[b.south, s[0]], [b.south, s[1]]]); });
    if (!isHi[j * g.nx + (i + g.nx - 1) % g.nx]) out.push([[b.south, west], [b.north, west]]);
    if (!isHi[j * g.nx + (i + 1) % g.nx]) out.push([[b.south, b.east], [b.north, b.east]]);
  }
  function fillOf(A, o) {
    var kind = A.kind[o];
    if (!kind || (kind === 2 && !st.fill)) return null;                   // no observation: drawn grey, never as clear air
    if (st.view === 'tau') return rgb(G.rampColour(K.RAMP_TAU, A.tau[o] / K.TAU_MAX));
    if (st.view === 'dev') { var m = A.med[o]; return m === m && m > 0 ? rgb(G.rampColour(K.RAMP_DEV, ((A.tau[o] - m) / m * 100 + 100) / 400)) : null; }
    if (st.view === 'cls') return K.CLASS_COLOURS[A.cls[o]];
    return K.TREND_COLOURS[TREND[A.trend[o]]];
  }
  function drawLayer() {
    if (!st.on || !ready) return;
    if (!rects) buildCells();
    var A = D.analyse(st.my), n = D.pack.n, base = st.frame * n, hi = [], itp = [], inc = [], isHi = new Uint8Array(n);
    for (var c = 0; c < n; c++) {
      var o = base + c, col = fillOf(A, o), key = (col || 'x') + st.opacity;
      if (key !== lastFill[c]) {
        lastFill[c] = key;
        var style = col ? { fillColor: col, fillOpacity: st.opacity } : { fillColor: K.CLASS_COLOURS[0], fillOpacity: st.opacity * 0.45 };
        for (var r = 0; r < rects[c].length; r++) rects[c][r].setStyle(style);
      }
      var shown = A.kind[o] === 1 || (A.kind[o] === 2 && st.fill);
      if (shown && A.cls[o] >= 3) isHi[c] = 1;
      if (shown && A.kind[o] === 2) rings[c].forEach(function (g) { itp.push([g]); });
      if (shown && A.trend[o] === 1 && A.tau[o] >= K.FLOOR.MODERATE) inc.push([tris[c]]);
    }
    for (c = 0; c < n; c++) if (isHi[c]) regionEdges(isHi, c, hi);
    hiLine.setLatLngs(hi); itpLine.setLatLngs(itp); incMarks.setLatLngs(inc);
    pinLine.setLatLngs(st.pin === null ? [] : rings[st.pin].map(function (g) { return [g]; }));
  }
  function drawLegend() {
    var bar = $('dust-key'), list = $('dust-classes'), v = st.view;
    bar.hidden = v === 'cls' || v === 'trend'; list.hidden = !bar.hidden;
    if (v === 'tau') { bar.children[0].textContent = '0'; bar.children[2].textContent = K.TAU_MAX + ' or more'; bar.children[1].style.background = G.rampCss(K.RAMP_TAU); }
    if (v === 'dev') { bar.children[0].textContent = '−100 %'; bar.children[2].textContent = '+300 %'; bar.children[1].style.background = G.rampCss(K.RAMP_DEV); }
    if (v === 'cls') list.innerHTML = [1, 2, 3, 4].map(function (k) { return '<li><i style="background:' + K.CLASS_COLOURS[k] + '"></i>' + K.CLASSES[k] + '</li>'; }).join('');
    if (v === 'trend') list.innerHTML = ['decreasing', 'stable', 'increasing', 'unknown'].map(function (k) { return '<li><i style="background:' + K.TREND_COLOURS[k] + '"></i>' + k + '</li>'; }).join('');
    $('dust-key-note').textContent = (v === 'tau' ? 'Column dust optical depth, infrared absorption at 9.3 µm, normalised to 610 Pa. '
      : v === 'dev' ? 'Optical depth against the median of the same place and season in the other Martian Years. '
      : v === 'cls' ? 'LOW: normal for the place and season. MODERATE: above the normal range. HIGH: well above it, and persistent or regional. SEVERE: far above it, persistent and regional. '
      : 'Change over the last ' + K.TREND_FRAMES * D.pack.stepSols + ' sols. ') +
      'Grey: no observation, which is not the same as no dust. White line: edge of the HIGH or SEVERE region. Red triangle: increasing.' + (st.fill ? ' Dashed outline: INTERPOLATED, not observed.' : '');
  }
  function setOn(on) {
    st.on = on; $('dust-on').checked = on;
    if (on) { group.addTo(map); hlGroup.addTo(map); drawLayer(); drawRouteMarks(); } else { map.removeLayer(group); map.removeLayer(hlGroup); }
  }

  /* ================================================================== 3. Timeline and chart */
  function setRange() {
    st.frames = D.framesInLs(st.my, st.lsFrom, st.lsTo);
    if (!st.frames.length) { st.lsFrom = 0; st.lsTo = 360; $('dust-ls-from').value = 0; $('dust-ls-to').value = 360; st.frames = D.framesInLs(st.my, 0, 360); }
    if (st.lsFrom > st.lsTo) {                                           // a range through Ls 360: play it in time order
      var y = D.year(st.my); st.frames.sort(function (a, b) { return ((y.ls[a] - st.lsFrom + 360) % 360) - ((y.ls[b] - st.lsFrom + 360) % 360); });
    }
    if (st.frames.indexOf(st.frame) < 0) st.frame = st.frames[0];
    $('dust-frame').max = st.frames.length - 1;
  }
  function setFrame(f) { st.frame = f; renderAll(); }
  function step(d) {
    var k = st.frames.indexOf(st.frame), n = st.frames.length;
    setFrame(st.frames[((k < 0 ? 0 : k + d) % n + n) % n]);
  }
  function setPlaying(p) {
    st.playing = p; clearInterval(timer); timer = null;
    MW.ui.setButton($('dust-play'), p ? 'pause' : 'play', p ? 'Pause' : 'Play'); $('dust-play').setAttribute('aria-pressed', p);
    if (p && !st.on) setOn(true);                          // playing the timeline shows what it plays
    if (p) timer = setInterval(function () { step(1); }, 1000 / st.fps);
  }
  /* Changing year keeps the season: the new year opens at the frame nearest the Ls being shown. */
  function setYear(my, ls) {
    var cur = ls !== undefined ? ls : (st.my !== null ? D.year(st.my).ls[st.frame] : null);
    busy('Working out the baseline and anomalies for MY' + my + '…', function () {
      D.analyse(my); if (st.cmp !== null) D.analyse(st.cmp);
      st.my = my; $('dust-my').value = my;
      st.frame = cur === null ? D.year(my).frames - 1 : D.frameAtLs(my, cur);
      setRange(); drawEvents(); renderAll();
    });
  }
  function busy(text, fn) {                               // let the status line paint before a heavy step
    var s = $('dust-status'), s2 = $('dust-time-status'); s.textContent = s2.textContent = text; s.hidden = s2.hidden = false;   // one line in each tab
    setTimeout(function () { try { fn(); s.hidden = s2.hidden = true; } catch (e) { s.textContent = s2.textContent = 'Dust analysis failed: ' + e.message; } }, 30);
  }

  function drawEvents() {
    var A = D.analyse(st.my), box = $('dust-events');
    box.innerHTML = '<p class="note">' + (A.events.length
      ? 'Storm events found in MY' + st.my + ' (HIGH or SEVERE over at least ' + K.EVENT_AREA * 100 + ' % of the observed area between ' + K.POLAR_LAT + '° S and ' + K.POLAR_LAT + '° N). Press one to replay it.'
      : 'No storm event found in MY' + st.my + ': HIGH or SEVERE cells never covered ' + K.EVENT_AREA * 100 + ' % of the observed area.') + '</p>' +
      A.events.map(function (e, i) {
        return '<button type="button" data-ev="' + i + '">Ls ' + Math.round(e.lsFrom) + '°–' + Math.round(e.lsTo) + '° · ' + K.CLASSES[e.worst] + ' · up to ' + Math.round(e.peak * 100) + ' % of the observed area · ' + e.sols + ' sols</button>';
      }).join('') + '<button type="button" data-ev="all">Whole year</button>';
  }
  function replayEvent(i) {
    if (i === 'all') { st.lsFrom = 0; st.lsTo = 360; }
    else { var e = D.analyse(st.my).events[+i]; st.lsFrom = Math.max(0, Math.floor(e.lsFrom / 5) * 5 - 10); st.lsTo = Math.min(360, Math.ceil(e.lsTo / 5) * 5 + 10); }
    $('dust-ls-from').value = st.lsFrom; $('dust-ls-to').value = st.lsTo;
    setRange(); st.frame = st.frames[0];
    if (i !== 'all') { if (!st.on) setOn(true); setPlaying(true); }
    renderAll();
  }

  /* Optical depth of the monitored cell through the year: this year, the comparison year and the baseline. */
  var chart = $('dust-chart'), cg = chart.getContext('2d');
  function drawChart() {
    var W = chart.width, H = chart.height, pl = 44, pr = 10, pt = 12, pb = 30, cs = getComputedStyle(document.body);
    var ink = cs.getPropertyValue('--ink').trim(), ink2 = cs.getPropertyValue('--ink-2').trim(), rule = cs.getPropertyValue('--rule').trim(), me = cs.getPropertyValue('--me').trim();
    var a = D.series(st.my, st.focus), b = st.cmp !== null ? D.series(st.cmp, st.focus) : null, top = 0.5;
    [a, b].forEach(function (s) { if (s) s.forEach(function (p) { if (p.tau !== null && p.tau > top) top = p.tau; if (p.p90 !== null && p.p90 > top) top = p.p90; }); });
    top = Math.ceil(top * 4) / 4;
    var X = function (ls) { return pl + ls / 360 * (W - pl - pr); }, Y = function (v) { return H - pb - v / top * (H - pt - pb); };
    cg.clearRect(0, 0, W, H);
    /* the Ls range being played */
    cg.fillStyle = cs.getPropertyValue('--paper-2').trim();
    if (st.lsFrom <= st.lsTo) cg.fillRect(X(st.lsFrom), pt, X(st.lsTo) - X(st.lsFrom), H - pt - pb);
    else { cg.fillRect(X(st.lsFrom), pt, X(360) - X(st.lsFrom), H - pt - pb); cg.fillRect(X(0), pt, X(st.lsTo) - X(0), H - pt - pb); }
    /* HISTORICAL baseline: median line, and the band up to the 90th percentile */
    cg.beginPath(); var open = false, pts = [];
    a.forEach(function (p) { if (p.med !== null) pts.push(p); });
    if (pts.length) {
      pts.forEach(function (p, i) { cg[i ? 'lineTo' : 'moveTo'](X(p.ls), Y(p.p90)); });
      for (var i = pts.length - 1; i >= 0; i--) cg.lineTo(X(pts[i].ls), Y(pts[i].med));
      cg.closePath(); cg.fillStyle = rule; cg.globalAlpha = 0.55; cg.fill(); cg.globalAlpha = 1;
      cg.beginPath(); pts.forEach(function (p, i) { cg[i ? 'lineTo' : 'moveTo'](X(p.ls), Y(p.med)); });
      cg.strokeStyle = ink2; cg.lineWidth = 1.5; cg.setLineDash([2, 4]); cg.stroke(); cg.setLineDash([]);
    }
    /* a year's line: only OBSERVED points are joined; a gap in the data is a gap in the line */
    function line(s, colour, dash) {
      cg.beginPath(); open = false;
      s.forEach(function (p) { if (p.kind === 1) { cg[open ? 'lineTo' : 'moveTo'](X(p.ls), Y(p.tau)); open = true; } else open = false; });
      cg.strokeStyle = colour; cg.lineWidth = 2.5; cg.setLineDash(dash); cg.stroke(); cg.setLineDash([]);
      s.forEach(function (p) { if (p.kind === 2) { cg.beginPath(); cg.arc(X(p.ls), Y(p.tau), 2.5, 0, 7); cg.strokeStyle = colour; cg.lineWidth = 1; cg.stroke(); } });   // INTERPOLATED: hollow dots
    }
    if (b) line(b, me, [7, 5]);
    line(a, ink, []);
    /* axes */
    cg.strokeStyle = ink; cg.lineWidth = 1.5; cg.beginPath(); cg.moveTo(pl, pt); cg.lineTo(pl, H - pb); cg.lineTo(W - pr, H - pb); cg.stroke();
    cg.fillStyle = ink2; cg.font = '500 19px "Barlow Semi Condensed", Arial, sans-serif';
    cg.textAlign = 'right'; cg.fillText(top.toFixed(2), pl - 6, pt + 12); cg.fillText('0', pl - 6, H - pb);
    cg.textAlign = 'center'; [0, 90, 180, 270, 360].forEach(function (l) { cg.fillText('Ls ' + l + '°', Math.min(W - 30, Math.max(pl + 24, X(l))), H - 8); cg.fillRect(X(l) - 0.5, H - pb, 1, 5); });
    /* the frame on the map */
    var cur = a[st.frame], x = X(cur.ls);
    cg.strokeStyle = '#0B5FFF'; cg.lineWidth = 2; cg.beginPath(); cg.moveTo(x, pt); cg.lineTo(x, H - pb); cg.stroke();
    if (cur.tau !== null) { cg.beginPath(); cg.arc(x, Y(cur.tau), 6, 0, 7); cg.fillStyle = cur.kind === 1 ? '#0B5FFF' : '#fff'; cg.fill(); cg.strokeStyle = cur.kind === 1 ? '#fff' : '#0B5FFF'; cg.lineWidth = 2; cg.stroke(); }
    $('dust-chart-note').innerHTML = 'Optical depth of the monitored cell. Solid line: MY' + st.my + ', OBSERVED' +
      (b ? '; blue dashes: MY' + st.cmp : '') + '. Hollow dots: INTERPOLATED. Grey band: HISTORICAL median (dotted) to 90th percentile of the other years. Gaps are sols without an observation.';
  }

  /* ================================================================== 4. Dust monitor */
  var ROW_INFO = { 'Activity class': 'activityClass', 'Dust optical depth': 'opticalDepth', 'Seasonal baseline': 'baseline', 'Deviation from baseline': 'deviation',
                   'Recent trend': 'trend', 'Regional activity': 'regional', 'Observation': 'ls', 'Confidence': 'confidence' };
  function row(k, v) {
    return '<dt>' + k + (ROW_INFO[k] ? ' <button type="button" class="info" data-info="' + ROW_INFO[k] + '" aria-label="What does this mean?">i</button>' : '') + '</dt><dd>' + v + '</dd>';
  }
  function drawMonitor() {
    var c = st.focus, a = D.assess(st.my, st.frame, c), A = D.analyse(st.my), s = A.summary[st.frame], y = D.year(st.my), P = D.pack;
    var last = P.years[P.years.length - 1];
    $('dust-where').innerHTML = (st.pin === null ? "At the walker's position: " : 'Chosen on the map: ') + cellText(c) + '.';
    $('dust-unpin').hidden = st.pin === null;
    var html = row('Activity class', badge(a.cls) + (a.cls ? ' <span class="dsub">confidence ' + a.confidence + '</span>' : ''));
    html += row('Dust optical depth', a.cls ? '<b>' + tau(a.tau) + '</b>' + (a.relUnc !== null ? ' ± ' + Math.round(a.relUnc * 100) + ' %' : '') + ' ' + tag(a.label)
      : 'no observation ' + tag('NO DATA'));
    html += row('Seasonal baseline', a.baseline ? 'median ' + tau(a.baseline.median) + ', 90th percentile ' + tau(a.baseline.p90) + ' ' + tag('HISTORICAL') +
      '<span class="dsub">' + a.baseline.values + ' observations within ±' + K.LS_WINDOW + '° Ls in ' + a.baseline.years + ' other Martian Years</span>'
      : 'not available <span class="dsub">' + a.baselineValues + ' observations in ' + a.baselineYears + ' other years; needs ' + K.MIN_VALUES + ' in ' + K.MIN_YEARS + '</span>');
    html += row('Deviation from baseline', a.devPct === null ? '–' : '<b>' + pct(a.devPct) + '</b> <span class="dsub">' + (a.z < 0 ? '−' : '') + Math.abs(a.z).toFixed(1) + ' robust spreads from the median</span>');
    html += row('Recent trend', a.trend === 'unknown' ? 'unknown <span class="dsub">too few values in the last ' + K.TREND_FRAMES * P.stepSols + ' sols</span>'
      : ARROW[a.trend] + ' ' + a.trend + ' <span class="dsub">' + (a.change < 0 ? '−' : '+') + tau(Math.abs(a.change)) + ' over ' + K.TREND_FRAMES * P.stepSols + ' sols</span>');
    html += row('Regional activity', (a.neighbours.observed ? a.neighbours.elevated + ' of ' + a.neighbours.observed + ' observed neighbouring cells elevated' + (a.regional ? ': regional' : '') : 'no neighbouring cell observed') +
      '<span class="dsub">Planet: HIGH or SEVERE over ' + (s.high === s.high ? Math.round(s.high * 100) + ' %' : '–') + ' and MODERATE or above over ' + (s.moderate === s.moderate ? Math.round(s.moderate * 100) + ' %' : '–') +
      ' of the observed area between ' + K.POLAR_LAT + '° S and ' + K.POLAR_LAT + '° N; ' + Math.round(s.coverage * 100) + ' % of that area observed in this frame.</span>');
    html += row('Observation', when(a) + '<span class="dsub">Mean of ' + P.stepSols + ' daily maps. This is an archive, not a live feed: the newest observation in it is MY' + last.my + ', Ls ' + last.ls[last.frames - 1].toFixed(0) + '° (about ' + earthMonth(last.my, last.sol[last.frames - 1]) + ').</span>');
    html += row('Instrument and source', esc(y.instruments) + '<span class="dsub">Montabone et al. dust climatology v' + y.version.replace('-', '.') + ', built from NASA orbiter retrievals</span>');
    html += row('Resolution', P.grid.dlon + '° × ' + P.grid.dlat + '° cells, ' + P.stepSols + '-sol means <span class="dsub">source grid ' + y.nativeGrid.observed.replace(' deg', '°').replace(' x ', '° × ') + ', daily. One value stands for the whole cell.</span>');
    html += row('Confidence', a.confidence + (a.confidenceWhy.length ? '<span class="dsub">' + a.confidenceWhy.join('; ') + '</span>' : '<span class="dsub">observed, with a baseline from ' + a.baseline.years + ' years' + (a.reliability !== null ? '; data set reliability ' + a.reliability.toFixed(1) : '') + '</span>'));
    if (st.cmp !== null) {
      var fb = D.frameAtLs(st.cmp, a.ls), b = D.assess(st.cmp, fb, c);
      html += row('Same season, MY' + st.cmp, (b.cls ? tau(b.tau) + ' ' + tag(b.label) + ' ' : '') + badge(b.cls) + '<span class="dsub">Ls ' + b.ls.toFixed(1) + '°' + (b.devPct !== null ? ', ' + pct(b.devPct) + ' against its own baseline' : '') + '</span>');
    }
    var risk = D.seasonalRisk(c, a.ls), hot = risk.years.filter(function (r) { return r.worst >= 3; }).map(function (r) { return 'MY' + r.my; });
    html += row('This season in the record', risk.pending ? 'reading the other Martian Years… <span class="dsub">' + risk.pending + ' still to analyse</span>'
      : risk.yearsWithData ? 'HIGH or SEVERE here in ' + risk.yearsHigh + ' of ' + risk.yearsWithData + ' observed years ' + tag('HISTORICAL') +
      '<span class="dsub">' + (hot.length ? hot.join(', ') + '. ' : '') + 'A count of past years within ±' + K.LS_WINDOW + '° Ls, not a forecast.</span>' : 'no observed year');
    $('dust-panel').innerHTML = html;
    $('dust-why').innerHTML = a.reasons.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');

    /* the astronaut's strip: one glanceable readout, always for the walker's own position */
    if (st.pin !== null) a = D.assess(st.my, st.frame, walkerCell());
    var dd = $('e-dust');
    dd.textContent = a.cls ? K.CLASSES[a.cls] + (a.trend === 'increasing' || a.trend === 'decreasing' ? ' ' + ARROW[a.trend] : '') : 'NO DATA';
    dd.className = a.cls >= 3 ? 'alert' : '';
    $('e-dust-l').textContent = 'dust activity' + (a.cls ? ', optical depth ' + tau(a.tau) + (a.label === 'INTERPOLATED' ? ' interpolated' : '') : ': not observed, not known to be clear') + ' · MY' + a.my + ' Ls ' + Math.round(a.ls) + '°';
  }
  function drawWhen() {
    var a = D.assess(st.my, st.frame, st.focus), k = st.frames.indexOf(st.frame);
    $('dust-frame').value = Math.max(0, k);
    $('dust-when').innerHTML = '<b>MY' + st.my + ' · Ls ' + a.ls.toFixed(1) + '°</b> · sols ' + a.sols[0] + '–' + a.sols[1] + ' · about ' + earthMonth(st.my, a.sol) + ' · frame ' + (k + 1) + ' of ' + st.frames.length;
  }

  /* Tap on the map while the dust layer is on and the map is zoomed out: inspect that cell. Called by app.js. */
  function inspect(latlng) {
    if (!st.on || !ready || map.getZoom() >= 12) return false;
    var c = D.cellAt(latlng.lat, latlng.lng).c, a = D.assess(st.my, st.frame, c);
    st.pin = c; st.focus = c; renderAll();
    var html = '<div class="pop dpop"><h3>Dust: ' + badge(a.cls) + '</h3><ul>' +
      '<li>Optical depth ' + (a.cls ? tau(a.tau) + (a.relUnc !== null ? ' ± ' + Math.round(a.relUnc * 100) + ' %' : '') + ' ' + tag(a.label) : 'not observed ' + tag('NO DATA')) + '</li>' +
      '<li>Seasonal baseline ' + (a.baseline ? tau(a.baseline.median) + ' ' + tag('HISTORICAL') : 'not available') + '</li>' +
      (a.devPct !== null ? '<li>Deviation ' + pct(a.devPct) + '</li>' : '') +
      '<li>Trend ' + a.trend + '</li></ul>' +
      '<p>' + when(a) + '. ' + esc(D.year(st.my).instruments) + '.</p>' +
      '<p>One value for the whole ' + cellText(c) + '. It is not a local measurement.</p>' +
      (a.cls ? '' : '<p>Missing data is not evidence of clear air.</p>') + '</div>';
    L.popup({ maxWidth: 290, className: 'dust-pop' }).setLatLng(latlng).setContent(html).openOn(map);
    return true;
  }

  /* ================================================================== 5. Route exposure */
  var routeKey = '', exposure = null;
  function activeRoute() {
    var r = app._route();
    return { id: r.id, name: r.name, points: r.pts.map(function (p) { return G.toLL(p.x, p.y); }) };
  }
  function allRoutes() {
    var out = [{ id: 'curiosity', name: "Curiosity's drive", points: app._waypoints.map(function (w) { return [w.lat, w.lon]; }) }];
    app.savedTrails().forEach(function (r) { if (r.points.length > 1) out.push({ id: r.id, name: r.name, points: r.points.map(function (p) { return [p[0], p[1]]; }) }); });
    return out;
  }
  /* The season with the lowest historical median at a cell: the only "alternative timing" this data supports. */
  var clearCache = new Map();
  function clearestSeason(c) {
    if (clearCache.has(c)) return clearCache.get(c);
    var best = null, worst = null;
    for (var ls = 15; ls < 360; ls += 30) {
      var B = D.baselineForBin(-1, Math.floor(ls / K.LS_BIN)), m = B.med[c]; if (m !== m) continue;
      if (!best || m < best.med) best = { ls: ls, med: m };
      if (!worst || m > worst.med) worst = { ls: ls, med: m };
    }
    var out = best ? { best: best, worst: worst } : null;
    clearCache.set(c, out); return out;
  }
  function drawRouteMarks() {
    hlGroup.clearLayers();
    if (!exposure || !st.on) return;
    exposure.sections.forEach(function (s) {
      if (s.a.cls === 1 || s.line.length < 2) return;                    // LOW is left unmarked
      L.polyline(s.line, { renderer: hlRend, color: K.CLASS_COLOURS[s.a.cls], weight: 13, opacity: 0.9, dashArray: s.a.cls ? null : '4 10', lineCap: 'round', interactive: false }).addTo(hlGroup);
    });
  }
  function drawRoute() {
    var r = activeRoute(), ex = exposure = D.routeExposure(r.points, st.my, st.frame), box = $('dust-route'), n = ex.sections.length;
    var html = '<p><b>' + esc(r.name) + '</b>, ' + (ex.km < 20 ? G.fmt(ex.km, 1) : G.fmt(ex.km)) + ' km: ' + badge(ex.worst) + ' on ' + when(D.assess(st.my, st.frame, ex.sections[0].cell)) + '.</p>';
    html += '<p class="note">' + (ex.cells === 1 ? 'The whole route lies inside one data cell, so the data cannot tell one part of the route from another.'
      : 'The route crosses ' + ex.cells + ' data cells; each section below is the part inside one cell.') + '</p><ol class="dsecs">';
    ex.sections.slice(0, 8).forEach(function (s) {
      var a = s.a;
      html += '<li class="c' + a.cls + '"><b>km ' + G.fmt(s.fromKm, s.toKm < 20 ? 1 : 0) + '–' + G.fmt(s.toKm, s.toKm < 20 ? 1 : 0) + '</b> ' + badge(a.cls) + (a.trend === 'increasing' ? ' ▲ increasing' : '') + '<br>' +
        (a.cls ? 'Optical depth ' + tau(a.tau) + ' ' + tag(a.label) + (a.baseline ? ', baseline ' + tau(a.baseline.median) + ' ' + tag('HISTORICAL') + ', ' + pct(a.devPct) : ', no baseline')
               : 'Not observed ' + tag('NO DATA') + '. Treat as unknown, not as clear.') +
        '<span class="dsub">' + cellText(s.cell) + '</span>' +
        (a.cls >= 2 ? '<span class="dsub">Why: ' + esc(a.reasons.slice(0, 3).join(' ')) + '</span>' : '') + '</li>';
    });
    html += '</ol>' + (n > 8 ? '<p class="note">' + (n - 8) + ' more sections not listed.</p>' : '');
    if (ex.worst >= 2) html += '<p><b>What this may mean for the walk</b></p><ul class="dimp">' + D.implications(ex.worst).map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
    else if (ex.kmNoData > 0) html += '<p class="note">Part of the route has no observation for these sols. That is a gap in the data, not a clear sky.</p>';
    else html += '<p class="note">Dust along the route is inside the normal range for the season on these sols.</p>';

    /* alternatives: dust is one value per cell hundreds of km wide, so a different path inside the cell reads the same.
       What can differ is another stored route in another cell, or another season. Paths are compared in nav-ui.js. */
    var others = allRoutes().filter(function (o) { return o.id !== r.id; }).map(function (o) { return { name: o.name, ex: D.routeExposure(o.points, st.my, st.frame) }; });
    var better = others.filter(function (o) { return o.ex.score < ex.score - 1e-9; }).sort(function (p, q) { return p.ex.score - q.ex.score; });
    if (ex.worst >= 2 || ex.kmNoData > 0) {
      html += '<p><b>Alternatives</b></p>';
      html += better.length ? '<p class="note">Lower dust exposure on these sols: ' + better.slice(0, 3).map(function (o) { return esc(o.name) + ' (' + K.CLASSES[o.ex.worst] + ')'; }).join(', ') + '.</p>'
        : '<p class="note">' + (others.length ? 'None of the ' + others.length + ' other stored routes has lower dust exposure on these sols' + (ex.cells === 1 ? ': at this resolution they share the same cell' : '') + '.'
          : 'There is no other stored route to compare.') + ' A detour would have to leave this ' + D.pack.grid.dlon + '° × ' + D.pack.grid.dlat + '° cell to change the dust reading; Markers and routes compares the ways to a destination on everything else.</p>';
      var cs = clearestSeason(ex.sections[0].cell);
      if (cs) html += '<p class="note">Timing: in the record, this place is clearest around Ls ' + (cs.best.ls - 15) + '°–' + (cs.best.ls + 15) + '° (median optical depth ' + tau(cs.best.med) + ') and dustiest around Ls ' + (cs.worst.ls - 15) + '°–' + (cs.worst.ls + 15) + '° (' + tau(cs.worst.med) + ') ' + tag('HISTORICAL') + '. A record of past years, not a forecast.</p>';
    }
    box.innerHTML = html;
    /* a short warning on the map itself, only when it matters */
    var warn = $('dust-warn');
    if (ex.worst >= 3) {
      warn.innerHTML = '<b>Dust ' + K.CLASSES[ex.worst] + '</b> on this route (MY' + st.my + ', Ls ' + Math.round(D.year(st.my).ls[st.frame]) + '°). Visibility and solar power may be reduced. <button type="button" id="dust-warn-more">Details</button>';
      warn.className = 'c' + ex.worst; warn.hidden = false;
    } else warn.hidden = true;
    drawRouteMarks();
  }

  /* ================================================================== 6. Wiring and start */
  function renderAll() {
    if (!ready) return;
    st.focus = st.pin !== null ? st.pin : walkerCell();
    drawLayer(); drawWhen(); drawMonitor(); drawChart(); drawRoute();
  }
  function fail(msg) {
    $('dust-status').textContent = $('dust-time-status').textContent = msg; $('dust-status').hidden = $('dust-time-status').hidden = false; $('dust-on').disabled = true;
    $('e-dust').textContent = '–'; $('e-dust-l').textContent = 'dust activity: data not loaded';
  }
  function start() {
    var P = D.pack, sel = $('dust-my'), cmp = $('dust-cmp'), view = $('dust-view');
    Object.keys(VIEWS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = VIEWS[k]; view.appendChild(o); });
    cmp.innerHTML = '<option value="">No comparison</option>';
    P.years.forEach(function (y) {
      [sel, cmp].forEach(function (s) { var o = document.createElement('option'); o.value = y.my; o.textContent = 'MY' + y.my + ' (' + earthMonth(y.my, 1).slice(-4) + '–' + earthMonth(y.my, 668).slice(-2) + ')'; s.appendChild(o); });
    });
    $('dust-res').textContent = P.grid.dlon + '° × ' + P.grid.dlat + '°';
    $('dust-credit').innerHTML = 'Dust optical depth: L. Montabone et al., <a href="' + P.source.url + '" target="_blank" rel="noopener">Climatologies of the Martian Atmospheric Dust Optical Depth</a>, v2 ' +
      '(<a href="https://doi.org/10.1016/j.icarus.2014.12.034" target="_blank" rel="noopener">Icarus 2015</a>, <a href="https://doi.org/10.1029/2019JE006111" target="_blank" rel="noopener">JGR Planets 2020</a>), CC BY-SA 3.0, here averaged to ' + P.grid.dlon + '° × ' + P.grid.dlat + '° and ' + P.stepSols + ' sols. ' +
      'It is built from NASA retrievals: MGS TES, Mars Odyssey THEMIS and MRO <a href="https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/aerosols.html" target="_blank" rel="noopener">Mars Climate Sounder</a> (NASA PDS Atmospheres Node). ' +
      'MY' + P.years[0].my + ' to MY' + P.years[P.years.length - 1].my + '. Detection and classes are this project\'s own analysis of those observations; they are not a forecast and not a NASA product.';
    ready = true;
    drawLegend();
    $('dust-body').hidden = $('dust-time-body').hidden = false;
    setYear(P.years[P.years.length - 1].my);
    /* read the rest of the record in the background, one Martian Year at a time, so "this season in the record" fills in */
    (function more() { setTimeout(function () { if (D.analyseNext()) more(); else if (!st.playing) renderAll(); }, 400); })();

    $('dust-on').addEventListener('change', function () { setOn(this.checked); });
    view.addEventListener('change', function () { st.view = this.value; drawLegend(); drawLayer(); });
    $('dust-opacity').addEventListener('input', function () { st.opacity = this.value / 100; drawLayer(); });
    $('dust-fill').addEventListener('change', function () { st.fill = this.checked; drawLegend(); drawLayer(); });
    sel.addEventListener('change', function () { setYear(+this.value); });
    cmp.addEventListener('change', function () {
      var v = this.value === '' ? null : +this.value;
      $('dust-swap').disabled = v === null;
      busy('Working out the baseline and anomalies for the comparison year…', function () { st.cmp = v; renderAll(); });
    });
    $('dust-swap').addEventListener('click', function () {              // put the comparison year on the map, keep the season
      if (st.cmp === null) return;
      var was = st.my, next = st.cmp, ls = D.year(st.my).ls[st.frame];
      st.cmp = was; cmp.value = was; setYear(next, ls);
    });
    ['dust-ls-from', 'dust-ls-to'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var v = Math.max(0, Math.min(360, +this.value || 0)); this.value = v;
        if (id === 'dust-ls-from') st.lsFrom = v; else st.lsTo = v;
        setRange(); renderAll();
      });
    });
    $('dust-frame').addEventListener('input', function () { setPlaying(false); setFrame(st.frames[+this.value]); });
    $('dust-prev').addEventListener('click', function () { setPlaying(false); step(-1); });
    $('dust-next').addEventListener('click', function () { setPlaying(false); step(1); });
    $('dust-play').addEventListener('click', function () { setPlaying(!st.playing); });
    $('dust-fps').addEventListener('change', function () { st.fps = +this.value; if (st.playing) setPlaying(true); });
    $('dust-events').addEventListener('click', function (e) { var b = e.target.closest('button[data-ev]'); if (b) replayEvent(b.getAttribute('data-ev')); });
    $('dust-unpin').addEventListener('click', function () { st.pin = null; map.closePopup(); renderAll(); });
    $('dust-warn').addEventListener('click', function (e) {
      if (e.target.id !== 'dust-warn-more') return;
      app.openTab('dust'); $('dust-route').scrollIntoView({ block: 'start' });
    });
    map.on('popupclose', function (e) { if (e.popup.options.className === 'dust-pop' && st.pin !== null) { pinLine.setLatLngs([]); } });
    MW.settings.onChange(function () { if (ready) drawChart(); });
    /* the walker moves, routes get loaded and trails get saved without telling this file: look once a second */
    setInterval(function () {
      if (!ready || st.my === null) return;
      var r = app._route(), key = r.id + '|' + app.savedTrails().length + '|' + (st.pin === null ? walkerCell() : st.pin);
      if (key !== routeKey) { routeKey = key; if (!st.playing) renderAll(); }
    }, 1000);
  }

  /* Describe one place in the dust monitor (places-ui.js uses this after going somewhere). */
  function pinAt(lat, lon) {
    if (!ready) return false;
    st.pin = D.cellAt(lat, lon).c; renderAll(); return true;
  }
  MW.dustUI = { inspect: inspect, state: st, pinAt: pinAt,
    show: function (on) { setOn(on !== false); },
    goTo: function (my, ls) { setYear(my, ls); } };

  D.load().then(start, function (e) { fail(e.message); });
})();
