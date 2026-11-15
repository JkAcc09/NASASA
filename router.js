/* router.js — MW.router: finds ways from where the walker is to a destination, refuses the ones that
 * cannot be done, and gives each of the others a safety index. Pure logic: no map, no page. Runs under Node
 * (see router_test.js). Every limit and weight is in MW.config.ROUTER.
 *
 *   MW.router.plan(q) -> { ok, reason, code, options: [...], notes: [...], grid }
 *
 * q, the question:
 *   from, to      { lat, lon } ; to may carry a name
 *   walker        'astronaut' or 'robot'
 *   hour          local solar time of departure, 0 to 24          ls   season in degrees (for day length), or null
 *   wx            { tmin, tmax } air temperature of the sol in °C, or null where there is no weather station
 *   height        function (lat, lon) -> metres, or null           (MW.terrain.heightAt)
 *   dust          function (lat, lon) -> { cls, trend, tau, when } or null     (from MW.dust, for the Timeline's date)
 *   bases         [{ lat, lon, name }]                              the site base and every "home" marker
 *   hazards       [{ lat, lon, radius, name }]                      danger markers: routes stay outside the radius
 *   zones         [{ name, role, outline: [[lat, lon], …] }]       hazard areas (landmarks whose role is a hazard)
 *   known         [{ id, name, points: [[lat, lon], …], preferred }]   ground already walked or driven
 *   fmt           optional { dist(metres), drop(degrees C) } -> text, so the tags follow the units chosen in Settings
 *
 * How it works
 *   1. Refuse at once what no search can fix: too far for this walker, a SEVERE dust storm, a destination inside
 *      a keep-clear zone or on a regional slope past the limit.
 *   2. Lay a grid over the ground between the two points. Each cell gets its height and regional slope, whether
 *      it is closed (too steep, or inside a hazard), and whether a known trail runs through it.
 *   3. Search that grid (A*) several times, each time with a different idea of "cost": the safest way, the most
 *      direct way, the way that keeps to known ground, the way along the preferred trail, and an alternative
 *      that avoids the safest one. Routes that turn out the same are merged.
 *   4. Measure every route (distance, climb, time, daylight, temperature, dust, distance from base, share on
 *      known ground, hazard clearance), turn each measurement into a risk from 0 to 1, and combine them into
 *      the safety index: 100 x (1 - risk), where risk mixes the weighted mean with the single worst factor.
 *   5. Refuse routes that break a hard limit (time out and back, total climb). Rank the rest by index; the
 *      preferred trail goes first when it is within PREFER_MARGIN points of the best.
 *
 * Slope and climb are regional (see terrain.js). A local cliff is not in the data: that is what danger markers
 * are for.
 *
 *   MW.router.live(q) -> { index, factors: [{ key, risk, text, state }], good, bad, worst }
 *
 * The same index for one place at one moment: where the walker stands now. q is as above without `to`, with
 *   at        { lat, lon }                 elapsed   seconds since the walk began
 *   hour      local solar time now         slope     optional function (lat, lon) -> regional slope in degrees
 * "Time" is the time already out plus the way back to the nearest base; "daylight" is the light left on getting
 * back; "unwalked ground" is the distance to the nearest known trail; "climb" is the height above or below base.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var C = MW.config, K = C.ROUTER, R = C.R_MARS, DEG = Math.PI / 180, M = R * DEG;

  /* ------------------------------------------------------------------ small helpers */
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function wrap(d) { return ((d + 540) % 360) - 180; }
  function haversine(a, b) {
    var p1 = a.lat * DEG, p2 = b.lat * DEG, dp = p2 - p1, dl = wrap(b.lon - a.lon) * DEG;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function num(n, d) { return n.toLocaleString('en-GB', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function dist(m) { return m >= 10000 ? num(m / 1000) + ' km' : m >= 1000 ? num(m / 1000, 1) + ' km' : num(Math.round(m / 10) * 10 || Math.round(m)) + ' m'; }
  function dur(s) {
    var m = Math.round(s / 60); if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  function hhmm(h) { h = ((h % 24) + 24) % 24; var m = Math.round(h * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function minus(n) { return (n < 0 ? '−' : '') + num(Math.abs(n)); }
  var dist0 = dist, drop0 = function (c) { return Math.round(c) + ' °C'; }, drop = drop0;
  function useFormat(q) { dist = q.fmt && q.fmt.dist ? q.fmt.dist : dist0; drop = q.fmt && q.fmt.drop ? q.fmt.drop : drop0; }

  /* Sunrise and sunset in local solar hours, from latitude and season. Without a season: a 12 hour day. */
  function sun(lat, ls) {
    var decl = ls === null || ls === undefined ? 0 : Math.asin(Math.sin(25.19 * DEG) * Math.sin(ls * DEG));
    var c = -Math.tan(lat * DEG) * Math.tan(decl), half = c >= 1 ? 0 : c <= -1 ? 12 : Math.acos(c) / DEG / 15;
    return { rise: 12 - half, set: 12 + half, hours: 2 * half };
  }
  /* The app's own model of the day: REMS gives the sol's low and high, the curve between them peaks at 14:30. */
  function airAt(wx, hour) { return wx.tmin + (wx.tmax - wx.tmin) * (0.5 + 0.5 * Math.cos((hour - 14.5) / 24 * 2 * Math.PI)); }

  function inPolygon(poly, x, y) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > y) !== (poly[j].y > y) && x < (poly[j].x - poly[i].x) * (y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------------------------ a binary heap for the search */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length; k.push(key); v.push(val);
    while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      var i = 0;
      for (;;) { var c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };

  /* ------------------------------------------------------------------ the ground between two points */
  function buildGrid(q, P, prof) {
    var a = P.xy(q.from.lat, q.from.lon), b = P.xy(q.to.lat, q.to.lon), D = Math.hypot(b.x - a.x, b.y - a.y);
    var pad = Math.max(K.MARGIN_MIN, K.MARGIN * D);
    var x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad, w = Math.abs(b.x - a.x) + 2 * pad, h = Math.abs(b.y - a.y) + 2 * pad;
    var cell = Math.max(K.CELL_MIN, Math.max(w, h) / K.GRID), nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1, n = nx * ny;
    var G = { x0: x0, y0: y0, cell: cell, nx: nx, ny: ny, n: n, a: a, b: b, D: D,
      z: new Float32Array(n), slope: new Float32Array(n), closed: new Uint8Array(n), known: new Uint8Array(n), near: new Float32Array(n),
      kx: new Float32Array(n), ky: new Float32Array(n), kn: new Uint16Array(n), hasTerrain: !!q.height, hazardsNear: [], anyKnown: false, anyPreferred: false };
    G.idx = function (x, y) { var i = Math.round((x - x0) / cell), j = Math.round((y - y0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
    G.px = function (k) { return x0 + (k % nx) * cell; }; G.py = function (k) { return y0 + Math.floor(k / nx) * cell; };
    var i, j, k;
    /* height and regional slope */
    if (q.height) {
      for (k = 0; k < n; k++) { var ll = P.ll(G.px(k), G.py(k)); G.z[k] = q.height(ll.lat, ll.lon); }
      for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
        k = j * nx + i;
        var il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(ny - 1, j + 1);
        var gx = (G.z[j * nx + ir] - G.z[j * nx + il]) / ((ir - il) * cell), gy = (G.z[ju * nx + i] - G.z[jd * nx + i]) / ((ju - jd) * cell);
        G.slope[k] = Math.atan(Math.hypot(gx, gy)) / DEG;
        if (G.slope[k] > prof.slopeMax) G.closed[k] = 1;
      }
    }
    /* danger markers: closed inside the radius, costlier out to three times it */
    G.near.fill(1);
    (q.hazards || []).forEach(function (hz) {
      var c = P.xy(hz.lat, hz.lon), r = hz.radius > 0 ? hz.radius : K.DANGER_RADIUS, reach = 3 * r;
      if (c.x < x0 - reach || c.x > x0 + w + reach || c.y < y0 - reach || c.y > y0 + h + reach) return;
      G.hazardsNear.push({ x: c.x, y: c.y, r: r, name: hz.name });
      var i0 = Math.max(0, Math.floor((c.x - reach - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((c.x + reach - x0) / cell));
      var j0 = Math.max(0, Math.floor((c.y - reach - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((c.y + reach - y0) / cell));
      for (var jj = j0; jj <= j1; jj++) for (var ii = i0; ii <= i1; ii++) {
        var kk = jj * nx + ii, d = Math.hypot(x0 + ii * cell - c.x, y0 + jj * cell - c.y);
        if (d <= r) G.closed[kk] = 2;
        else if (d < reach) G.near[kk] = Math.max(G.near[kk], 1 + 2 * (1 - (d - r) / (reach - r)));
      }
    });
    /* hazard areas */
    G.zones = [];
    (q.zones || []).forEach(function (zn) {
      var poly = zn.outline.map(function (p) { return P.xy(p[0], p[1]); });
      var xs = poly.map(function (p) { return p.x; }), ys = poly.map(function (p) { return p.y; });
      var bx0 = Math.min.apply(null, xs), bx1 = Math.max.apply(null, xs), by0 = Math.min.apply(null, ys), by1 = Math.max.apply(null, ys);
      G.zones.push({ name: zn.name, role: zn.role, poly: poly });
      if (bx1 < x0 || bx0 > x0 + w || by1 < y0 || by0 > y0 + h) return;
      var i0 = Math.max(0, Math.floor((bx0 - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / cell));
      var j0 = Math.max(0, Math.floor((by0 - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((by1 - y0) / cell));
      for (var jj = j0; jj <= j1; jj++) for (var ii = i0; ii <= i1; ii++) if (inPolygon(poly, x0 + ii * cell, y0 + jj * cell)) G.closed[jj * nx + ii] = 3;
    });
    /* known ground: every cell a walked or driven trail runs through, and where in the cell it runs */
    (q.known || []).forEach(function (tr) {
      var flag = tr.preferred ? 2 : 1, prev = null;
      tr.points.forEach(function (pt) {
        var p = P.xy(pt[0], pt[1]);
        if (prev) {
          var len = Math.hypot(p.x - prev.x, p.y - prev.y), steps = Math.max(1, Math.ceil(len / (cell / 2)));
          if (len < 200 * cell && steps < 4000) for (var s = 1; s <= steps; s++) mark(prev.x + (p.x - prev.x) * s / steps, prev.y + (p.y - prev.y) * s / steps, flag);
        } else mark(p.x, p.y, flag);
        prev = p;
      });
    });
    function mark(x, y, flag) {
      var kk = G.idx(x, y); if (kk < 0) return;
      if (flag > G.known[kk]) { G.known[kk] = flag; G.kx[kk] = 0; G.ky[kk] = 0; G.kn[kk] = 0; }      // a preferred trail's line wins the cell
      if (flag === G.known[kk] && G.kn[kk] < 60000) { G.kx[kk] += x; G.ky[kk] += y; G.kn[kk]++; }
      G.anyKnown = true; if (flag === 2) G.anyPreferred = true;
    }
    return G;
  }

  /* ------------------------------------------------------------------ one search */
  var NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  function stepMult(G, S, k, prof) {
    var m = 1 + S.slopeK * Math.pow(G.slope[k] / prof.slopeMax, 2);
    if (S.hazard) m *= G.near[k];
    m *= G.known[k] === 2 ? S.prefMult : G.known[k] === 1 ? S.knownMult : 1;
    if (S.avoid && S.avoid[k]) m *= S.avoidMult;
    return m;
  }
  function search(G, S, prof, start, goal) {
    var n = G.n, nx = G.nx, ny = G.ny, cell = G.cell, g = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    var minMult = Math.min(1, S.knownMult, S.prefMult), gx = goal % nx, gy = Math.floor(goal / nx), heap = new Heap();
    g[start] = 0; heap.push(0, start);
    while (heap.k.length) {
      var k = heap.pop(); if (done[k]) continue; done[k] = 1;
      if (k === goal) break;
      var i = k % nx, j = (k - i) / nx;
      for (var q = 0; q < 8; q++) {
        var ii = i + NB[q][0], jj = j + NB[q][1]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        var kk = jj * nx + ii; if (done[kk] || (G.closed[kk] && kk !== goal)) continue;
        if (q > 3 && (G.closed[j * nx + ii] || G.closed[jj * nx + i])) continue;                // never cut the corner of a closed cell
        var c = g[k] + NB[q][2] * cell * stepMult(G, S, kk, prof) + S.upK * Math.max(0, G.z[kk] - G.z[k]);
        if (c < g[kk]) {
          g[kk] = c; from[kk] = k;
          var dx = Math.abs(ii - gx), dy = Math.abs(jj - gy);
          heap.push(c + (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * cell * minMult, kk);
        }
      }
    }
    if (!done[goal]) return null;
    var path = [];
    for (var p = goal; p !== -1; p = from[p]) path.push(p);
    return path.reverse();
  }
  /* The cost of walking straight from one cell to another, or Infinity if a closed cell is in the way. */
  function straightCost(G, S, prof, a, b) {
    var ax = G.px(a), ay = G.py(a), bx = G.px(b), by = G.py(b), len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / (G.cell / 2)));
    var cost = 0, pz = G.z[a];
    for (var s = 1; s <= steps; s++) {
      var k = G.idx(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps);
      if (k < 0 || (G.closed[k] && s < steps)) return Infinity;
      cost += len / steps * stepMult(G, S, k, prof) + S.upK * Math.max(0, G.z[k] - pz); pz = G.z[k];
    }
    return cost;
  }
  /* Straighten the stair-steps of a grid path wherever the straight line costs no more. */
  function straighten(G, S, prof, path) {
    var acc = [0], i;
    for (i = 1; i < path.length; i++) {
      var a = path[i - 1], b = path[i];
      acc.push(acc[i - 1] + Math.hypot(G.px(b) - G.px(a), G.py(b) - G.py(a)) * stepMult(G, S, b, prof) + S.upK * Math.max(0, G.z[b] - G.z[a]));
    }
    var out = [path[0]]; i = 0;
    while (i < path.length - 1) {
      var best = i + 1;
      for (var j = Math.min(path.length - 1, i + 400); j > i + 1; j--) {
        if (straightCost(G, S, prof, path[i], path[j]) <= (acc[j] - acc[i]) * 1.0005 + 1e-6) { best = j; break; }
      }
      out.push(path[best]); i = best;
    }
    return out;
  }

  /* ------------------------------------------------------------------ measuring one route */
  function measure(q, P, G, prof, cells, S) {
    /* the line: the exact start, each cell (moved onto the trail where it follows one), the exact destination */
    var pts = [{ x: G.a.x, y: G.a.y }];
    for (var c = 1; c < cells.length - 1; c++) {
      var k = cells[c];
      pts.push(G.kn[k] ? { x: G.kx[k] / G.kn[k], y: G.ky[k] / G.kn[k] } : { x: G.px(k), y: G.py(k) });
    }
    pts.push({ x: G.b.x, y: G.b.y });
    var bases = (q.bases || []).map(function (b) { var p = P.xy(b.lat, b.lon); return { x: p.x, y: p.y, name: b.name }; });
    var nearestBase = function (x, y) { var best = null; bases.forEach(function (b) { var d = Math.hypot(b.x - x, b.y - y); if (!best || d < best.d) best = { d: d, name: b.name }; }); return best; };

    var total = 0, climb = 0, descent = 0, maxSlope = 0, knownLen = 0, prefLen = 0, baseFar = 0, baseFarName = '', clear = Infinity, clearName = '';
    var step = Math.max(1, Math.min(G.cell / 2, 50)), prevZ = null;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / step));
      for (var s = (i === 1 ? 0 : 1); s <= n; s++) {
        var x = a.x + (b.x - a.x) * s / n, y = a.y + (b.y - a.y) * s / n, kk = G.idx(x, y), d = s === 0 ? 0 : len / n;
        total += d;
        if (kk >= 0) {
          if (G.slope[kk] > maxSlope) maxSlope = G.slope[kk];
          if (G.known[kk]) knownLen += d;
          if (G.known[kk] === 2) prefLen += d;
        }
        if (q.height) {
          var ll = P.ll(x, y), z = q.height(ll.lat, ll.lon);
          if (prevZ !== null) { if (z > prevZ) climb += z - prevZ; else descent += prevZ - z; }
          prevZ = z;
        }
        var nb = nearestBase(x, y); if (nb && nb.d > baseFar) { baseFar = nb.d; baseFarName = nb.name; }
        G.hazardsNear.forEach(function (hz) { var cl = Math.hypot(hz.x - x, hz.y - y) - hz.r; if (cl < clear) { clear = cl; clearName = hz.name; } });
      }
    }
    var m = { distance: total, climb: climb, descent: descent, maxSlope: maxSlope, knownShare: total ? knownLen / total : 0, preferredShare: total ? prefLen / total : 0,
              baseFar: baseFar, baseFarName: baseFarName, clearance: clear, clearanceName: clearName, hasTerrain: G.hasTerrain };
    m.startBase = nearestBase(G.a.x, G.a.y); m.endBase = nearestBase(G.b.x, G.b.y);

    /* time */
    m.moveTime = total / prof.speed + (prof.climbRate ? climb / prof.climbRate * 3600 : 0);
    if (prof.needsReturn) {
      var back = m.endBase ? m.endBase.d : 0;
      m.returnDistance = back <= K.AT_BASE ? 0 : back * K.RETURN_DETOUR; m.returnTime = m.returnDistance / prof.speed;
      m.totalTime = m.moveTime + m.returnTime; m.budget = prof.hours * 3600;
    } else {
      m.returnDistance = 0; m.returnTime = 0; m.totalTime = m.moveTime; m.budget = prof.sols * prof.driveHours * 3600;
      m.sols = m.moveTime / (prof.driveHours * 3600);
    }

    /* daylight and temperature over the outing (a robot drives by day only, so neither is counted for it) */
    var s0 = sun(q.from.lat, q.ls), hours = m.totalTime / C.MARS_HOUR, dark = 0, tick = 0, minT = null, t0 = null;
    m.sun = s0; m.arrive = q.hour + m.moveTime / C.MARS_HOUR; m.back = q.hour + hours;
    if (prof.needsReturn) {
      var dt = Math.max(1 / 60, Math.min(1 / 6, hours / 200));
      for (var hh = 0; hh <= hours + 1e-9; hh += dt) {
        var h = (q.hour + hh) % 24; tick++;
        if (h < s0.rise - K.TWILIGHT || h > s0.set + K.TWILIGHT) dark++;
        if (q.wx) { var T = airAt(q.wx, h); if (t0 === null) t0 = T; if (minT === null || T < minT) minT = T; }
      }
      m.darkShare = tick ? dark / tick : 0;
      m.lightLeft = s0.set + K.TWILIGHT - (q.hour + hours);                      // hours of light left on getting back (negative: after dark)
      if (q.wx) { m.tempStart = t0; m.tempMin = minT; m.tempDrop = t0 - minT; }
    } else m.darkShare = 0;

    /* dust along the line */
    if (q.dust) {
      var worst = -1, any = null, rising = false, nodata = false;
      for (var f = 0; f <= 8; f++) {
        var at = pointAlong(pts, total * f / 8), l2 = P.ll(at.x, at.y), dd = q.dust(l2.lat, l2.lon);
        if (!dd) continue;
        if (!dd.cls) nodata = true;
        var rk = K.DUST_RISK[dd.cls];
        if (!any || rk > K.DUST_RISK[worst]) { worst = dd.cls; any = dd; }
        if (dd.trend === 'increasing') rising = true;
      }
      if (any) m.dust = { cls: worst, name: C.DUST.CLASSES[worst], rising: rising, nodata: nodata, tau: any.tau, when: any.when };
    }
    m.line = pts.map(function (p) { var l = P.ll(p.x, p.y); return [+l.lat.toFixed(7), +l.lon.toFixed(7)]; });
    return m;
  }
  function pointAlong(pts, d) {
    for (var i = 1; i < pts.length; i++) {
      var len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (d <= len || i === pts.length - 1) { var f = len ? Math.min(1, d / len) : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }; }
      d -= len;
    }
    return pts[0];
  }

  /* ------------------------------------------------------------------ the safety index */
  /* Each factor: a risk from 0 (no concern) to 1 (as bad as it gets), and the short tag that says why. */
  function factors(q, prof, m) {
    var F = [], w = prof.w;
    function add(key, risk, good, bad, mid) { if (w[key] > 0 && risk !== null) F.push({ key: key, risk: clamp(risk), weight: w[key], good: good, bad: bad, mid: mid || bad }); }
    if (m.dust) {
      var dr = K.DUST_RISK[m.dust.cls] + (m.dust.rising ? K.DUST_RISING : 0);
      add('dust', dr, 'no dust storm (LOW)', m.dust.cls ? 'dust storm ' + m.dust.name + (m.dust.rising ? ', rising' : '') : 'no dust data',
        m.dust.cls === 2 ? 'minor dust (MODERATE)' + (m.dust.rising ? ', rising' : '') : m.dust.cls ? 'dust ' + m.dust.name : 'no dust data');
    }
    if (m.hasTerrain) {
      var sl = Math.round(m.maxSlope);
      add('slope', (m.maxSlope - prof.slopeEasy) / (prof.slopeMax - prof.slopeEasy), (sl <= 5 ? 'gentle' : 'moderate') + ' regional slope ' + sl + '°', 'steep regional slope ' + sl + '°', 'regional slope ' + sl + '°');
      var cl = Math.round(m.climb / 10) * 10;
      add('climb', m.climb / prof.climbRef, cl < 10 ? 'level ground' : 'little climb ' + dist(cl), 'high climb ' + dist(cl), 'climb ' + dist(cl));
    }
    add('base', m.baseFar / prof.baseFar, 'nearest base ' + dist(m.baseFar), 'far from base ' + dist(m.baseFar), 'base within ' + dist(m.baseFar));
    if (prof.needsReturn) {
      add('time', m.totalTime / m.budget, 'short travel distance ' + dist(m.distance), 'long outing ' + dur(m.totalTime) + (m.returnTime ? ' with the way back' : ''), 'travel ' + dist(m.distance) + ', ' + dur(m.moveTime));
      if (m.tempDrop !== undefined) {
        var td = Math.round(m.tempDrop);
        add('temp', m.tempDrop / prof.tempRef, td < 1 ? 'steady temperature' : 'small temperature drop ' + drop(td), 'large temperature drop ' + drop(td), 'temperature drop ' + drop(td));
      }
      var darkRisk = m.darkShare > 0 ? 0.5 + 0.5 * m.darkShare : m.lightLeft < 1 ? 0.3 : 0;
      add('dark', darkRisk, 'daylight all the way', (m.returnTime ? 'back after dark, ' : 'arrives after dark, ') + hhmm(m.back), 'under 1 h of light to spare');
    } else {
      var so = m.sols < 1 ? 'under 1 sol' : 'about ' + num(Math.ceil(m.sols)) + ' sols';
      add('time', m.totalTime / m.budget, 'short drive ' + dist(m.distance), 'long drive, ' + so, 'drive ' + dist(m.distance) + ', ' + so);
      if (m.tempDrop !== undefined) add('temp', m.tempDrop / prof.tempRef, 'steady temperature', 'large temperature drop', 'temperature drop');
    }
    var kn = Math.round(m.knownShare * 100), pf = Math.round(m.preferredShare * 100);
    var fresh = m.distance * (1 - m.knownShare);             // metres of ground nobody has walked: a short hop counts less than a long stretch
    add('unknown', (1 - m.knownShare) * (0.4 + 0.6 * clamp(fresh / prof.unknownRef)), pf >= 50 ? pf + ' % on your preferred trail' : kn + ' % on walked ground',
      kn ? 'only ' + kn + ' % on walked ground' : 'unwalked ground', kn + ' % on walked ground');
    if (m.clearance !== Infinity) {
      var cc = Math.max(0, m.clearance), nm = m.clearanceName ? ' “' + m.clearanceName + '”' : ' a hazard';
      add('hazard', 1 - cc / (3 * hazardRadius(q, m.clearanceName)), 'keeps ' + dist(cc) + ' clear of' + nm, 'passes ' + dist(cc) + ' from the edge of' + nm, dist(cc) + ' clear of' + nm);
    }
    return F;
  }
  function hazardRadius(q, name) {
    var hz = (q.hazards || []).filter(function (h) { return h.name === name; })[0];
    return hz && hz.radius > 0 ? hz.radius : K.DANGER_RADIUS;
  }
  function score(F) {
    var sw = 0, swr = 0, worst = 0;
    F.forEach(function (f) { sw += f.weight; swr += f.weight * f.risk; worst = Math.max(worst, f.risk * (K.IMPORTANCE[f.key] || 0.7)); });
    var mean = sw ? swr / sw : 0, risk = K.MEAN_SHARE * mean + (1 - K.MEAN_SHARE) * worst;
    return { index: Math.round(100 * (1 - clamp(risk))), mean: mean, worst: worst };
  }
  function tags(F) {
    var good = F.filter(function (f) { return f.risk <= K.TAG_GOOD; }).sort(function (a, b) { return b.weight * (1 - b.risk) - a.weight * (1 - a.risk); });
    var imp = function (f) { return f.risk * (K.IMPORTANCE[f.key] || 0.7); };
    var bad = F.filter(function (f) { return f.risk >= K.TAG_BAD; }).sort(function (a, b) { return imp(b) - imp(a) || b.weight - a.weight; });
    /* A route that keeps to walked ground says so first: that is the reason it was offered. */
    var kn = good.filter(function (f) { return f.key === 'unknown'; })[0];
    if (kn) good = [kn].concat(good.filter(function (f) { return f !== kn; }));
    return { good: good.slice(0, 3).map(function (f) { return f.good; }), bad: bad.slice(0, 4).map(function (f) { return f.bad; }) };
  }

  /* ------------------------------------------------------------------ the whole plan */
  var STRATEGIES = [
    { id: 'safest',    label: 'Balanced',                   slopeK: 2, knownMult: 0.7, prefMult: 0.6,  hazard: true },
    { id: 'known',     label: 'Known ground',               slopeK: 2, knownMult: 0.3, prefMult: 0.3,  hazard: true, needs: 'anyKnown' },
    { id: 'direct',    label: 'Most direct',                slopeK: 0, knownMult: 1,   prefMult: 1,    hazard: false, flat: true },
    { id: 'alt',       label: 'Alternative',                slopeK: 2, knownMult: 0.7, prefMult: 0.6,  hazard: true, avoidBest: true },
    { id: 'preferred', label: 'Along your preferred trail', slopeK: 2, knownMult: 0.6, prefMult: 0.12, hazard: true, needs: 'anyPreferred' }   // last: it is compared with the others
  ];
  var PREF_MIN = 0.3;              // a route counts as "along the preferred trail" when at least this share of it is on the trail
  function fail(code, reason, extra) { var r = { ok: false, code: code, reason: reason, options: [], notes: [] }; if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return r; }

  function plan(q) {
    useFormat(q);
    var prof = K.WALKERS[q.walker] || K.WALKERS.astronaut, who = q.walker === 'robot' ? 'a robot' : 'an astronaut', name = q.to.name ? '“' + q.to.name + '”' : 'that point';
    var straight = haversine(q.from, q.to);
    if (straight < 2) return fail('there', 'You are already at ' + name + '.');

    /* 1. what no search can fix */
    var reach = prof.needsReturn ? prof.speed * prof.hours * 3600 : prof.speed * prof.sols * prof.driveHours * 3600;
    if (straight > reach) {
      return fail('far', 'No viable route to ' + name + ': it is ' + dist(straight) + ' away in a straight line. ' +
        (prof.needsReturn ? 'An astronaut covers at most ' + dist(reach) + ' in ' + prof.hours + ' h of walking at ' + prof.speed + ' m/s, before any way back.'
                          : 'A robot covers at most ' + dist(reach) + ' in ' + prof.sols + ' sols of driving.'), { straight: straight });
    }
    var dustTo = q.dust ? q.dust(q.to.lat, q.to.lon) : null, dustFrom = q.dust ? q.dust(q.from.lat, q.from.lon) : null;
    var blocked = [dustTo, dustFrom].filter(function (d) { return d && d.cls >= prof.dustBlock; })[0];
    if (blocked) {
      return fail('dust', 'No viable route to ' + name + ': ' + (blocked === dustTo ? 'the destination is' : 'you are') + ' in a ' + C.DUST.CLASSES[blocked.cls] + ' dust storm' +
        (blocked.tau ? ' (optical depth ' + blocked.tau.toFixed(2) + ')' : '') + (blocked.when ? ' on ' + blocked.when : '') + '. Wait for it to clear, or choose another date on the Timeline.', { dust: blocked });
    }
    var lat0 = (q.from.lat + q.to.lat) / 2, lon0 = q.from.lon + wrap(q.to.lon - q.from.lon) / 2, k0 = Math.max(0.02, Math.cos(lat0 * DEG));
    var P = { xy: function (lat, lon) { return { x: wrap(lon - lon0) * k0 * M, y: (lat - lat0) * M }; },
              ll: function (x, y) { return { lat: lat0 + y / M, lon: lon0 + x / (k0 * M) }; } };
    var G = buildGrid(q, P, prof), start = G.idx(G.a.x, G.a.y), goal = G.idx(G.b.x, G.b.y);
    var hz = G.hazardsNear.filter(function (h) { return Math.hypot(h.x - G.b.x, h.y - G.b.y) <= h.r; })[0];
    if (hz) return fail('hazard', 'No viable route to ' + name + ': it is inside the ' + dist(hz.r) + ' keep-clear distance of the danger marker “' + hz.name + '”.');
    var zn = G.zones.filter(function (z) { return inPolygon(z.poly, G.b.x, G.b.y); })[0];
    if (zn) return fail('zone', 'No viable route to ' + name + ': it is inside ' + zn.name + ' (' + zn.role + ').');
    if (G.hasTerrain && G.slope[goal] > prof.slopeMax) {
      return fail('slope', 'No viable route to ' + name + ': it is on a regional slope of ' + Math.round(G.slope[goal]) + '°, steeper than the ' + prof.slopeMax + '° limit for ' + who +
        '. The land there is a scarp or a mountain flank.', { slope: G.slope[goal] });
    }
    G.closed[start] = 0;                                    // wherever the walker stands, they can leave

    /* 2 and 3. search once per strategy, merge the ones that come out the same */
    var upK = prof.climbRate ? prof.speed * 3600 / prof.climbRate : 0, found = [], bestCells = null, prefUnused = false;
    STRATEGIES.forEach(function (S0) {
      if (S0.needs && !G[S0.needs]) return;
      var S = { slopeK: S0.slopeK, knownMult: S0.knownMult, prefMult: S0.prefMult, hazard: S0.hazard, upK: S0.flat ? 0 : upK, avoid: null, avoidMult: 3 };
      if (S0.avoidBest) {
        if (!bestCells) return;
        S.avoid = new Uint8Array(G.n);
        bestCells.slice(3, -3).forEach(function (k) { var i = k % G.nx, j = (k - i) / G.nx; for (var dj = -3; dj <= 3; dj++) for (var di = -3; di <= 3; di++) { var ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < G.nx && jj < G.ny) S.avoid[jj * G.nx + ii] = 1; } });
      }
      var raw = search(G, S, prof, start, goal); if (!raw) return;
      if (S0.id === 'safest') bestCells = raw;
      var set = new Set(raw), same = found.filter(function (f) { var n = 0; raw.forEach(function (k) { if (f.set.has(k)) n++; }); return n / Math.min(raw.length, f.raw.length) > 0.85; })[0];
      if (S0.id === 'preferred') {
        /* The preferred trail is only credited when the route really runs along it. If that route is one already
           found, that one becomes the preferred-trail option; if the trail does not lead there, it is left out. */
        var on = 0; raw.forEach(function (k) { if (G.known[k] === 2) on++; });
        if (on / raw.length < PREF_MIN) { prefUnused = true; return; }
        if (same) { same.also.unshift(same.label); same.id = 'preferred'; same.label = S0.label; return; }
      } else if (same) { same.also.push(S0.label); return; }
      found.push({ id: S0.id, label: S0.label, also: [], raw: raw, set: set, cells: straighten(G, S, prof, raw), S: S });
    });
    if (!found.length) {
      var why = [];
      if (G.closed.some(function (c) { return c === 1; })) why.push('ground steeper than the ' + prof.slopeMax + '° regional-slope limit for ' + who);
      if (G.closed.some(function (c) { return c === 2; })) why.push('the keep-clear distance of a danger marker');
      if (G.closed.some(function (c) { return c === 3; })) why.push('a hazard area');
      return fail('closed', 'No viable route to ' + name + ': every way there crosses ' + (why.join(' or ') || 'closed ground') + '.');
    }

    /* 4 and 5. measure, score, refuse, rank */
    var options = found.map(function (f) {
      var m = measure(q, P, G, prof, f.cells, f.S), F = factors(q, prof, m), sc = score(F), tg = tags(F), o = { id: f.id, label: f.label, also: f.also, metrics: m, factors: F, index: sc.index, good: tg.good, bad: tg.bad, line: m.line, viable: true, refused: null };
      if (m.totalTime > m.budget) {
        o.viable = false;
        o.refused = prof.needsReturn ? dist(m.distance) + ' out takes ' + dur(m.moveTime) + (m.returnTime ? ' and the way back to ' + (m.endBase.name || 'the nearest base') + ' ' + dur(m.returnTime) : '') +
          ': more than the ' + prof.hours + ' h an astronaut can stay out' : dist(m.distance) + ' is about ' + num(Math.ceil(m.sols)) + ' sols of driving: more than the ' + prof.sols + ' sol limit';
      } else if (m.hasTerrain && m.climb > prof.climbMax) {
        o.viable = false; o.refused = 'the way there climbs ' + dist(Math.round(m.climb / 10) * 10) + ', more than the ' + dist(prof.climbMax) + ' limit for ' + who;
      } else if (m.dust && m.dust.cls >= prof.dustBlock) {
        o.viable = false; o.refused = 'the way there crosses a ' + m.dust.name + ' dust storm';
      }
      return o;
    });
    var viable = options.filter(function (o) { return o.viable; });
    if (!viable.length) {
      var least = options.slice().sort(function (a, b) { return a.metrics.totalTime - b.metrics.totalTime; })[0];
      return fail('limit', 'No viable route to ' + name + ': ' + least.refused + '.', { tried: options });
    }
    viable.sort(function (a, b) { return b.index - a.index || a.metrics.distance - b.metrics.distance; });
    var pref = viable.filter(function (o) { return o.id === 'preferred'; })[0], notes = [];
    if (pref && pref !== viable[0] && pref.index >= viable[0].index - K.PREFER_MARGIN) { viable.splice(viable.indexOf(pref), 1); viable.unshift(pref); }
    viable.forEach(function (o, i) { o.rank = i + 1; o.recommended = i === 0; });
    var hasPref = (q.known || []).some(function (t) { return t.preferred; });
    if (hasPref && !pref) notes.push(G.anyPreferred && !prefUnused ? 'No separate route along your preferred trail was found.' : 'Your preferred trail does not lead from here to this destination, so it was not used.');
    else if (pref && !pref.recommended) notes.push('Your preferred trail is not recommended this time: its safety index is more than ' + K.PREFER_MARGIN + ' points below the best route.');
    if (G.hasTerrain) notes.push('Slope and climb are regional values from the MOLA shape model (about 15 km resolution). A local cliff, dune or boulder field is not in the data: mark the ones you know with a danger marker.');
    else notes.push('Terrain data is not loaded, so slope and climb were not counted.');
    if (!q.dust) notes.push('Dust data is not loaded, so dust was not counted.');
    if (!q.wx && prof.needsReturn) notes.push('There is no weather station near this route, so temperature was not counted.');
    return { ok: true, reason: null, code: 'ok', options: viable, refused: options.filter(function (o) { return !o.viable; }), notes: notes,
             grid: { cell: G.cell, nx: G.nx, ny: G.ny }, straight: straight, walker: q.walker === 'robot' ? 'robot' : 'astronaut', sun: sun(q.from.lat, q.ls) };
  }

  /* ------------------------------------------------------------------ the index where the walker stands, now */
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }
  function live(q) {
    useFormat(q);
    var prof = K.WALKERS[q.walker] || K.WALKERS.astronaut, L = K.LIVE, at = q.at, k0 = Math.max(0.02, Math.cos(at.lat * DEG)), w = prof.w, F = [];
    var xy = function (lat, lon) { return { x: wrap(lon - at.lon) * k0 * M, y: (lat - at.lat) * M }; };       // metres east and north of the walker
    function add(key, risk, good, bad, mid) {
      if (!(w[key] > 0) || risk === null) return;
      risk = clamp(risk);
      F.push({ key: key, risk: risk, weight: w[key], good: good, bad: bad, mid: mid || bad, text: risk <= K.TAG_GOOD ? good : risk >= K.TAG_BAD ? bad : (mid || bad), state: risk <= K.TAG_GOOD ? 'good' : risk >= K.TAG_BAD ? 'bad' : 'mid' });
    }
    var base = null; (q.bases || []).forEach(function (b) { var d = haversine(at, b); if (!base || d < base.d) base = { d: d, name: b.name, lat: b.lat, lon: b.lon }; });
    var backDist = base && base.d > K.AT_BASE ? base.d * K.RETURN_DETOUR : 0, backTime = backDist / prof.speed, hour = ((q.hour % 24) + 24) % 24, elapsed = Math.max(0, q.elapsed || 0);

    var d = q.dust ? q.dust(at.lat, at.lon) : null;
    if (d) add('dust', K.DUST_RISK[d.cls] + (d.trend === 'increasing' ? K.DUST_RISING : 0), 'no dust storm (LOW)', d.cls ? 'dust storm ' + C.DUST.CLASSES[d.cls] + (d.trend === 'increasing' ? ', rising' : '') : 'no dust data',
      d.cls === 2 ? 'minor dust (MODERATE)' : d.cls ? 'dust ' + C.DUST.CLASSES[d.cls] : 'no dust data');
    if (q.height) {
      var sl;
      if (q.slope) sl = q.slope(at.lat, at.lon);
      else { var h = 1000, gx = (q.height(at.lat, at.lon + h / (M * k0)) - q.height(at.lat, at.lon - h / (M * k0))) / (2 * h), gy = (q.height(at.lat + h / M, at.lon) - q.height(at.lat - h / M, at.lon)) / (2 * h); sl = Math.atan(Math.hypot(gx, gy)) / DEG; }
      var s0 = Math.round(sl);
      add('slope', (sl - prof.slopeEasy) / (prof.slopeMax - prof.slopeEasy), (s0 <= 5 ? 'gentle' : 'moderate') + ' regional slope ' + s0 + '°', 'steep regional slope ' + s0 + '°', 'regional slope ' + s0 + '°');
      if (base) {
        var dz = q.height(at.lat, at.lon) - q.height(base.lat, base.lon), a = Math.round(Math.abs(dz) / 10) * 10, rel = dz >= 0 ? ' above base' : ' below base';
        add('climb', Math.abs(dz) / prof.climbRef, a < 10 ? 'level with base' : dist(a) + rel, dist(a) + rel, dist(a) + rel);
      }
    }
    if (base) add('base', base.d / prof.baseFar, base.d <= K.AT_BASE ? 'at base' : 'nearest base ' + dist(base.d), 'far from base ' + dist(base.d), 'base ' + dist(base.d) + ' away');
    if (prof.needsReturn) {
      var budget = prof.hours * 3600, used = elapsed + backTime, left = budget - used;
      add('time', used / budget, dur(Math.max(0, left)) + ' to spare after the way back', left > 0 ? 'only ' + dur(left) + ' to spare after the way back' : 'past the ' + prof.hours + ' h limit by ' + dur(-left), dur(Math.max(0, left)) + ' to spare after the way back');
      if (q.wx) {
        var t0 = airAt(q.wx, hour - elapsed / C.MARS_HOUR), drp = Math.max(0, t0 - Math.min(airAt(q.wx, hour), airAt(q.wx, hour + backTime / C.MARS_HOUR))), td = Math.round(drp);
        add('temp', drp / prof.tempRef, td < 1 ? 'steady temperature' : 'small temperature drop ' + drop(td), 'large temperature drop ' + drop(td), 'temperature drop ' + drop(td));
      }
      var sn = sun(at.lat, q.ls), darkNow = hour < sn.rise - K.TWILIGHT || hour > sn.set + K.TWILIGHT, light = sn.set + K.TWILIGHT - (hour + backTime / C.MARS_HOUR);
      add('dark', darkNow ? 1 : light < 0 ? 0.5 + 0.5 * Math.min(1, -light / 2) : light < 1 ? 0.3 : 0, 'daylight for the way back', darkNow ? 'in the dark now' : 'back after dark, ' + hhmm(hour + backTime / C.MARS_HOUR), 'under 1 h of light to spare');
    } else {
      var bud = prof.sols * prof.driveHours * 3600;
      add('time', elapsed / bud, 'early in the traverse', 'long traverse, ' + dur(elapsed) + ' of driving', dur(elapsed) + ' of driving');
    }
    /* the nearest known trail */
    var off = Infinity;
    (q.known || []).forEach(function (tr) {
      var prev = null;
      for (var i = 0; i < tr.points.length; i++) {
        var p = xy(tr.points[i][0], tr.points[i][1]);
        if (Math.abs(p.x) > 5000 && Math.abs(p.y) > 5000) { prev = null; continue; }
        var dd = prev ? segDist(0, 0, prev.x, prev.y, p.x, p.y) : Math.hypot(p.x, p.y);
        if (dd < off) off = dd; prev = p;
      }
    });
    var o10 = Math.round(Math.min(off, 1e6) / 10) * 10;
    add('unknown', off === Infinity ? 1 : off / L.OFF_TRAIL, off < 10 ? 'on a known trail' : 'known trail ' + dist(o10) + ' away', off === Infinity ? 'no known trail near' : dist(o10) + ' from any known trail', 'known trail ' + dist(o10) + ' away');
    /* danger markers and hazard areas */
    var hz = null;
    (q.hazards || []).forEach(function (h1) { var r = h1.radius > 0 ? h1.radius : K.DANGER_RADIUS, cl = haversine(at, h1) - r, rk = 1 - cl / (3 * r); if (!hz || rk > hz.risk) hz = { risk: rk, cl: cl, name: h1.name, r: r }; });
    var zone = (q.zones || []).filter(function (z) { return inPolygon(z.outline.map(function (p) { return xy(p[0], p[1]); }), 0, 0); })[0];
    if (zone) add('hazard', 1, '', 'inside ' + zone.name + ' (' + zone.role + ')');
    else if (hz) add('hazard', hz.risk, dist(Math.max(0, hz.cl)) + ' clear of “' + hz.name + '”', hz.cl <= 0 ? 'inside the keep-clear distance of “' + hz.name + '”' : 'only ' + dist(hz.cl) + ' from the edge of “' + hz.name + '”', dist(Math.max(0, hz.cl)) + ' clear of “' + hz.name + '”');

    var sc = score(F), tg = tags(F), worst = null;
    F.forEach(function (f) { var v = f.risk * (K.IMPORTANCE[f.key] || 0.7); if (!worst || v > worst.v) worst = { v: v, key: f.key, risk: f.risk, text: f.text, state: f.state }; });
    return { index: sc.index, factors: F, good: tg.good, bad: tg.bad, worst: worst, base: base, backTime: backTime, walker: q.walker === 'robot' ? 'robot' : 'astronaut' };
  }

  MW.router = { plan: plan, live: live, sun: sun, airAt: airAt, haversine: haversine, format: { dist: dist0, dur: dur, hhmm: hhmm, minus: minus } };
})();
