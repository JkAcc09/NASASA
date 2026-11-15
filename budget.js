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
 *   MW.budget.setModel(m) / model()            a user's own oxygen model (Settings > Walk budget model), or null for the
 *                                              defaults in BUDGET. The defaults themselves are never changed.
 *   MW.budget.validate(m)                      { ok, errors: { field: text }, model }: checks a model before it is used
 *   MW.budget.FIELDS                           every field a user can set, with its unit, range and default
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var MW = root.MW = root.MW || {};
  var C = MW.config, B = C.BUDGET, DEG = Math.PI / 180, G_MARS = 3.711, O2_G_PER_L = 1.429;

  /* ---------------------------------------------------------------- a user's own oxygen model */
  /* model 'metabolic': oxygen follows the work done (the default way, with the user's numbers);
     model 'fixed': oxygen is used at a set rate while walking and another while standing (a suit's quoted figures). */
  var FIELDS = [
    { key: 'o2Kg',      label: 'Oxygen carried',               unit: 'kg',      min: 0.05, max: 5,    step: 0.01, def: function () { return B.astronaut.o2Kg; } },
    { key: 'reserve',   label: 'Reserve kept back',            unit: '%',       min: 0,    max: 50,   step: 1,    def: function () { return B.RESERVE * 100; } },
    { key: 'metRest',   label: 'Metabolism standing',          unit: 'W',       min: 50,   max: 600,  step: 5,    def: function () { return B.astronaut.metRest; }, model: 'metabolic' },
    { key: 'metPerMs',  label: 'Extra metabolism per m/s walked', unit: 'W per m/s', min: 0, max: 800, step: 5,    def: function () { return B.astronaut.metPerMs; }, model: 'metabolic' },
    { key: 'mass',      label: 'Person and suit',              unit: 'kg',      min: 40,   max: 400,  step: 1,    def: function () { return B.astronaut.mass; }, model: 'metabolic' },
    { key: 'climbEff',  label: 'Muscle efficiency climbing',   unit: '%',       min: 5,    max: 50,   step: 1,    def: function () { return B.astronaut.climbEff * 100; }, model: 'metabolic' },
    { key: 'kJPerL',    label: 'Energy per litre of oxygen',   unit: 'kJ/L',    min: 15,   max: 25,   step: 0.1,  def: function () { return Math.round(O2_G_PER_L / 1000 / B.astronaut.o2PerJ / 1000 * 10) / 10; }, model: 'metabolic' },
    { key: 'walkKgH',   label: 'Oxygen used walking',          unit: 'kg/h',    min: 0.005, max: 1,   step: 0.001, def: function () { return Math.round((B.astronaut.metRest + B.astronaut.metPerMs * C.WALK) * B.astronaut.o2PerJ * 3600 * 1000) / 1000; }, model: 'fixed' },
    { key: 'restKgH',   label: 'Oxygen used standing',         unit: 'kg/h',    min: 0.005, max: 1,   step: 0.001, def: function () { return Math.round(B.astronaut.metRest * B.astronaut.o2PerJ * 3600 * 1000) / 1000; }, model: 'fixed' }
  ];
  var custom = null;                                   // the user's model, already validated, or null
  function validate(m) {
    var errors = {}, out = { model: m && m.model === 'fixed' ? 'fixed' : 'metabolic', name: String((m && m.name) || 'My oxygen model').slice(0, 40) };
    FIELDS.forEach(function (f) {
      if (f.model && f.model !== out.model) return;
      var raw = m ? m[f.key] : undefined, v = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw.replace(',', '.'))) : Number(raw);
      if (raw === undefined || raw === null || raw === '') { out[f.key] = f.def(); return; }      // left blank: the default
      if (!isFinite(v)) errors[f.key] = 'Enter a number, in ' + f.unit + '.';
      else if (v < f.min || v > f.max) errors[f.key] = 'Between ' + f.min + ' and ' + f.max + ' ' + f.unit + '.';
      else out[f.key] = v;
    });
    if (out.model === 'fixed' && !errors.walkKgH && !errors.restKgH && out.restKgH > out.walkKgH) errors.restKgH = 'Standing should not use more oxygen than walking.';
    return { ok: !Object.keys(errors).length, errors: errors, model: out };
  }
  function setModel(m) { if (!m) { custom = null; return { ok: true }; } var v = validate(m); custom = v.ok ? v.model : null; return v; }
  function A() {                                       // the astronaut's numbers in use: the defaults, with the user's on top
    if (!custom) return B.astronaut;
    var a = Object.assign({}, B.astronaut, { o2Kg: custom.o2Kg });
    if (custom.model === 'metabolic') Object.assign(a, { metRest: custom.metRest, metPerMs: custom.metPerMs, mass: custom.mass, climbEff: custom.climbEff / 100, o2PerJ: O2_G_PER_L / 1000 / (custom.kJPerL * 1000) });
    return a;
  }
  function reserve() { return custom ? custom.reserve / 100 : B.RESERVE; }

  function fresh() { return { o2Used: 0, whUsed: 0 }; }
  function air(a) { return a === null || a === undefined || a !== a ? B.astronaut.airUnknown : a; }

  /* Watts of metabolism for an astronaut walking at v m/s and climbing at up m/s. */
  function metabolic(v, up) {
    var a = A();
    return a.metRest + a.metPerMs * Math.max(0, v) + Math.max(0, up) * a.mass * G_MARS / a.climbEff;
  }
  /* Oxygen used, kg per second. */
  function o2Rate(v, up) {
    if (custom && custom.model === 'fixed') return (v > 0.05 ? custom.walkKgH : custom.restKgH) / 3600;
    return metabolic(v, up) * A().o2PerJ;
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
    if (q.kind !== 'robot') s.o2Used += o2Rate(v, up) * dt;
    s.whUsed += draw(q.kind, v > 0.05, q.air, q.sun) * dt / 3600;
    var cap = q.kind === 'robot' ? B.robot.battWh : B.astronaut.battWh;
    s.whUsed = Math.max(0, Math.min(cap, s.whUsed));                    // a robot's battery cannot charge past full
    s.o2Used = Math.min(A().o2Kg, s.o2Used);
    return s;
  }

  /* What is left, and the turn-back point: how long the walker can keep going outward (at walking cost) before
     what is left, less the reserve, only just covers the way back to base (at walking cost). */
  function read(s, q) {
    var a = A(), R = reserve(), robot = q.kind === 'robot', pace = q.pace || C.WALK;
    var cap = robot ? B.robot.battWh : a.battWh, whLeft = cap - s.whUsed;
    var out = { kind: robot ? 'robot' : 'astronaut', battPct: 100 * whLeft / cap, label: 'MODELLED', custom: !!custom && !robot, reserve: R };
    var backS = (q.back || 0) * C.ROUTER.RETURN_DETOUR / pace;
    var wWalk = draw(q.kind, true, q.air, q.sun), wNow = draw(q.kind, !!q.moving, q.air, q.sun);
    if (robot) {
      out.o2Pct = null;
      /* A robot need not come back (as in the route-finder). It is told how long its battery lasts at this rate. */
      out.chargingW = wNow < 0 ? -wNow : 0;
      out.battHours = wNow > 0 ? (whLeft - R * cap) / wNow : Infinity;
      out.turnS = null;
      return out;
    }
    var o2Left = a.o2Kg - s.o2Used, o2Walk = o2Rate(pace, 0);                          // kg/s while walking
    out.o2Pct = 100 * o2Left / a.o2Kg;
    out.o2Hours = o2Left / o2Rate(q.moving ? pace : 0, 0) / 3600;
    out.battHours = whLeft / Math.max(1, wNow);
    var spareO2 = o2Left - R * a.o2Kg - o2Walk * backS;                                // what is left after the reserve and the way back
    var spareWh = whLeft - R * cap - wWalk * backS / 3600;
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
    return { o2Pct: r.o2Pct, battPct: r.battPct, custom: r.custom, short: r.o2Pct !== null && (r.o2Pct < 100 * reserve() || r.battPct < 100 * reserve()) };
  }

  MW.budget = { fresh: fresh, step: step, read: read, sunlight: sunlight, forRoute: forRoute, metabolic: metabolic, o2Rate: o2Rate,
    setModel: setModel, validate: validate, FIELDS: FIELDS, reserve: reserve,
    model: function () { return custom ? JSON.parse(JSON.stringify(custom)) : null; } };
  if (MW.settings && MW.settings.get) setModel(MW.settings.get('o2Model'));      // a model saved in an earlier visit (o2-model.js)
})();
