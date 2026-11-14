/* tiles.js — MW.SmoothTiles, the one tile-layer class the map uses.
 *
 * It does three jobs a stock Leaflet tile layer does not:
 *   1. Never over-requests. Past a layer's deepest real zoom (`nativeZoom`) it enlarges the
 *      nearest real tile on a canvas instead of asking the server for tiles that do not exist.
 *   2. Reads numbers out of pictures. `options.read` says how a pixel becomes a value from
 *      0 to 255 (see _scalar). Trek sends CORS headers, which is what lets the page read pixels.
 *   3. Recolours. `options.ramp` repaints that value with one of the ramps in config.js, so
 *      every scalar layer shares the same "low to high" look. With `options.stretch` the ramp
 *      is spread over the range inside the current view, to show local contrast.
 *
 * sample(lat, lon) returns the value under a point; app.js uses it for the readout under the map.
 */
(function () {
  'use strict';
  var C = MW.config;

  function buildLut(stops) {
    var lut = new Uint8Array(768);
    for (var i = 0; i < 256; i++) { var c = MW.geo.rampColour(stops, i / 255); lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2]; }
    return lut;
  }

  MW.SmoothTiles = L.GridLayer.extend({
    initialize: function (id, ext, nativeZoom, opts) {
      this._id = id; this._ext = ext; this._nz = nativeZoom;
      this._imgs = new Map();          // url -> Promise<HTMLImageElement>
      this._px = new Map();            // url -> RGBA bytes of a native tile, for sample()
      L.setOptions(this, L.extend({ noWrap: true, bounds: [[-90, -180], [90, 180]], updateWhenZooming: false, keepBuffer: 1 }, opts));
      if (this.options.ramp) this._lut = buildLut(C.RAMPS[this.options.ramp]);
      this._lo = 0; this._hi = 255;    // grey range mapped onto the ramp
    },
    onAdd: function (map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      if (this.options.stretch) { map.on('moveend', this._restretch, this); this._restretch(); }
    },
    onRemove: function (map) {
      map.off('moveend', this._restretch, this);
      L.GridLayer.prototype.onRemove.call(this, map);
    },

    _url: function (z, x, y) { return C.TREK + this._id + C.TREK_PATH + z + '/' + y + '/' + x + '.' + this._ext; },
    _load: function (url) {
      var cache = this._imgs, p = cache.get(url), cors = !!this.options.read;
      if (!p) {
        p = new Promise(function (res, rej) { var im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.onload = function () { res(im); }; im.onerror = rej; im.src = url; });
        cache.set(url, p);
        if (cache.size > 120) cache.delete(cache.keys().next().value);
      }
      return p;
    },

    /* Pixel -> value 0..255, or -1 where the map has no data. */
    _scalar: function (r, g, b) {
      var mode = this.options.read;
      if (mode === 'grey') return r;
      if (mode === 'rgb') return (r + g + b) / 3;
      /* 'hue': NASA's rainbow runs violet (270°, lowest) through blue, green and yellow to red (0°, highest). */
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (mx < 40 || d / mx < 0.2) return -1;
      var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
      if (h > 270) h = h > 315 ? 0 : 270;
      return (270 - h) / 270 * 255;
    },

    /* The grey range in view: 2nd to 98th percentile, so a few odd pixels cannot flatten the colours. */
    _restretch: function () {
      var map = this._map, self = this; if (!map) return;
      var z = Math.max(0, Math.min(this._nz, Math.round(map.getZoom()))), span = 180 / Math.pow(2, z);
      var c = map.getCenter(), b = map.getBounds(), tx = Math.floor((c.lng + 180) / span), ty = Math.floor((90 - c.lat) / span);
      var px = function (lng) { return ((lng + 180) / span - tx) * 256; }, py = function (lat) { return ((90 - lat) / span - ty) * 256; };
      var x0 = Math.max(0, px(b.getWest())), x1 = Math.min(256, px(b.getEast())), y0 = Math.max(0, py(b.getNorth())), y1 = Math.min(256, py(b.getSouth()));
      var w = Math.max(6, x1 - x0), h = Math.max(6, y1 - y0);          // never judge from fewer than 6 source pixels
      this._load(this._url(z, tx, ty)).then(function (im) {
        var cv = document.createElement('canvas'); cv.width = cv.height = 48;
        var g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, (x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h, 0, 0, 48, 48);
        var d = g.getImageData(0, 0, 48, 48).data, hist = new Uint32Array(256), n = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          var v = self._scalar(d[i], d[i + 1], d[i + 2]); if (v < 0) continue;
          hist[Math.round(v)]++; n++;
        }
        if (n < 20) return;
        var acc = 0, lo = 0, hi = 255, k;
        for (k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * 0.02) { lo = k; break; } }
        for (acc = 0, k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= n * 0.02) { hi = k; break; } }
        if (hi - lo < 10) { var m = (hi + lo) / 2; lo = Math.max(0, m - 5); hi = Math.min(255, m + 5); }
        var tol = Math.max(3, (self._hi - self._lo) * 0.12);           // ignore small changes: no flicker while walking
        if (Math.abs(lo - self._lo) > tol || Math.abs(hi - self._hi) > tol) { self._lo = lo; self._hi = hi; self.redraw(); self.fire('stretch'); }
      }).catch(function () {});
    },

    _recolour: function (g) {
      var id = g.getImageData(0, 0, 256, 256), d = id.data, lut = this._lut, lo = this._lo, k = 255 / (this._hi - lo), grey = this.options.read === 'grey';
      for (var i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        var v = grey ? d[i] : this._scalar(d[i], d[i + 1], d[i + 2]);
        if (v < 0) { d[i + 3] = 0; continue; }
        v = (v - lo) * k; v = v < 0 ? 0 : v > 255 ? 765 : (v | 0) * 3;
        d[i] = lut[v]; d[i + 1] = lut[v + 1]; d[i + 2] = lut[v + 2];
      }
      g.putImageData(id, 0, 0);
    },

    createTile: function (c, done) {
      var nz = this._nz, self = this;
      if (c.z <= nz && !this._lut) {                                   // a real tile, shown as it is
        var im = document.createElement('img');
        im.alt = ''; im.setAttribute('role', 'presentation');
        im.onload = function () { done(null, im); };
        im.onerror = function () { done(new Error('tile'), im); };
        im.src = this._url(c.z, c.x, c.y);
        return im;
      }
      var cv = document.createElement('canvas'); cv.width = cv.height = 256;
      var z = Math.min(c.z, nz), n = Math.pow(2, c.z - z), ax = Math.floor(c.x / n), ay = Math.floor(c.y / n), url = this._url(z, ax, ay);
      this._load(url).then(function (im) {
        var g = cv.getContext('2d', { willReadFrequently: !!self._lut });
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(im, -(c.x - ax * n) * 256, -(c.y - ay * n) * 256, 256 * n, 256 * n);   // the ancestor tile, enlarged n times
        if (self._lut) self._recolour(g);
        done(null, cv);
      }).catch(function () { self._imgs.delete(url); done(new Error('tile'), cv); });
      return cv;
    },

    /* Value under a point, from the deepest real tile.
     * Returns null while that tile is still loading, { nodata: true } where the map is empty, otherwise
     *   { value: 0..1 on the layer's full scale,
     *     view:  0..1 within the range in view (only for stretched layers),
     *     rgb:   [r, g, b] each 0..1 } */
    sample: function (lat, lon) {
      if (!this.options.read) return null;
      var z = this._nz, span = 180 / Math.pow(2, z), fx = (lon + 180) / span, fy = (90 - lat) / span;
      var tx = Math.floor(fx), ty = Math.floor(fy), url = this._url(z, tx, ty), px = this._px.get(url), self = this;
      if (px === undefined) {
        this._px.set(url, null);
        if (this._px.size > 6) this._px.delete(this._px.keys().next().value);
        this._load(url).then(function (im) {
          var cv = document.createElement('canvas'); cv.width = cv.height = 256;
          var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
          self._px.set(url, g.getImageData(0, 0, 256, 256).data);
        }).catch(function () { self._px.set(url, false); });
        return null;
      }
      if (px === null) return null;
      if (px === false) return { nodata: true };
      var x = Math.max(0, Math.min(255, (fx - tx) * 256 - 0.5)), y = Math.max(0, Math.min(255, (fy - ty) * 256 - 0.5));
      var x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = x - x0, ay = y - y0;
      var at = function (xx, yy, ch) { return px[(yy * 256 + xx) * 4 + ch]; };
      var mix = function (ch) { return (at(x0, y0, ch) * (1 - ax) + at(x1, y0, ch) * ax) * (1 - ay) + (at(x0, y1, ch) * (1 - ax) + at(x1, y1, ch) * ax) * ay; };
      if (mix(3) < 128) return { nodata: true };
      var r = mix(0), g = mix(1), b = mix(2), v = this._scalar(r, g, b);
      if (v < 0) return { nodata: true };
      var out = { value: v / 255, rgb: [r / 255, g / 255, b / 255] };
      if (this.options.stretch) out.view = Math.max(0, Math.min(1, (v - this._lo) / (this._hi - this._lo)));
      return out;
    }
  });
})();
