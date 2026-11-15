/* terrain.js — MW.terrain: the height of the ground anywhere on Mars, and the regional slope.
 * Pure logic: no map, no page. It also runs under Node (see router_test.js).
 *
 *   MW.terrain.load()                 unpack terrain-data.js; returns a Promise
 *   MW.terrain.ready                  true once heights can be read
 *   MW.terrain.heightAt(lat, lon)     metres above the MOLA reference level, or null before load
 *   MW.terrain.slopeAt(lat, lon)      regional slope in degrees, or null
 *   MW.terrain.resolutionAt(lat, lon) metres between the data points used there
 *
 * The data (terrain-data.js, written by terrain_ingest.py) is the MarsTopo719 shape model of Mars, built from
 * MGS MOLA laser altimetry, measured from the areoid of the GMM-3 gravity model: the whole planet every 0.25
 * degrees, and the Gale exploration zone every 0.0625 degrees.
 *
 * What it is not: the model resolves features about 15 km across. A cliff, a butte, a dune field or a boulder
 * is far smaller and is NOT in this data. slopeAt is the regional slope (the tilt of the land over kilometres),
 * never the steepness of the ground under a boot. The route-finder says so wherever it uses it.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var R = MW.config.R_MARS, DEG = Math.PI / 180, M = R * DEG;
  var T = null;                    // { g: global grid, s: inset grid, step, offset }
  var BLEND = 0.5;                 // degrees over which the inset fades into the global grid at its edge

  function decodeGrid(bytes, def, enc) {
    var n = def.nx * def.ny, lo = bytes.subarray(def.offset, def.offset + n), hi = bytes.subarray(def.offset + n, def.offset + 2 * n);
    if (hi.length !== n) throw new Error('The terrain data pack is damaged.');
    var v = new Uint16Array(n), prev = 0, above = 0;
    for (var j = 0; j < def.ny; j++) {
      for (var i = 0; i < def.nx; i++) {
        var k = j * def.nx + i, z = lo[k] | (hi[k] << 8), d = (z >>> 1) ^ -(z & 1);
        if (i === 0) { prev = above + d; above = prev; } else prev += d;
        v[k] = prev;
      }
    }
    return { v: v, nx: def.nx, ny: def.ny, d: def.d, lat0: def.lat0, lon0: def.lon0, wraps: !!def.wraps,
             south: def.lat0 - (def.ny - 1) * def.d, east: def.lon0 + (def.nx - 1) * def.d, name: def.name || '' };
  }
  function unpack(pack) {
    var bin = typeof atob === 'function' ? atob(pack.data) : Buffer.from(pack.data, 'base64').toString('binary');
    var gz = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('This browser cannot unpack the terrain data (no DecompressionStream). Use a current Chrome, Edge, Firefox or Safari.'));
    return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      T = { g: decodeGrid(bytes, pack.global, pack.encoding), s: pack.inset ? decodeGrid(bytes, pack.inset, pack.encoding) : null,
            step: pack.encoding.step, offset: pack.encoding.offset, pack: pack };
      return api;
    });
  }
  var ready = null;
  function load() {
    if (!ready) ready = root.MARSWALK_TERRAIN ? unpack(root.MARSWALK_TERRAIN)
      : Promise.reject(new Error('The terrain data pack (terrain-data.js) is missing. Build it with: python terrain_ingest.py'));
    return ready;
  }

  /* Bilinear reading of one grid. lon in degrees east, any range. */
  function read(G, lat, lon) {
    var fy = (G.lat0 - lat) / G.d, fx;
    if (G.wraps) fx = ((((lon - G.lon0) % 360) + 360) % 360) / G.d; else fx = (lon - G.lon0) / G.d;
    var y0 = Math.max(0, Math.min(G.ny - 2, Math.floor(fy))), ay = Math.max(0, Math.min(1, fy - y0));
    var x0 = Math.floor(fx), ax = fx - x0, x1;
    if (G.wraps) { x0 = ((x0 % G.nx) + G.nx) % G.nx; x1 = (x0 + 1) % G.nx; }
    else { x0 = Math.max(0, Math.min(G.nx - 2, x0)); ax = Math.max(0, Math.min(1, fx - x0)); x1 = x0 + 1; }
    var v = G.v, a = v[y0 * G.nx + x0], b = v[y0 * G.nx + x1], c = v[(y0 + 1) * G.nx + x0], e = v[(y0 + 1) * G.nx + x1];
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
  }
  /* How far inside the inset a point is, in degrees (negative: outside). */
  function insetDepth(lat, lon) {
    var s = T.s; if (!s) return -1;
    var lo = ((((lon - s.lon0) % 360) + 360) % 360) + s.lon0;
    return Math.min(s.lat0 - lat, lat - s.south, lo - s.lon0, s.east - lo);
  }
  function heightAt(lat, lon) {
    if (!T) return null;
    lat = Math.max(-90, Math.min(90, lat));
    var g = read(T.g, lat, lon), dep = insetDepth(lat, lon);
    if (dep > 0) { var w = Math.min(1, dep / BLEND), lo = ((((lon - T.s.lon0) % 360) + 360) % 360) + T.s.lon0; g = g * (1 - w) + read(T.s, lat, lo) * w; }
    return g * T.step - T.offset;
  }
  function resolutionAt(lat, lon) {
    if (!T) return null;
    return (insetDepth(lat, lon) > BLEND ? T.s.d : T.g.d) * M;
  }
  /* Regional slope: the tilt of the surface measured across one data spacing each way. */
  function slopeAt(lat, lon) {
    if (!T) return null;
    var h = resolutionAt(lat, lon), k = Math.max(0.02, Math.cos(lat * DEG));
    var dLat = h / M, dLon = h / (M * k);
    if (Math.abs(lat) + dLat > 89.9) return 0;
    var gx = (heightAt(lat, lon + dLon) - heightAt(lat, lon - dLon)) / (2 * h), gy = (heightAt(lat + dLat, lon) - heightAt(lat - dLat, lon)) / (2 * h);
    return Math.atan(Math.hypot(gx, gy)) / DEG;
  }

  var api = MW.terrain = {
    load: load, heightAt: heightAt, slopeAt: slopeAt, resolutionAt: resolutionAt,
    get ready() { return !!T; },
    get pack() { return T ? T.pack : null; },
    LABEL: 'MOLA shape model, about 15 km resolution'
  };
})();
