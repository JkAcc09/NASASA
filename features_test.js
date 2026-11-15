/* features_test.js — checks the walk budget, places, sites, slope along the drive and the season planner.
 * Run:  node features_test.js            (Node 18 or later; no packages needed)
 * Uses the real data packs (data.js, dust-data.js, dust-baselines.js) where a check needs them.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
const mem = {}; globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
function load(f) { const p = [path.join(__dirname, f), path.join(__dirname, 'js', f), path.join(__dirname, '..', 'js', f)].find(fs.existsSync); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f }); }
['config.js', 'data.js', 'geo.js', 'landmarks.js', 'budget.js', 'places.js', 'dust-data.js', 'dust-baselines.js', 'dust.js', 'season.js'].forEach(load);
const C = MW.config, G = MW.geo, B = MW.budget, P = MW.places;
let failed = 0, passed = 0;
function ok(cond, what, detail) {
  if (cond) passed++; else failed++;
  console.log((cond ? '  ok    ' : '  FAIL  ') + what + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Slope along the drive');
const grades = G.WP.map(w => w.grade);
ok(grades.every(Number.isFinite), 'every stop has a slope', grades.length + ' stops');
const steep = Math.max(...grades.map(Math.abs));
ok(steep > 2 && steep < 35, 'the steepest stretch is plausible for a rover drive', steep.toFixed(1) + '°');
const rise = G.WP[G.WP.length - 1].z - G.WP[0].z, mean = Math.atan2(rise, G.routeLen) * 180 / Math.PI;
ok(mean > 0 && grades.reduce((s, g) => s + g, 0) / grades.length > 0, 'the drive climbs on average, as the heights say', 'mean ' + mean.toFixed(2) + '°');

console.log('Sites');
const o = { x: G.WP[10].x, y: G.WP[10].y }, ll0 = G.toLL(o.x, o.y);
ok(near(ll0[0], G.WP[10].lat, 1e-9) && near(ll0[1], G.WP[10].lon, 1e-9), 'x/y and lat/lon round-trip at Gale');
G.setOrigin({ name: 'Jezero crater', lat: 18.38, lon: 77.58 });
ok(G.SITE.name === 'Jezero crater' && G.ORIGIN.lat === 18.38, 'setOrigin moves the base');
const e = G.toENU(18.38 + 0.01, 77.58 + 0.01);
ok(near(e.y, 0.01 * G.M_PER_DEG, 1) && near(e.x, 0.01 * G.M_PER_DEG * Math.cos(18.38 * Math.PI / 180), 1), 'metres are counted from the new base', Math.round(e.x) + ' m E, ' + Math.round(e.y) + ' m N');
ok(Math.hypot(G.WP[0].x, G.WP[0].y) > 3e6, "Curiosity's stops are re-placed, thousands of km away", Math.round(Math.hypot(G.WP[0].x, G.WP[0].y) / 1000) + ' km');
const d1 = Math.hypot(G.toENU(18.4, 77.6).x, G.toENU(18.4, 77.6).y), d2 = G.haversine({ lat: 18.38, lon: 77.58 }, { lat: 18.4, lon: 77.6 });
ok(Math.abs(d1 - d2) / d2 < 0.001, 'within the local zone, flat metres match the true distance to 0.1 %', Math.round(d1) + ' vs ' + Math.round(d2) + ' m');
const ew = G.toENU(18.38, -179.9 + 360 - 360), wrapOk = G.toENU(18.38, 77.58 - 359.99);
ok(Math.abs(wrapOk.x) < 1000, 'longitudes wrap at the date line', Math.round(wrapOk.x) + ' m');
G.setOrigin(G.GALE);
ok(G.SITE.gale && G.ORIGIN === G.WP[0] && near(G.WP[0].x, 0, 1e-6), 'GALE puts the base back on the first stop');

console.log('Places');
const nasa = P.nasa(), groups = {};
nasa.forEach(p => { groups[p.group] = (groups[p.group] || 0) + 1; });
ok(nasa.length === MW.landmarks.list.length, 'every NASA place is offered', nasa.length);
ok(groups['Gale crater'] > 5 && groups['Landing sites'] >= 5 && groups['Planet'] >= 5, 'they are sorted into Planet, Landing sites and Gale crater', JSON.stringify(groups));
ok(nasa.find(p => p.name === 'Jezero crater').group === 'Planet' && nasa.find(p => p.name === 'Bradbury Landing').group === 'Gale crater', 'Jezero is a planet feature; Bradbury Landing is in Gale');
const st = P.stops(false), all = P.stops(true);
ok(all.length === G.WP.length && st.length < all.length && st[st.length - 1].sol === G.WP[G.WP.length - 1].sol, 'the list shows every tenth stop and the last; all are searchable', st.length + ' of ' + all.length);
const s1 = P.search('sol 4700', all);
ok(s1.length && Math.abs(s1[0].sol - 4700) <= 15, 'a search for a sol finds the nearest stop', s1[0] && s1[0].name);
ok(P.search('jezero', nasa)[0].name === 'Jezero crater' && P.search('kimberley', nasa)[0].name === 'The Kimberley', 'a search finds places by part of the name');
ok(P.search('zzzz', nasa).length === 0, 'a search for nothing finds nothing');
ok(P.isLocal(-4.59, 137.44) && !P.isLocal(18.38, 77.58), 'Bradbury Landing is local to the Gale base; Jezero is not');
ok(P.imageryAt(-4.8, 137.38).name === 'MRO HiRISE' && P.imageryAt(-5.5, 137.0).name === 'MRO CTX' && /Viking/.test(P.imageryAt(18.65, -133.8).name), 'the sharpest imagery is named for each place');
const ends = P.trailEnds([{ id: 't1', name: 'Loop', points: [[-4.8, 137.38, 0, 0], [-4.81, 137.39, 60, 90]], distance_m: 1500 }]);
ok(ends.length === 2 && ends[0].name === 'Loop: start' && ends[1].lat === -4.81, "a saved trail's start and end are offered");

console.log('Checkpoints and view links');
const cp = P.checkpoints.save({ name: 'Ridge top', lat: -4.81, lon: 137.39, zoom: 16, kind: 'view' });
ok(P.checkpoints.list().length === 1 && P.checkpoints.list()[0].name === 'Ridge top', 'a checkpoint is saved');
const txt = P.checkpoints.toText(); P.checkpoints.remove(cp.id);
ok(P.checkpoints.list().length === 0, 'and removed');
ok(P.checkpoints.fromText(txt) === 1 && P.checkpoints.list()[0].lat === -4.81, 'a downloaded checkpoints file can be imported again');
ok(P.checkpoints.fromText('{"format":"something-else"}') === -1 && P.checkpoints.fromText('not json') === -1, 'other files are refused');
const h = P.parseHash('#map=18.38,77.58,9&dust=34,205');
ok(h.map.lat === 18.38 && h.map.zoom === 9 && h.dust.my === 34 && h.dust.ls === 205, 'a view link is read');
ok(P.formatHash(h) === '#map=18.38000,77.58000,9&dust=34,205', 'and written', P.formatHash(h));
ok(!P.parseHash('#map=200,10').map && !P.parseHash('#map=a,b').map, 'a bad link is ignored');

console.log('Walk budget (modelled)');
const A = C.BUDGET.astronaut;
let s = B.fresh();
B.step(s, { kind: 'astronaut', dt: 3600, moved: 3600 * 1.2, climbed: 0, air: -40 });
const o2h = s.o2Used;
ok(near(o2h, (A.metRest + A.metPerMs * 1.2) * A.o2PerJ * 3600, 1e-9), 'an hour of level walking uses the oxygen of 300 W of metabolism', (o2h * 1000).toFixed(0) + ' g');
const full8 = A.o2Kg / o2h;
ok(full8 > 7 && full8 < 11, 'the oxygen lasts about 8 to 10 hours of steady walking', full8.toFixed(1) + ' h');
let sc = B.fresh(); B.step(sc, { kind: 'astronaut', dt: 3600, moved: 3600 * 1.2, climbed: 300, air: -40 });
ok(sc.o2Used > o2h * 1.3, 'climbing costs more oxygen', ((sc.o2Used / o2h - 1) * 100).toFixed(0) + ' % more for 300 m up');
let cold = B.fresh(), warm = B.fresh();
B.step(cold, { kind: 'astronaut', dt: 3600, moved: 0, air: -80 }); B.step(warm, { kind: 'astronaut', dt: 3600, moved: 0, air: -10 });
ok(cold.whUsed > warm.whUsed, 'cold air drains the battery faster (heaters)', cold.whUsed.toFixed(0) + ' vs ' + warm.whUsed.toFixed(0) + ' Wh');
const r0 = B.read(B.fresh(), { kind: 'astronaut', back: 0, air: -40 }), r5 = B.read(B.fresh(), { kind: 'astronaut', back: 5000, air: -40 });
ok(r0.turnS > r5.turnS && r5.turnS > 0, 'farther from base, the turn-back point comes sooner', Math.round(r0.turnS / 60) + ' vs ' + Math.round(r5.turnS / 60) + ' min');
let late = B.fresh(); B.step(late, { kind: 'astronaut', dt: 6.5 * 3600, moved: 6.5 * 3600 * 1.2, climbed: 0, air: -40 });
const rl = B.read(late, { kind: 'astronaut', back: 6000, air: -40 });
ok(rl.turnS < 0, 'after a long walk far from base, it is past the turn-back point', Math.round(rl.turnS / 60) + ' min, ' + rl.limit + ' limits');
ok(B.read(B.fresh(), { kind: 'robot', back: 9000 }).o2Pct === null && B.read(B.fresh(), { kind: 'robot', back: 9000 }).turnS === null, 'a robot has no oxygen and need not turn back');
const noon = B.sunlight(-4.8, 12, 90, 0.05), dusty = B.sunlight(-4.8, 12, 90, 2.0), night = B.sunlight(-4.8, 0, 90, 0.05);
ok(noon > 400 && night === 0, 'sunlight at noon in clear air, none at night', Math.round(noon) + ' W/m²');
ok(dusty < noon * 0.02, 'a planet-encircling storm (optical depth 2) all but blacks out the direct sun, as it did for Opportunity in 2018', Math.round(dusty) + ' W/m²');
let rc = B.fresh(); rc.whUsed = 500; B.step(rc, { kind: 'robot', dt: 3600, moved: 0, sun: noon });
ok(rc.whUsed < 500, 'a robot standing in sunlight recharges', (500 - rc.whUsed).toFixed(0) + ' Wh in an hour');
const fr = B.forRoute('astronaut', { distance: 3000, climb: 100, moveTime: 2600, returnTime: 3000 }, -40);
ok(fr.o2Pct > 50 && fr.o2Pct < 100 && !fr.short, 'a 3 km route out and back leaves most of the oxygen', Math.round(fr.o2Pct) + ' %');

console.log('Custom oxygen model');
const bad = B.validate({ model: 'fixed', o2Kg: '9', walkKgH: 'x', restKgH: 0.5 });
ok(!bad.ok && /Between/.test(bad.errors.o2Kg) && /number/.test(bad.errors.walkKgH), 'out-of-range and non-numeric values are refused, with the unit', bad.errors.o2Kg);
ok(!B.validate({ model: 'fixed', walkKgH: 0.05, restKgH: 0.08 }).ok, 'standing may not use more oxygen than walking');
const blank = B.validate({ model: 'metabolic' });
ok(blank.ok && blank.model.o2Kg === C.BUDGET.astronaut.o2Kg && blank.model.metRest === C.BUDGET.astronaut.metRest, 'blank fields take the defaults');
const m0 = B.fresh(); B.step(m0, { kind: 'astronaut', dt: 3600, moved: 4320, air: -40 }); const o2Default = m0.o2Used;
ok(B.setModel({ model: 'fixed', o2Kg: 1.0, walkKgH: 0.1, restKgH: 0.05, reserve: 20 }).ok, 'a fixed-rate model is accepted');
const m1 = B.fresh(); B.step(m1, { kind: 'astronaut', dt: 3600, moved: 4320, air: -40 });
const n1 = B.read(m1, { kind: 'astronaut', back: 0, air: -40 });
ok(Math.abs(m1.o2Used - 0.1) < 1e-9 && Math.abs(n1.o2Pct - 90) < 1e-6 && n1.custom && B.reserve() === 0.2, 'it sets the oxygen used, the capacity and the reserve', (m1.o2Used * 1000).toFixed(0) + ' g, ' + n1.o2Pct.toFixed(1) + ' % left');
ok(B.setModel({ model: 'metabolic', metRest: 200, kJPerL: 20.1 }).ok, 'a model from effort is accepted');
const m2 = B.fresh(); B.step(m2, { kind: 'astronaut', dt: 3600, moved: 0, air: -40 });
ok(Math.abs(m2.o2Used - 200 * 3600 * 1.429e-3 / 20100) < 1e-6, 'it follows the user\'s metabolism', (m2.o2Used * 1000).toFixed(1) + ' g in an hour standing at 200 W');
B.setModel(null);
const m3 = B.fresh(); B.step(m3, { kind: 'astronaut', dt: 3600, moved: 4320, air: -40 });
ok(m3.o2Used === o2Default && B.reserve() === C.BUDGET.RESERVE && C.BUDGET.astronaut.o2Kg === 0.7, 'removing it brings back the defaults exactly; the defaults were never changed');

MW.dust.load().then(() => {
  console.log('Best season (historical)');
  const D = MW.dust; while (D.analyseNext()) {}
  const gale = D.cellAt(-4.8, 137.38).c, prof = MW.season.profile(gale);
  ok(prof.length === 72 && prof.complete, 'a profile for every 5° of Ls, from every Martian Year', prof.length + ' bins');
  const best = MW.season.window(prof, 60, false), worst = MW.season.window(prof, 60, true);
  ok(best.med < worst.med && best.to <= 150, 'the clearest season at Gale is northern spring and summer', 'Ls ' + best.from + '–' + best.to + ', median ' + best.med.toFixed(2));
  ok(worst.from >= 150 && worst.from <= 300, 'the dustiest is the perihelion season', 'Ls ' + worst.from + '–' + worst.to + ', median ' + worst.med.toFixed(2));
  const storm = prof.filter(p => p.ls > 180 && p.ls < 240).reduce((m, p) => Math.max(m, p.stormYears), 0), calm = prof.filter(p => p.ls > 60 && p.ls < 120).reduce((m, p) => Math.max(m, p.stormYears), 0);
  ok(storm >= 2 && calm === 0, 'storm years cluster in the dusty season and never in the clear one', storm + ' vs ' + calm);
  const dt = MW.season.dates(best.from, best.to, Date.parse('2026-11-15T00:00:00Z'));
  ok(dt && dt.my === 39 && dt.start.getUTCFullYear() === 2027, 'the next clear season is placed in MY39, in 2027', dt && dt.start.toISOString().slice(0, 10) + ' to ' + dt.end.toISOString().slice(0, 10));
  const d34 = MW.season.dates(185, 240, Date.parse('2018-05-01T00:00:00Z'));
  ok(d34 && d34.my === 34 && ['2018-05', '2018-06'].indexOf(d34.start.toISOString().slice(0, 7)) >= 0, 'dates line up with the record: MY34 Ls 185° is mid-2018, when the global storm began', d34 && d34.start.toISOString().slice(0, 10));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(err => { console.error(err); process.exit(2); });
