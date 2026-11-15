/* store.js — MW.store, where recorded trails are kept.
 *
 * Trails live in the browser's localStorage under one key, as a list of records made by
 * Trail.toRecord(). If the browser refuses storage (private mode, some embedded viewers) the
 * list is kept in memory for this visit and MW.store.persistent is false, so the page can say so.
 * A record is plain JSON, so "Download" and "Import" simply write and read that JSON as a file.
 *
 * To keep trails somewhere else (a habitat server, a suit computer), replace read() and write().
 *
 * One trail can be starred as the preferred trail (its id is kept under its own key; 'curiosity' is the
 * reference route). The route-finder checks a route along it first: see router.js.
 * MW.store.onChange(fn) is called after a trail is saved or removed or the star moves.
 */
(function () {
  'use strict';
  var KEY = 'marswalk.trails.v1', PREF_KEY = 'marswalk.preferred-trail.v1', memory = [], memPref = null, persistent = true, listeners = [];
  function tell(what) { listeners.forEach(function (fn) { fn(what); }); }

  function read() {
    try { var t = window.localStorage.getItem(KEY); return t ? JSON.parse(t) : []; }
    catch (e) { persistent = false; return memory; }
  }
  function write(list) {
    memory = list;
    try { window.localStorage.setItem(KEY, JSON.stringify(list)); persistent = true; }
    catch (e) { persistent = false; }
  }
  /* Accept only something shaped like a trail record; returns null otherwise. */
  function validate(r) {
    if (!r || r.format !== 'marswalk-trail' || !Array.isArray(r.points) || r.points.length < 2) return null;
    var ok = r.points.every(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 360; });
    if (!ok) return null;
    r.name = String(r.name || 'Imported trail').slice(0, 60);
    return r;
  }

  MW.store = {
    get persistent() { return persistent; },
    list: function () { return read(); },
    get: function (id) { return read().filter(function (r) { return r.id === id; })[0] || null; },
    save: function (rec) { var l = read().filter(function (r) { return r.id !== rec.id; }); l.push(rec); write(l); tell('trails'); return rec; },
    remove: function (id) { var starred = this.preferred() === id; write(read().filter(function (r) { return r.id !== id; })); if (starred) this.setPreferred(null); tell('trails'); },
    /* The starred trail's id, 'curiosity', or null. A star on a trail that no longer exists counts as none. */
    preferred: function () {
      var id = memPref;
      try { id = window.localStorage.getItem(PREF_KEY) || null; } catch (e) {}
      return id === 'curiosity' || (id && read().some(function (r) { return r.id === id; })) ? id : null;
    },
    setPreferred: function (id) {
      memPref = id || null;
      try { if (id) window.localStorage.setItem(PREF_KEY, id); else window.localStorage.removeItem(PREF_KEY); } catch (e) {}
      tell('preferred');
    },
    onChange: function (fn) { listeners.push(fn); },
    toText: function (rec) { return JSON.stringify(rec); },
    fromText: function (text) {
      var r; try { r = JSON.parse(text); } catch (e) { return null; }
      r = validate(r); if (!r) return null;
      r.id = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);   // never overwrite an existing trail
      return r;
    }
  };
  read();
})();
