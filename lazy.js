/* lazy.js — MW.lazy: large data files that load after the page has started, instead of with it.
 *
 * In index.html the dust packs are written as
 *   <script type="text/plain" data-lazy="dust" data-lazy-src="dust-data.js"></script>
 * The browser does not fetch those. This file fetches them, in order, as soon as something needs them
 * (MW.lazy.need('dust'): dust.js asks when it loads) but only once the map's first view has had a head start,
 * so on a slow link the photo map arrives first and the 7 MB of dust data second.
 *
 * build.py turns the same tags into ordinary scripts in marswalk.html, so there everything is already present and
 * need() resolves at once.
 *
 *   MW.lazy.has(group)     true if index.html defers that group
 *   MW.lazy.need(group)    a Promise, resolved when every file of the group has run
 */
(function () {
  'use strict';
  var MW = window.MW = window.MW || {};
  var started = {}, HEAD_START = 1200, LATEST = 4000;  // ms the map gets to itself after the page has loaded; and the most it waits
  function groups() {                                  // read when asked: the tags come after this file in the page
    var out = {};
    Array.prototype.forEach.call(document.querySelectorAll('script[data-lazy][data-lazy-src]'), function (el) {
      var g = el.getAttribute('data-lazy'); (out[g] = out[g] || []).push(el.getAttribute('data-lazy-src'));
    });
    return out;
  }
  var t0 = Date.now();
  var pageLoaded = new Promise(function (res) {        // the page's load event and a head start, or LATEST at the outside
    var go = function () { setTimeout(res, Math.max(0, Math.min(HEAD_START, LATEST - (Date.now() - t0)))); };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    setTimeout(res, LATEST);
  });
  function script(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src + '.')); };
      document.body.appendChild(s);
    });
  }
  MW.lazy = {
    has: function (g) { return !!groups()[g]; },
    need: function (g) {
      var files = groups()[g];
      if (!files) return Promise.resolve();
      if (!started[g]) started[g] = pageLoaded.then(function () {
        return files.reduce(function (p, src) { return p.then(function () { return script(src); }); }, Promise.resolve());
      });
      return started[g];
    }
  };
})();
