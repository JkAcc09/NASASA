/* dust.js — MW.dust: dust optical depth observations, the seasonal baseline and the anomaly detection.
 * Pure logic: no map, no page. It also runs under Node (see dust_test.js).
 *
 * This is an observation-based detection and historical risk assessment. It does not forecast.
 * Optical depth is a property of the whole air column seen from orbit, averaged over a cell hundreds of
 * kilometres across and several sols; it is not a measurement of visibility or of conditions on the ground.
 *
 * Where every number comes from (the four labels used on the page):
 *   OBSERVED      a grid cell of the observation-only maps (dust-data.js, plane "observed")
 *   INTERPOLATED  the kriged, complete-coverage maps, used only where no observation exists and only when
 *                 the cell was observed within ITP_FRAMES frames or a neighbouring cell is observed now
 *   HISTORICAL    the seasonal baseline: statistics of OBSERVED values from the other Martian Years
 *   MODELLED      nothing in this file is a model output
 * A cell with neither an observation nor an interpolated value is NO DATA. It is never treated as clear.
 *
 * The detection, for one cell in one frame (thresholds: MW.config.DUST):
 *   1. Baseline. Every OBSERVED value of that cell within LS_WINDOW degrees of Ls of this season, from all
 *      Martian Years except the one being judged, gives a median, a 90th percentile and a robust spread
 *      (1.4826 x the median absolute deviation, with a floor). Leaving the judged year out stops a storm
 *      from raising its own baseline; the median and MAD stop the global-storm years from distorting it.
 *   2. Anomaly. z = (optical depth - median) / spread. Deviation = (optical depth - median) / median.
 *   3. Persistence. The number of consecutive frames, ending here, whose OBSERVED value was elevated
 *      (z and optical depth both past the MODERATE thresholds).
 *   4. Region. How many of the 8 neighbouring cells are elevated in this frame (OBSERVED values only).
 *   5. Trend. A straight-line fit through the last TREND_FRAMES frames: increasing, decreasing or stable.
 *   6. Class.
 *        LOW       not elevated: inside the normal range for this place and season
 *        MODERATE  z >= 2 and optical depth >= 0.15: above the normal range. An elevated value that is neither
 *                  persistent nor regional stays here however high it is (an isolated anomaly).
 *        HIGH      z >= 4 and optical depth >= 0.30, and persistent or regional
 *        SEVERE    z >= 6 and optical depth >= 0.80, and persistent and regional
 *      Without a usable baseline only the optical-depth floors are applied, the class cannot exceed HIGH,
 *      and the result is marked low confidence.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var K = MW.config.DUST, R = MW.config.R_MARS, DEG = Math.PI / 180;
  var MISSING = 255, NAN = NaN;
  var P = null;                    // the unpacked data pack
  var analyses = new Map();        // Martian Year -> its full analysis (kept for the last few years used)
  var records = new Map();         // Martian Year -> { cls, summary, events }: the small part kept for every year analysed

  /* ------------------------------------------------------------------ loading */
  function unpack(pack) {
    var bin = typeof atob === 'function' ? atob(pack.data) : Buffer.from(pack.data, 'base64').toString('binary');
    var gz = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('This browser cannot unpack the dust data (no DecompressionStream). Use a current Chrome, Edge, Firefox or Safari.'));
    var stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), g = pack.grid, n = g.nx * g.ny, scale = pack.encoding.scale;
      var years = pack.years.map(function (y) {
        var len = y.frames * n;
        if (y.offset + 4 * len > bytes.length) throw new Error('The dust data pack is damaged (MY' + y.my + ').');
        return { my: y.my, frames: y.frames, ls: y.ls, sol: y.sol, instruments: y.instruments, version: y.version, files: y.files,
          nativeGrid: y.nativeGrid, coverage: y.observedCoverage,
          obs: bytes.subarray(y.offset, y.offset + len), unc: bytes.subarray(y.offset + len, y.offset + 2 * len),
          rel: bytes.subarray(y.offset + 2 * len, y.offset + 3 * len), itp: bytes.subarray(y.offset + 3 * len, y.offset + 4 * len) };
      });
      var lut = new Float32Array(256);
      for (var b = 0; b < 255; b++) lut[b] = (b / scale) * (b / scale);
      lut[255] = NAN;
      P = { grid: g, n: n, years: years, lut: lut, source: pack.source, quantity: pack.quantity, built: pack.built,
            stepSols: pack.time.stepSols, notIncluded: pack.notIncluded || [] };
      analyses.clear(); records.clear();
      return loadBaselines(pack).then(function () { return api; });
    });
  }

  /* ------------------------------------------------------------------ precomputed baselines (dust-baselines.js) */
  /* Working the baselines out here froze the page for about a second per Martian Year. build_dust_baselines.js
     precomputes them into dust-baselines.js; this reads that file. Without it, or if it was built from other data
     or other settings, baselineForBin works them out as before: same results, just slower. */
  var pre = null;                  // { T: decoded planes, yi: Martian Year -> index, has: stored bins per year }
  function baselineFingerprint(pack) {     // data pack + the settings that shape a baseline (FNV-1a)
    var s = JSON.stringify([pack.built, pack.encoding.scale, K.LS_BIN, K.LS_WINDOW, K.MIN_YEARS, K.MIN_VALUES, K.SIGMA_REL, K.SIGMA_ABS]) + pack.data, h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function gunzipBase64(b64) {
    var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var gz = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function loadBaselines(pack) {
    pre = null;
    var F = root.MARSWALK_DUST_BASELINES, bins = Math.round(360 / K.LS_BIN), yrs = P.years.map(function (y) { return y.my; });
    if (!F) return Promise.resolve();
    if (F.format !== 'marswalk-dust-baselines' || F.version !== 1 || F.n !== P.n || F.bins !== bins || F.years.join() !== yrs.join() ||
        F.fingerprint !== baselineFingerprint(pack)) {
      console.warn('dust-baselines.js does not match this dust data or these settings, so the page works the baselines out itself (slower). Rebuild it with: node build_dust_baselines.js');
      return Promise.resolve();
    }
    return gunzipBase64(F.data).then(function (bytes) {
      var Y = yrs.length, E = bins * P.n * Y, pl = [], i, j;
      if (bytes.length !== 9 * E) throw new Error('wrong size');
      for (i = 0; i < 9; i++) {                            // each plane is stored as differences from the entry before
        var a = bytes.subarray(i * E, (i + 1) * E), prev = 0;
        for (j = 0; j < E; j++) { prev = (prev + a[j]) & 255; a[j] = prev; }
        pl.push(a);
      }
      var plus = function (a, b) { for (var k = 0; k < E; k++) b[k] = (b[k] + a[k]) & 255; return b; };   // second of a pair: stored relative to the first
      var cnt = new Uint16Array(E);
      for (j = 0; j < E; j++) cnt[j] = pl[7][j] | (pl[8][j] << 8);
      var yi = new Map(); yrs.forEach(function (my, k) { yi.set(my, k); });
      pre = { yi: yi, has: F.has, T: { Y: Y, n: P.n, mA: pl[0], mB: plus(pl[0], pl[1]), pA: pl[2], pB: plus(pl[2], pl[3]),
                                       dA: pl[4], dB: plus(pl[4], pl[5]), yrs: pl[6], cnt: cnt } };
    }).catch(function (e) { pre = null; console.warn('dust-baselines.js could not be read (' + e.message + '), so the page works the baselines out itself (slower).'); });
  }
  /* One Ls bin's baseline from the stored readings: the same arithmetic as baselineForBin, so the same Float32 values. */
  function pairAt(a, b, m, x, k) { return k + 1 < m ? a + (b - a) * (x - k) : a; }
  function decodeBaselineBin(T, yi, bin) {
    var n = T.n, lut = P.lut;
    var out = { med: new Float32Array(n), p90: new Float32Array(n), sig: new Float32Array(n), cnt: new Uint16Array(n), yrs: new Uint8Array(n) };
    for (var c = 0; c < n; c++) {
      var e = (bin * n + c) * T.Y + yi, m = T.cnt[e], yrs = T.yrs[e];
      out.cnt[c] = m; out.yrs[c] = yrs;
      if (yrs < K.MIN_YEARS || m < K.MIN_VALUES) { out.med[c] = out.p90[c] = out.sig[c] = NAN; continue; }
      var xm = (m - 1) * 0.5, km = Math.floor(xm), xp = (m - 1) * 0.9, kp = Math.floor(xp);
      var med = pairAt(lut[T.mA[e]], lut[T.mB[e]], m, xm, km);
      var da = Math.fround(Math.abs(lut[T.dA[e]] - med)), db = Math.fround(Math.abs(lut[T.dB[e]] - med));
      out.med[c] = med; out.p90[c] = pairAt(lut[T.pA[e]], lut[T.pB[e]], m, xp, kp);
      out.sig[c] = Math.max(1.4826 * pairAt(da, db, m, xm, km), K.SIGMA_REL * med, K.SIGMA_ABS);
    }
    return out;
  }
  var ready = null;
  function load() {
    var missing = function () { return Promise.reject(new Error('The dust data pack (dust-data.js) is missing. Build it with: python dust_ingest.py')); };
    if (!ready) ready = root.MARSWALK_DUST ? unpack(root.MARSWALK_DUST)
      : MW.lazy && MW.lazy.has('dust') ? MW.lazy.need('dust').then(function () { return root.MARSWALK_DUST ? unpack(root.MARSWALK_DUST) : missing(); })   // index.html defers the packs (lazy.js)
      : missing();
    return ready;
  }

  /* ------------------------------------------------------------------ grid and time */
  function year(my) { for (var i = 0; i < P.years.length; i++) if (P.years[i].my === my) return P.years[i]; return null; }
  function cellAt(lat, lon) {
    var g = P.grid;
    var i = Math.floor(((((lon - g.lon0) % 360) + 360) % 360) / g.dlon) % g.nx;
    var j = Math.min(g.ny - 1, Math.max(0, Math.floor((g.lat0 - lat) / g.dlat)));
    return { i: i, j: j, c: j * g.nx + i };
  }
  /* The ground a cell covers. west/east may run past 180 W for column 0, which straddles the date line. */
  function cellBounds(c) {
    var g = P.grid, i = c % g.nx, j = (c - i) / g.nx;
    var b = { west: g.lon0 + i * g.dlon, east: g.lon0 + (i + 1) * g.dlon, north: g.lat0 - j * g.dlat, south: g.lat0 - (j + 1) * g.dlat };
    b.lat = (b.north + b.south) / 2; b.lon = (b.west + b.east) / 2;
    b.kmEW = g.dlon * DEG * R * Math.cos(b.lat * DEG) / 1000; b.kmNS = g.dlat * DEG * R / 1000;
    return b;
  }
  function lsDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function frameAtLs(my, ls) {
    var y = year(my), best = 0, bd = 1e9;
    for (var f = 0; f < y.frames; f++) { var d = lsDiff(y.ls[f], ls); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  /* Frames of a year whose Ls lies in [from, to]; a range with from > to runs through Ls 360. */
  function framesInLs(my, from, to) {
    var y = year(my), out = [];
    for (var f = 0; f < y.frames; f++) { var l = y.ls[f]; if (from <= to ? (l >= from && l <= to) : (l >= from || l <= to)) out.push(f); }
    return out;
  }

  /* ------------------------------------------------------------------ baseline (HISTORICAL) */
  function quantile(sorted, n, q) {
    var x = (n - 1) * q, k = Math.floor(x), f = x - k;
    return k + 1 < n ? sorted[k] + (sorted[k + 1] - sorted[k]) * f : sorted[k];
  }
  /* For every cell: statistics of the OBSERVED values near one season, from every year except `excludeMy`. */
  function baselineForBin(excludeMy, bin, compute) {     // compute: ignore dust-baselines.js (the build script's reference)
    if (pre && !compute) {
      var yi = pre.yi.get(excludeMy);
      if (yi !== undefined && pre.has[yi].charAt(bin) === '1') return decodeBaselineBin(pre.T, yi, bin);
    }
    var n = P.n, centre = (bin + 0.5) * K.LS_BIN, lut = P.lut;
    var out = { med: new Float32Array(n), p90: new Float32Array(n), sig: new Float32Array(n), cnt: new Uint16Array(n), yrs: new Uint8Array(n) };
    var picks = [];
    P.years.forEach(function (y) {
      if (y.my === excludeMy) return;
      var fs = [];
      for (var f = 0; f < y.frames; f++) if (lsDiff(y.ls[f], centre) <= K.LS_WINDOW) fs.push(f);
      if (fs.length) picks.push({ y: y, fs: fs });
    });
    var buf = new Float32Array(picks.reduce(function (s, p) { return s + p.fs.length; }, 0) || 1), dev = new Float32Array(buf.length);
    for (var c = 0; c < n; c++) {
      var m = 0, yrs = 0;
      for (var k = 0; k < picks.length; k++) {
        var obs = picks[k].y.obs, fs = picks[k].fs, had = false;
        for (var q = 0; q < fs.length; q++) { var b = obs[fs[q] * n + c]; if (b !== MISSING) { buf[m++] = lut[b]; had = true; } }
        if (had) yrs++;
      }
      out.cnt[c] = m; out.yrs[c] = yrs;
      if (yrs < K.MIN_YEARS || m < K.MIN_VALUES) { out.med[c] = out.p90[c] = out.sig[c] = NAN; continue; }
      var s = buf.subarray(0, m); s.sort();
      var med = quantile(s, m, 0.5);
      for (var d = 0; d < m; d++) dev[d] = Math.abs(s[d] - med);
      var ds = dev.subarray(0, m); ds.sort();
      out.med[c] = med; out.p90[c] = quantile(s, m, 0.9);
      out.sig[c] = Math.max(1.4826 * quantile(ds, m, 0.5), K.SIGMA_REL * med, K.SIGMA_ABS);
    }
    return out;
  }

  /* ------------------------------------------------------------------ analysis of one Martian Year */
  var NB = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  /* Is an interpolated value backed by a real observation close by in time or space? */
  function supported(y, f, c) {
    var n = P.n, g = P.grid, i = c % g.nx, j = (c - i) / g.nx;
    for (var d = -K.ITP_FRAMES; d <= K.ITP_FRAMES; d++) { var ff = f + d; if (ff >= 0 && ff < y.frames && y.obs[ff * n + c] !== MISSING) return true; }
    for (var q = 0; q < 8; q++) {
      var jj = j + NB[q][0]; if (jj < 0 || jj >= g.ny) continue;
      if (y.obs[f * n + jj * g.nx + (i + NB[q][1] + g.nx) % g.nx] !== MISSING) return true;
    }
    return false;
  }
  function analyse(my) {
    if (analyses.has(my)) return analyses.get(my);
    var y = year(my); if (!y) return null;
    var n = P.n, g = P.grid, F = y.frames, lut = P.lut, N = F * n;
    var A = { my: my, frames: F,
      tau: new Float32Array(N),        // best available optical depth: OBSERVED, else INTERPOLATED, else NaN
      kind: new Uint8Array(N),         // 0 no data, 1 OBSERVED, 2 INTERPOLATED
      med: new Float32Array(N), p90: new Float32Array(N), sig: new Float32Array(N), bcnt: new Uint16Array(N), byrs: new Uint8Array(N),
      z: new Float32Array(N), elev: new Uint8Array(N), run: new Uint8Array(N), nbElev: new Uint8Array(N), nbData: new Uint8Array(N),
      trend: new Int8Array(N),         // 1 increasing, 0 stable, -1 decreasing, -2 unknown
      change: new Float32Array(N), cls: new Uint8Array(N), summary: [] };
    var f, c, o, bins = new Map();
    for (f = 0; f < F; f++) {
      var bin = Math.floor((((y.ls[f] % 360) + 360) % 360) / K.LS_BIN);
      if (!bins.has(bin)) bins.set(bin, baselineForBin(my, bin));
      var B = bins.get(bin);
      for (c = 0; c < n; c++) {
        o = f * n + c;
        var b = y.obs[o], t;
        if (b !== MISSING) { t = lut[b]; A.kind[o] = 1; } else if (y.itp[o] !== MISSING && supported(y, f, c)) { t = lut[y.itp[o]]; A.kind[o] = 2; } else t = NAN;
        A.tau[o] = t; A.med[o] = B.med[c]; A.p90[o] = B.p90[c]; A.sig[o] = B.sig[c]; A.bcnt[o] = B.cnt[c]; A.byrs[o] = B.yrs[c];
        var z = A.kind[o] && B.med[c] === B.med[c] ? (t - B.med[c]) / B.sig[c] : NAN;
        A.z[o] = z;
        /* "Elevated" is the evidence that persistence and region are counted from, so it is OBSERVED only. */
        A.elev[o] = A.kind[o] === 1 && t >= K.FLOOR.MODERATE && (z !== z || z >= K.Z.MODERATE) ? 1 : 0;
      }
    }
    for (f = 0; f < F; f++) {
      var areaAll = 0, areaData = 0, aHigh = 0, aMod = 0, worst = 0;
      for (c = 0; c < n; c++) {
        o = f * n + c;
        /* persistence: consecutive elevated OBSERVED frames ending here; frames with no observation are stepped over */
        var run = 0, skipped = 0;
        for (var ff = f; ff >= 0 && run < 250; ff--) {
          var oo = ff * n + c;
          if (A.elev[oo]) { run++; skipped = 0; }
          else if (A.kind[oo] !== 1 && ff !== f && skipped < K.PERSIST_SKIP) skipped++;
          else if (ff === f && A.kind[oo] !== 1) continue;      // this frame itself has no observation: look at the ones before it
          else break;
        }
        A.run[o] = run;
        /* region: the 8 neighbours, wrapping in longitude */
        var i = c % g.nx, j = (c - i) / g.nx, ne = 0, nd = 0;
        for (var q = 0; q < 8; q++) {
          var jj = j + NB[q][0]; if (jj < 0 || jj >= g.ny) continue;
          var on = f * n + jj * g.nx + (i + NB[q][1] + g.nx) % g.nx;
          if (A.kind[on] === 1) { nd++; if (A.elev[on]) ne++; }
        }
        A.nbElev[o] = ne; A.nbData[o] = nd;
        /* trend: least-squares line through the last TREND_FRAMES frames that have a value */
        var sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0, x0 = 0, x1 = 0;
        for (var k = 0; k < K.TREND_FRAMES && f - k >= 0; k++) {
          var ot = (f - k) * n + c; if (!A.kind[ot]) continue;
          var x = y.sol[f - k], v = A.tau[ot];
          if (!m) x1 = x; x0 = x;
          sx += x; sy += v; sxx += x * x; sxy += x * v; m++;
        }
        if (m >= 3 && A.kind[o]) {
          var slope = (m * sxy - sx * sy) / (m * sxx - sx * sx), ch = slope * (x1 - x0), mean = sy / m;
          A.change[o] = ch;
          A.trend[o] = Math.abs(ch) >= Math.max(K.TREND_ABS, K.TREND_REL * mean) ? (ch > 0 ? 1 : -1) : 0;
        } else { A.change[o] = NAN; A.trend[o] = -2; }
        /* class */
        var cls = 0;
        if (A.kind[o]) {
          var t2 = A.tau[o], z2 = A.z[o], hasB = z2 === z2;
          var persistent = run >= K.PERSIST_FRAMES, regional = ne >= K.REGION_MIN;
          var lvl = function (name) { return t2 >= K.FLOOR[name] && (!hasB || z2 >= K.Z[name]); };
          cls = 1;
          if (lvl('MODERATE')) cls = 2;
          if (lvl('HIGH') && (persistent || regional)) cls = 3;
          if (hasB && lvl('SEVERE') && persistent && regional) cls = 4;
        }
        A.cls[o] = cls;
        var lat = g.lat0 - (j + 0.5) * g.dlat, w = Math.cos(lat * DEG);
        if (Math.abs(lat) < K.POLAR_LAT) {                   // the planet-wide share leaves out the less reliable polar cells
          areaAll += w;
          if (A.kind[o] === 1) { areaData += w; if (cls >= 3) aHigh += w; if (cls >= 2) aMod += w; if (cls > worst) worst = cls; }
        }
      }
      A.summary.push({ frame: f, ls: y.ls[f], sol: y.sol[f], coverage: areaData / areaAll,
        high: areaData ? aHigh / areaData : NAN, moderate: areaData ? aMod / areaData : NAN, worst: worst });
    }
    A.events = findEvents(A);
    analyses.set(my, A);
    records.set(my, { cls: A.cls, summary: A.summary, events: A.events });
    if (analyses.size > 3) analyses.delete(analyses.keys().next().value);
    return A;
  }

  /* Storm events: runs of frames in which HIGH or SEVERE cells cover at least EVENT_AREA of the observed planet. */
  function findEvents(A) {
    var ev = [], cur = null, gap = 0;
    A.summary.forEach(function (s) {
      if (s.high >= K.EVENT_AREA) {
        if (!cur) { cur = { from: s.frame, to: s.frame, lsFrom: s.ls, lsTo: s.ls, peak: s.high, peakFrame: s.frame, worst: s.worst }; ev.push(cur); }
        cur.to = s.frame; cur.lsTo = s.ls; gap = 0;
        if (s.high > cur.peak) { cur.peak = s.high; cur.peakFrame = s.frame; }
        if (s.worst > cur.worst) cur.worst = s.worst;
      } else if (cur && ++gap > 1) cur = null;
    });
    ev.forEach(function (e) { e.lsPeak = A.summary[e.peakFrame].ls; e.sols = (A.summary[e.to].sol - A.summary[e.from].sol) + P.stepSols; });
    return ev;
  }

  /* ------------------------------------------------------------------ one cell, explained */
  var TREND_NAME = { '1': 'increasing', '0': 'stable', '-1': 'decreasing', '-2': 'unknown' };
  function assess(my, frame, c) {
    var A = analyse(my), y = year(my);
    if (!A || frame < 0 || frame >= y.frames) return null;
    var o = frame * P.n + c, kind = A.kind[o], cls = A.cls[o], hasB = A.med[o] === A.med[o];
    var r = {
      my: my, frame: frame, cell: c, ls: y.ls[frame], sol: y.sol[frame], sols: [Math.max(1, y.sol[frame] - (P.stepSols >> 1)), y.sol[frame] + (P.stepSols >> 1)],
      instruments: y.instruments, version: y.version,
      label: kind === 1 ? 'OBSERVED' : kind === 2 ? 'INTERPOLATED' : 'NO DATA',
      tau: kind ? A.tau[o] : null,
      relUnc: kind === 1 && y.unc[o] !== MISSING ? y.unc[o] * 0.05 : null,
      reliability: kind === 1 && y.rel[o] !== MISSING ? y.rel[o] / 10 : null,
      baseline: hasB ? { label: 'HISTORICAL', median: A.med[o], p90: A.p90[o], spread: A.sig[o], values: A.bcnt[o], years: A.byrs[o] } : null,
      baselineValues: A.bcnt[o], baselineYears: A.byrs[o],
      z: kind && hasB ? A.z[o] : null,
      devPct: kind && hasB && A.med[o] > 0 ? (A.tau[o] - A.med[o]) / A.med[o] * 100 : null,
      cls: cls, className: K.CLASSES[cls],
      trend: TREND_NAME[A.trend[o]], change: A.trend[o] === -2 ? null : A.change[o],
      run: A.run[o], persistent: A.run[o] >= K.PERSIST_FRAMES,
      neighbours: { elevated: A.nbElev[o], observed: A.nbData[o] }, regional: A.nbElev[o] >= K.REGION_MIN
    };
    /* confidence in this cell's result */
    var conf = 'high', why = [];
    if (!kind) { conf = 'none'; why.push('no observation and no interpolated value'); }
    else {
      if (kind === 2) { conf = 'low'; why.push('interpolated between observations, not observed'); }
      if (!hasB) { conf = 'low'; why.push('too few earlier years here for a seasonal baseline'); }
      if (r.relUnc !== null && r.relUnc > 0.6) { conf = 'low'; why.push('retrieval uncertainty above 60 %'); }
      else if (r.relUnc !== null && r.relUnc > 0.3 && conf === 'high') { conf = 'medium'; why.push('retrieval uncertainty above 30 %'); }
      if (hasB && A.byrs[o] < 5 && conf === 'high') { conf = 'medium'; why.push('baseline from fewer than 5 years'); }
      if (r.reliability !== null && r.reliability < 0.5 && conf === 'high') { conf = 'medium'; why.push('low reliability value in the data set'); }
      if (Math.abs(cellBounds(c).lat) >= K.POLAR_LAT) { if (conf === 'high') conf = 'medium'; why.push('high latitude, where retrievals near the polar caps are less reliable'); }
    }
    r.confidence = conf; r.confidenceWhy = why;
    r.reasons = explain(r);
    return r;
  }
  function f2(v) { return v.toFixed(2); }
  /* The criteria behind the class, as sentences. */
  function explain(r) {
    var out = [];
    if (!r.cls) { out.push('No observation in this cell for these sols. Missing data is not evidence of clear air.'); return out; }
    var sd = function (z) { return (z < 0 ? '−' : '') + Math.abs(z).toFixed(1) + ' spreads'; };
    if (r.baseline) {
      out.push('Optical depth ' + f2(r.tau) + ' against a seasonal median of ' + f2(r.baseline.median) + ' (' + (r.devPct >= 0 ? '+' : '−') + Math.abs(Math.round(r.devPct)) + ' %, ' + sd(r.z) + ' from the median; baseline from ' + r.baseline.values + ' observations in ' + r.baseline.years + ' other Martian Years).');
    } else out.push('Optical depth ' + f2(r.tau) + '. No seasonal baseline here (' + r.baselineValues + ' observations in ' + r.baselineYears + ' other years), so only the optical-depth floors were applied and the class is capped at HIGH.');
    var elevated = r.tau >= K.FLOOR.MODERATE && (r.z === null || r.z >= K.Z.MODERATE);
    if (!elevated) {
      out.push(r.tau < K.FLOOR.MODERATE ? 'Below the ' + f2(K.FLOOR.MODERATE) + ' floor for MODERATE.' : 'Within ' + K.Z.MODERATE + ' spreads of the seasonal median: normal for this place and season.');
    } else {
      out.push(r.run >= K.PERSIST_FRAMES ? 'Persistent: elevated in ' + r.run + ' consecutive observed frames (about ' + r.run * P.stepSols + ' sols).'
        : r.label === 'OBSERVED' ? 'Not persistent: elevated in this frame only.' : 'Persistence unknown: no observation in this frame.');
      out.push(r.regional ? 'Regional: ' + r.neighbours.elevated + ' of ' + r.neighbours.observed + ' observed neighbouring cells are elevated too.'
        : 'Not regional: ' + r.neighbours.elevated + ' of ' + r.neighbours.observed + ' observed neighbouring cells are elevated (needs ' + K.REGION_MIN + ').');
      if (r.cls === 2 && r.tau >= K.FLOOR.HIGH && (r.z === null || r.z >= K.Z.HIGH)) out.push('High enough for HIGH, but neither persistent nor regional, so it is held at MODERATE as an isolated anomaly.');
      if (r.cls === 3 && r.z !== null && r.tau >= K.FLOOR.SEVERE && r.z >= K.Z.SEVERE) out.push('High enough for SEVERE, but SEVERE needs the rise to be both persistent and regional.');
    }
    if (r.trend !== 'unknown') out.push('Trend over the last ' + K.TREND_FRAMES + ' frames (' + K.TREND_FRAMES * P.stepSols + ' sols): ' + r.trend + ' (' + (r.change >= 0 ? '+' : '−') + f2(Math.abs(r.change)) + ').');
    else out.push('Trend unknown: fewer than 3 of the last ' + K.TREND_FRAMES + ' frames have a value.');
    return out;
  }

  /* What an elevated class can mean for a walk. Deliberately worded as possibilities: orbital optical depth
     does not measure visibility or surface conditions at the walker's position. */
  function implications(cls) {
    if (cls < 2) return [];
    var out = ['Visibility may be reduced; the amount on the ground is not measured by this data.',
               'Surface operations may be harder (navigation by landmarks, optics, dust on suits and seals).',
               'Solar power generation may be reduced, as more sunlight is absorbed and scattered by the dust column.'];
    out.push(cls >= 3 ? 'Reassess the timing of this Marswalk and check for more recent observations before leaving.'
                      : 'Consider whether the timing of this Marswalk should be reassessed.');
    return out;
  }

  /* ------------------------------------------------------------------ history of one cell */
  /* The optical depth of one cell through one year, with its baseline: for the chart under the timeline. */
  function series(my, c) {
    var A = analyse(my), y = year(my), out = [];
    for (var f = 0; f < y.frames; f++) {
      var o = f * P.n + c;
      out.push({ ls: y.ls[f], tau: A.kind[o] ? A.tau[o] : null, kind: A.kind[o], med: A.med[o] === A.med[o] ? A.med[o] : null, p90: A.p90[o] === A.p90[o] ? A.p90[o] : null, cls: A.cls[o] });
    }
    return out;
  }
  /* How this place and season have behaved in every year of the record: a historical risk, not a forecast. */
  function seasonalRisk(c, ls) {
    var rows = [], high = 0, withData = 0, pending = 0;
    P.years.forEach(function (y) {
      var rec = records.get(y.my), worst = 0, tauMax = null, seen = 0;
      if (!rec) { pending++; return; }                       // that year has not been analysed yet (see analyseNext)
      for (var f = 0; f < y.frames; f++) {
        if (lsDiff(y.ls[f], ls) > K.LS_WINDOW) continue;
        var o = f * P.n + c; if (y.obs[o] === MISSING) continue;
        var t = P.lut[y.obs[o]];
        seen++; if (rec.cls[o] > worst) worst = rec.cls[o]; if (tauMax === null || t > tauMax) tauMax = t;
      }
      rows.push({ my: y.my, worst: seen ? worst : 0, tauMax: tauMax, observed: seen });
      if (seen) { withData++; if (worst >= 3) high++; }
    });
    return { label: 'HISTORICAL', ls: ls, window: K.LS_WINDOW, years: rows, yearsWithData: withData, yearsHigh: high, pending: pending };
  }

  /* ------------------------------------------------------------------ routes */
  /* Dust along a route. points: [[lat, lon], …]. Returns the route cut into sections, one per data cell crossed. */
  function routeExposure(points, my, frame) {
    var secs = [], cur = null, total = 0;
    function visit(lat, lon, d) {
      var c = cellAt(lat, lon).c;
      if (!cur || cur.cell !== c) { cur = { cell: c, fromKm: total / 1000, toKm: total / 1000, line: [[lat, lon]] }; secs.push(cur); }
      else cur.line.push([lat, lon]);
      total += d; cur.toKm = total / 1000;
    }
    for (var k = 0; k < points.length; k++) {
      var p = points[k];
      if (!k) { visit(p[0], p[1], 0); continue; }
      var q = points[k - 1], dLat = p[0] - q[0], dLon = ((p[1] - q[1] + 540) % 360) - 180;
      var len = Math.hypot(dLat * DEG * R, dLon * DEG * R * Math.cos((p[0] + q[0]) / 2 * DEG));
      var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dLat), Math.abs(dLon)) / 0.5));      // never step over a cell
      for (var s = 1; s <= steps; s++) {
        var la = q[0] + dLat * s / steps, lo = q[1] + dLon * s / steps, before = cur;
        visit(la, lo, len / steps);
        if (cur !== before && before) cur.line.unshift(before.line[before.line.length - 1]);      // join the sections
      }
    }
    secs = secs.filter(function (s) { return s.line.length > 1 || secs.length === 1; });     // a lone first point exactly on a cell edge
    var worst = 0, kmNoData = 0, kmElevated = 0, kmIncreasing = 0;
    secs.forEach(function (s) {
      s.km = s.toKm - s.fromKm; s.a = assess(my, frame, s.cell); s.bounds = cellBounds(s.cell);
      if (!s.a.cls) kmNoData += s.km;
      if (s.a.cls >= 2) kmElevated += s.km;
      if (s.a.trend === 'increasing') kmIncreasing += s.km;
      if (s.a.cls > worst) worst = s.a.cls;
    });
    return { my: my, frame: frame, km: total / 1000, sections: secs, cells: new Set(secs.map(function (s) { return s.cell; })).size,
      worst: worst, worstName: K.CLASSES[worst], kmElevated: kmElevated, kmNoData: kmNoData, kmIncreasing: kmIncreasing,
      /* one number to rank routes by: class-weighted share of the length; unknown ground counts as MODERATE, never as clear */
      score: total ? secs.reduce(function (t, s) { return t + s.km * (s.a.cls ? s.a.cls - 1 : 1); }, 0) / (total / 1000) : 0 };
  }

  var api = MW.dust = {
    load: load,
    get pack() { return P; },
    years: function () { return P.years.map(function (y) { return y.my; }); },
    year: year, cellAt: cellAt, cellBounds: cellBounds, frameAtLs: frameAtLs, framesInLs: framesInLs, lsDiff: lsDiff,
    baselineFingerprint: baselineFingerprint, decodeBaselineBin: decodeBaselineBin, usingPrecomputed: function () { return !!pre; },
    analyse: analyse, assess: assess, series: series, seasonalRisk: seasonalRisk, routeExposure: routeExposure,
    implications: implications, baselineForBin: baselineForBin,
    record: function (my) { return records.get(my) || null; },
    /* Analyse one more year that has no record yet; returns how many are still to do. The page calls this in
       the background so the whole record becomes available without freezing. */
    analyseNext: function () {
      var todo = P.years.filter(function (y) { return !records.has(y.my); });
      if (todo.length) analyse(todo[0].my);
      return Math.max(0, todo.length - 1);
    },
    _reset: function () { analyses.clear(); records.clear(); }
  };
})();
