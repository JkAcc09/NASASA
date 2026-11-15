/* trail.js — MW.Trail, the walker's breadcrumb trail. Pure logic: no map, no page.
 *
 *   pts    every stored position in order: { x, y, ll, d (odometer, m), t (seconds), hdg, sol, n, first }
 *   grid   3 m ground cells holding point indices: a spatial index, so "have I been here?" is a
 *          look-up in nine cells and never a scan of the whole trail
 *
 * A new pass over a spot is counted when the walker comes within NEAR metres of earlier trail
 * after walking at least REVISIT_GAP metres away from it. Each point carries n, the number of
 * passes over that ground so far. The map colours the line by n.
 */
(function () {
  'use strict';
  var C = MW.config, G = MW.geo;

  function Trail() { this.reset(); }

  Trail.prototype.reset = function () { this.pts = []; this.grid = new Map(); this.dirty = true; };

  /* Store one point. meta = { t, hdg, sol }. */
  Trail.prototype.add = function (x, y, odo, meta) {
    var pts = this.pts, i = pts.length, cx = Math.floor(x / C.CELL), cy = Math.floor(y / C.CELL);
    var p = { x: x, y: y, ll: G.toLL(x, y), d: odo, t: meta.t, hdg: meta.hdg, sol: meta.sol, n: 1, first: i };
    var near = [];
    for (var gx = cx - 1; gx <= cx + 1; gx++) for (var gy = cy - 1; gy <= cy + 1; gy++) {
      var cell = this.grid.get(gx + ',' + gy); if (!cell) continue;
      for (var k = 0; k < cell.length; k++) if (Math.hypot(pts[cell[k]].x - x, pts[cell[k]].y - y) < C.NEAR) near.push(cell[k]);
    }
    if (near.length) {
      near.sort(function (a, b) { return a - b; });
      var runs = 0, lastD = -1e9;
      near.forEach(function (j) {
        var q = pts[j];
        if (q.d - lastD > C.REVISIT_GAP) runs++;                       // a separate earlier pass
        lastD = q.d;
        if (odo - q.d > C.REVISIT_GAP && q.first < p.first) p.first = q.first;   // same ground, reached earlier
      });
      if (odo - lastD > C.REVISIT_GAP) runs++;                         // this arrival is a new pass too
      p.n = Math.max(1, runs);
      near.forEach(function (j) { if (pts[j].n < p.n) pts[j].n = p.n; });       // deepen the earlier line as well
    }
    var key = cx + ',' + cy, home = this.grid.get(key);
    if (home) home.push(i); else this.grid.set(key, [i]);
    pts.push(p);
    this.dirty = true;
  };

  /* Call on every position change. Adds evenly spaced points so fast movement leaves no gaps. */
  Trail.prototype.record = function (x, y, odoNow, meta) {
    var p = this.pts[this.pts.length - 1];
    if (!p) { this.add(x, y, odoNow, meta); return; }
    var dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if (d < C.SAMPLE) return;
    var n = Math.floor(d / C.SAMPLE);
    for (var k = 1; k <= n; k++) this.add(p.x + dx * (k * C.SAMPLE / d), p.y + dy * (k * C.SAMPLE / d), p.d + k * C.SAMPLE, meta);
  };

  /* The trail cut into lines by pass count: [once, twice, 3 times, 4 or more], each a list of lat/lon lines. */
  Trail.prototype.linesByPasses = function () {
    var pts = this.pts, runs = [[], [], [], []], cur = -1, line = null;
    for (var i = 1; i < pts.length; i++) {
      var b = Math.min(pts[i].n, 4) - 1;
      if (b !== cur) { line = [pts[i - 1].ll]; runs[b].push(line); cur = b; }
      line.push(pts[i].ll);
    }
    return runs;
  };

  /* The way back: the trail in reverse with every loop cut out (jump to the first time this ground was reached). */
  Trail.prototype.wayBack = function () {
    var pts = this.pts, out = [], i = pts.length - 1;
    while (i > 0) { out.push(pts[i]); if (pts[i].first < i) i = pts[i].first; i--; }
    if (pts.length) out.push(pts[0]);
    return out;
  };

  Trail.pathLength = function (a) { var d = 0; for (var i = 1; i < a.length; i++) d += Math.hypot(a[i].x - a[i - 1].x, a[i].y - a[i - 1].y); return d; };

  /* Every separate pass within r metres of a spot, oldest first (the first point of each pass). */
  Trail.prototype.passesNear = function (x, y, r) {
    var pts = this.pts, out = [], lastD = -1e9;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (Math.abs(p.x - x) > r || Math.abs(p.y - y) > r || Math.hypot(p.x - x, p.y - y) > r) continue;
      if (p.d - lastD > C.REVISIT_GAP) out.push(p);
      lastD = p.d;
    }
    return out;
  };

  /* Trail point nearest to a spot, within `reach` metres; prefers the most-walked ground on a near tie. */
  Trail.prototype.nearest = function (x, y, reach) {
    var pts = this.pts, best = null, bd = reach;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.hypot(pts[i].x - x, pts[i].y - y);
      if (d < bd || (d < bd + 0.75 && best && pts[i].n > best.n)) { bd = Math.min(bd, d); best = pts[i]; }
    }
    return best;
  };

  /* A saved-trail record: plain data that store.js keeps and that can be shared as a .json file. */
  Trail.prototype.toRecord = function (name, source, walker) {
    var pts = this.pts, last = pts[pts.length - 1] || { d: 0, t: 0 };
    return {
      format: 'marswalk-trail', version: 1,
      id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name: name, savedAt: new Date().toISOString(), source: source,
      walker: walker ? { name: walker.name, type: walker.type } : null,      // who made it: astronaut or robot
      site: G.SITE ? G.SITE.name : 'Mount Sharp boxwork, Gale crater, Mars',
      base: { lat: G.ORIGIN.lat, lon: G.ORIGIN.lon },
      distance_m: Math.round(last.d * 10) / 10, duration_s: Math.round(last.t - (pts[0] ? pts[0].t : 0)),
      fields: ['lat', 'lon', 'seconds', 'heading_deg'],
      points: pts.map(function (p) { return [+p.ll[0].toFixed(7), +p.ll[1].toFixed(7), Math.round(p.t), p.hdg]; })
    };
  };

  MW.Trail = Trail;
})();
