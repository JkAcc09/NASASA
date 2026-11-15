/* budget.js — MW.budget: oxygen, battery and the turn-back point for one walk. Pure logic: no map, no page.
 * It also runs under Node (see features_test.js).
 *
 * Everything here is MODELLED, from the planning assumptions in BUDGET in config.js. It is not a suit or rover
 * specification and it is never a measurement. The page labels it so.
 *
 *   MW.budget.fresh()                          a full budget at the start of a walk: { o2Used, whUsed }
 *   MW.budget.step(state, q)                   use up what q costs; q = { kind, dt, moved, climbed, air, sun }
 *                                                 dt seconds, moved metres, climbed metres (up only), air °C or null,
 *                                                 sun W/m² reaching the panels (robot only)
 *   MW.budget.read(state, q)                   what is left and when to turn back; q = { kind, back, air, sun, pace }
 *                                                 back metres to the nearest base, pace m/s the walker covers ground at
 *   MW.budget.sunlight(lat, hour, ls, tau9)    W/m² on a flat panel: latitude, local solar hour, season, dust
 *   MW.budget.forRoute(kind, m, air)           oxygen and battery left at the end of a planned route (router.js metrics)
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var C = MW.config, B = C.BUDGET, DEG = Math.PI / 180, G_MARS = 3.711;

  function fresh() { return { o2Used: 0, whUsed: 0 }; }
  function air(a) { return a === null || a === undefined || a !== a ? B.astronaut.airUnknown : a; }

  /* Watts of metabolism for an astronaut walking at v m/s and climbing at up m/s. */
  function metabolic(v, up) {
    var A = B.astronaut;
    return A.metRest + A.metPerMs * Math.max(0, v) + Math.max(0, up) * A.mass * G_MARS / A.climbEff;
  }
  /* Watts drawn from the battery. */
  function draw(kind, moving, airC, sun) {
    if (kind === 'robot') {
      var R = B.robot;
      return (moving ? R.driveW : R.idleW) - R.panelM2 * R.panelEff * Math.max(0, sun || 0);
    }
    var A = B.astronaut;
    return A.drawW + A.heatPerC * Math.max(0, A.heatFrom - air(airC));
  }

  function step(s, q) {
    var dt = Math.max(0, q.dt || 0); if (!dt) return s;
    var v = (q.moved || 0) / dt, up = Math.max(0, q.climbed || 0) / dt;
    if (q.kind !== 'robot') s.o2Used += metabolic(v, up) * B.astronaut.o2PerJ * dt;
    s.whUsed += draw(q.kind, v > 0.05, q.air, q.sun) * dt / 3600;
    var cap = q.kind === 'robot' ? B.robot.battWh : B.astronaut.battWh;
    s.whUsed = Math.max(0, Math.min(cap, s.whUsed));                    // a robot's battery cannot charge past full
    s.o2Used = Math.min(B.astronaut.o2Kg, s.o2Used);
    return s;
  }

  /* What is left, and the turn-back point: how long the walker can keep going outward (at walking cost) before
     what is left, less the reserve, only just covers the way back to base (at walking cost). */
  function read(s, q) {
    var A = B.astronaut, robot = q.kind === 'robot', pace = q.pace || C.WALK;
    var cap = robot ? B.robot.battWh : A.battWh, whLeft = cap - s.whUsed;
    var out = { kind: robot ? 'robot' : 'astronaut', battPct: 100 * whLeft / cap, label: 'MODELLED' };
    var backS = (q.back || 0) * C.ROUTER.RETURN_DETOUR / pace;
    var wWalk = draw(q.kind, true, q.air, q.sun), wNow = draw(q.kind, !!q.moving, q.air, q.sun);
    if (robot) {
      out.o2Pct = null;
      /* A robot need not come back (as in the route-finder). It is told how long its battery lasts at this rate. */
      out.chargingW = wNow < 0 ? -wNow : 0;
      out.battHours = wNow > 0 ? (whLeft - B.RESERVE * cap) / wNow : Infinity;
      out.turnS = null;
      return out;
    }
    var o2Left = A.o2Kg - s.o2Used, o2Walk = metabolic(pace, 0) * A.o2PerJ;            // kg/s while walking
    out.o2Pct = 100 * o2Left / A.o2Kg;
    out.o2Hours = o2Left / (metabolic(q.moving ? pace : 0, 0) * A.o2PerJ) / 3600;
    out.battHours = whLeft / Math.max(1, wNow);
    var spareO2 = o2Left - B.RESERVE * A.o2Kg - o2Walk * backS;                         // what is left after the reserve and the way back
    var spareWh = whLeft - B.RESERVE * cap - wWalk * backS / 3600;
    var tO2 = spareO2 / o2Walk, tWh = spareWh / (wWalk / 3600);
    out.turnS = Math.min(tO2, tWh);                                                    // negative: past the turn-back point
    out.limit = tO2 <= tWh ? 'oxygen' : 'battery';
    out.backS = backS;
    return out;
  }

  /* Sunlight on a flat panel, W/m². The Sun's height comes from latitude, season and hour; the dust column then
     dims the direct beam by exp(-tau / cos z), with tau the visible-light optical depth. Scattered light is left
     out, so this is a low estimate in heavy dust. */
  function sunlight(lat, hour, ls, tau9) {
    var dec = Math.asin(Math.sin(25.19 * DEG) * Math.sin((ls || 0) * DEG));
    var h = ((hour % 24) - 12) * 15 * DEG, phi = lat * DEG;
    var cosz = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
    if (cosz <= 0.02) return 0;
    var tau = Math.max(0, tau9 || 0) * B.robot.visPerIr;
    return B.robot.solarConst * cosz * Math.exp(-tau / cosz);
  }

  /* A planned route (router.js metrics): what would be left at the end, walking out and back. */
  function forRoute(kind, m, airC) {
    var s = fresh(), go = m.moveTime || 0, back = m.returnTime || 0, dist = m.distance || 0;
    if (go > 0) step(s, { kind: kind, dt: go, moved: dist, climbed: m.climb || 0, air: airC, sun: 0 });
    if (back > 0) step(s, { kind: kind, dt: back, moved: back * C.WALK, climbed: 0, air: airC, sun: 0 });
    var r = read(s, { kind: kind, back: 0, air: airC });
    return { o2Pct: r.o2Pct, battPct: r.battPct, short: r.o2Pct !== null && (r.o2Pct < 100 * B.RESERVE || r.battPct < 100 * B.RESERVE) };
  }

  MW.budget = { fresh: fresh, step: step, read: read, sunlight: sunlight, forRoute: forRoute, metabolic: metabolic };
})();
