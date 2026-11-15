/* sw.js — the service worker that keeps Marswalk working without a connection. Registered by offline.js.
 *
 *   The app itself       every file index.html names is stored when the worker installs. Pages and scripts are
 *                        then fetched from the network first, so a change shows at once, and from the store
 *                        when the network is not there.
 *   NASA map tiles       stored as they are viewed, and served from the store first (a tile never changes).
 *                        "Save the walk area" in the Map Overlay tab fills the store ahead of time.
 *   Fonts                served from the store, refreshed in the background.
 *
 * Service workers need a web address (http://localhost, or https). A file opened by double-click cannot use one.
 */
'use strict';
var SHELL = 'marswalk-shell-v2', TILES = 'marswalk-tiles-v1', FONTS = 'marswalk-fonts-v1', PHOTOS = 'marswalk-photos-v1', MAX_TILES = 20000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (cache) {
    return fetch('index.html', { cache: 'reload' }).then(function (r) { return r.text(); }).then(function (html) {
      var files = ['./', 'index.html', 'marswalk.html', 'sw.js'], re = /(?:src|href|data-lazy-src)="([^"#:]+\.(?:js|css|html|jpg|png|webp))"/g, m;
      while ((m = re.exec(html))) if (files.indexOf(m[1]) < 0) files.push(m[1]);
      return Promise.all(files.map(function (f) { return cache.add(new Request(f, { cache: 'reload' })).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return /^marswalk-shell-/.test(k) && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(cache) {                                 // keep the tile store from growing without end: drop the oldest
  return cache.keys().then(function (keys) {
    if (keys.length <= MAX_TILES) return;
    return Promise.all(keys.slice(0, keys.length - MAX_TILES + 500).map(function (k) { return cache.delete(k); }));
  });
}
var puts = 0;
function tileFirst(req) {
  return caches.open(TILES).then(function (cache) {
    return cache.match(req.url).then(function (hit) {
      if (hit && !(req.mode === 'cors' && hit.type === 'opaque')) return hit;   // a tile kept without CORS cannot serve a page that reads its pixels
      return fetch(req).then(function (res) {
        if (res.ok || res.type === 'opaque') { cache.put(req.url, res.clone()); if (++puts % 200 === 0) trim(cache); }
        return res;
      });
    });
  });
}
function networkFirst(req) {
  return caches.open(SHELL).then(function (cache) {
    return fetch(req).then(function (res) {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(function () {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined) || Response.error();
      });
    });
  });
}
function staleWhileRevalidate(req) {
  return caches.open(FONTS).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  });
}
function keep(req, store, first) {                     // first: from the store when there; otherwise the network first
  return caches.open(store).then(function (cache) {
    var net = function () { return fetch(req).then(function (res) { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }); };
    if (first) return cache.match(req).then(function (hit) { return hit || net(); });
    return net().catch(function () { return cache.match(req).then(function (hit) { return hit || Response.error(); }); });
  });
}
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.hostname === 'trek.nasa.gov' && u.pathname.indexOf('/tiles/') === 0) e.respondWith(tileFirst(req));
  else if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') e.respondWith(staleWhileRevalidate(req));
  else if (u.hostname === 'mars.nasa.gov' && u.pathname.indexOf('/msl-raw-images/') === 0) e.respondWith(keep(req, PHOTOS, true));    // a rover photo never changes
  else if (u.hostname === 'mars.nasa.gov' && u.pathname.indexOf('/api/v1/raw_image_items') === 0) e.respondWith(keep(req, PHOTOS, false));   // the list: fresh when online
  else if (u.origin === self.location.origin) e.respondWith(networkFirst(req));
});
