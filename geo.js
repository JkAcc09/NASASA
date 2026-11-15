/* geo.js — unpacks the NASA data in data.js and holds the coordinate and text helpers.
 *
 * Coordinates used everywhere else:
 *   lat, lon   planetocentric degrees, east positive (what the NASA tiles use)
 *   x, y       metres east and north of base, on a sphere of radius R_MARS
 *   z          metres relative to the MOLA geoid
 *   heading    degrees clockwise from north, 0–360
 */
(function () {
  'use strict';
  var C = MW.config, D = window.MARSWALK_DATA, DEG = Math.PI / 180, M_PER_DEG = C.R_MARS * DEG;

  /* ---- unpack the reference route: Curiosity's end-of-drive positions ---- */
  var WP = [];
  (function () {
    var lo = 0, la = 0, el = 0, so = 0;
    D.traverse.split(';').forEach(function (r) {
      var v = r.split(',').map(Number);
      lo += v[0]; la += v[1]; el += v[2]; so += v[3];
      WP.push({ lon: lo / 1e6, lat: la / 1e6, z: el / 10, sol: so, yaw: v[4] });
    });
    var last = null;                                  // REMS weather; stops after the feed ends reuse the last sol
    D.rems.split(';').forEach(function (r, i) {
      if (r) { var v = r.split(',').map(Number); last = { tmin: v[0], tmax: v[1], p: v[2], gmin: v[3], gmax: v[4], uv: v[5] }; }
      WP[i].wx = last; WP[i].wxMeasured = !!r;
    });
    D.pov.split(';').forEach(function (p) { var a = p.split(':'); WP[+a[0]].pov = a[1]; });
  })();

  /* The site: where local x and y are measured from. At first it is Gale, with base at the first route stop.
     Moving the walker far away (places-ui.js) starts a new site with its own base, because a flat x/y grid is
     only accurate within some tens of kilometres of its centre. setOrigin moves it; every x and y must then be
     worked out again (app.js does that for the walker and the trail; the route stops are redone here). */
  var ORIGIN = WP[0], COS0 = Math.cos(ORIGIN.lat * DEG);
  var GALE = { name: 'Mount Sharp boxwork, Gale crater, Mars', lat: WP[0].lat, lon: WP[0].lon, z: WP[0].z, gale: true };
  function toENU(lat, lon) { return { x: (((lon - ORIGIN.lon) + 540) % 360 - 180) * M_PER_DEG * COS0, y: (lat - ORIGIN.lat) * M_PER_DEG }; }
  function toLL(x, y) { var lon = ORIGIN.lon + x / (M_PER_DEG * COS0); return [ORIGIN.lat + y / M_PER_DEG, ((lon + 540) % 360) - 180]; }
  function placeStops() { WP.forEach(function (w) { var e = toENU(w.lat, w.lon); w.x = e.x; w.y = e.y; }); }

  var routeLen = 0;
  placeStops();
  WP.forEach(function (w, i) {
    if (i) routeLen += Math.hypot(w.x - WP[i - 1].x, w.y - WP[i - 1].y);
    w.s = routeLen;                                   // metres along the route
  });
  /* Slope along the drive, from Curiosity's own position fixes: the rise over the 60 m of route centred on each stop,
     in degrees, positive uphill in the direction of travel. Fixes are about 25 m apart, so this is a local slope,
     far finer than the regional slope of the terrain model. */
  var SLOPE_SPAN = 30;
  WP.forEach(function (w, i) {
    var a = i, b = i;
    while (a > 0 && w.s - WP[a].s < SLOPE_SPAN) a--;
    while (b < WP.length - 1 && WP[b].s - w.s < SLOPE_SPAN) b++;
    var run = WP[b].s - WP[a].s;
    w.grade = run > 1 ? Math.atan2(WP[b].z - WP[a].z, run) / DEG : 0;
  });
  function setOrigin(site) {                          // site: { name, lat, lon, z?, gale? }; GALE puts it back
    ORIGIN = site.gale ? WP[0] : { lat: site.lat, lon: site.lon, z: site.z || 0, yaw: 0 };
    COS0 = Math.cos(ORIGIN.lat * DEG);
    placeStops();
    MW.geo.ORIGIN = ORIGIN; MW.geo.SITE = site.gale ? GALE : site;
  }
  /* Distance in metres between two points on the sphere: used where points may be far apart. */
  function haversine(a, b) {
    var p1 = a.lat * DEG, p2 = b.lat * DEG, dp = p2 - p1, dl = (b.lon - a.lon) * DEG;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * C.R_MARS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* ---- text helpers ---- */
  function fmt(n, d) { return n.toLocaleString('en-GB', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function minus(n, d) { return (n < 0 ? '−' : '') + fmt(Math.abs(n), d); }
  function signed(n) { return (n < 0 ? '−' : '+') + fmt(Math.abs(n)); }
  function norm(a) { return ((a % 360) + 360) % 360; }
  function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }          // shortest turn from a to b
  function bearing(dx, dy) { return norm(Math.atan2(dx, dy) / DEG); }
  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function compass(h) { return COMPASS[Math.round(norm(h) / 45) % 8]; }
  function clock(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---- colour ramps ---- */
  function rampColour(stops, t) {
    var n = stops.length - 1; t = Math.max(0, Math.min(1, t)) * n;
    var k = Math.min(n - 1, Math.floor(t)), f = t - k;
    return [0, 1, 2].map(function (c) { return Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f); });
  }
  function rampCss(stops) { return 'linear-gradient(90deg,' + stops.map(function (c) { return 'rgb(' + c.join(',') + ')'; }).join(',') + ')'; }

  MW.geo = {
    DEG: DEG, M_PER_DEG: M_PER_DEG, WP: WP, ORIGIN: ORIGIN, routeLen: routeLen,
    GALE: GALE, SITE: GALE, setOrigin: setOrigin, haversine: haversine,     // the site, and moving it (see setOrigin)
    toENU: toENU, toLL: toLL,
    metresPerPixel: function (zoom) { return 180 / (256 * Math.pow(2, zoom)) * M_PER_DEG; },
    fmt: fmt, minus: minus, signed: signed, norm: norm, angDiff: angDiff, bearing: bearing, compass: compass, clock: clock,
    escapeHtml: escapeHtml, rampColour: rampColour, rampCss: rampCss,
    $: function (id) { return document.getElementById(id); }
  };
})();
