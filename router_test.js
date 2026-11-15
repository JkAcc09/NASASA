/* router_test.js — checks the terrain pack (terrain.js) and the route-finder (router.js) against the real data.
 * Run:  node router_test.js            (Node 18 or later; no packages needed)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['config.js', 'data.js', 'geo.js', 'landmarks.js', 'terrain-data.js', 'terrain.js', 'dust-data.js', 'dust.js', 'router.js']) {
  const p = [path.join(__dirname, f), path.join(__dirname, 'js', f)].find(fs.existsSync);
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
}
const T = MW.terrain, RT = MW.router, D = MW.dust, G = MW.geo, K = MW.config.ROUTER, WP = G.WP;
let failed = 0, passed = 0;
function ok(cond, what, detail) {
  if (cond) passed++; else failed++;
  console.log((cond ? '  ok    ' : '  FAIL  ') + what + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const BASE = { lat: G.ORIGIN.lat, lon: G.ORIGIN.lon, name: 'Base' };
const CURIOSITY = { id: 'curiosity', name: "Curiosity's drive", points: WP.map(w => [w.lat, w.lon]) };
const at = (x, y) => { const l = G.toLL(x, y); return { lat: l[0], lon: l[1] }; };
const sum = o => `index ${o.index}, ${Math.round(o.metrics.distance)} m, ${o.label}` + (o.also.length ? ' (+' + o.also.join(', ') + ')' : '');

Promise.all([T.load(), D.load()]).then(() => {
  const dustAt = (my, ls) => (lat, lon) => { const a = D.assess(my, D.frameAtLs(my, ls), D.cellAt(lat, lon).c); return { cls: a.cls, trend: a.trend, tau: a.tau, when: 'MY' + my + ', Ls ' + Math.round(a.ls) + '°' }; };
  const ask = (to, extra) => RT.plan(Object.assign({ from: BASE, to: to, walker: 'astronaut', hour: 10, ls: 90, wx: WP[0].wx, height: T.heightAt, dust: dustAt(31, 90),
    bases: [BASE], hazards: [], zones: [], known: [CURIOSITY] }, extra || {}));

  console.log('Terrain pack');
  const pk = T.pack;
  ok(pk.global.nx === 1440 && pk.global.ny === 721, 'the global grid is 0.25 degrees', pk.global.nx + ' x ' + pk.global.ny);
  let worst = 0;
  pk.check.forEach(c => { const tol = /Bradbury/.test(c.site) ? 250 : 60, z = T.heightAt(c.lat, c.lon); worst = Math.max(worst, /Bradbury/.test(c.site) ? 0 : Math.abs(z - c.mola_m)); ok(Math.abs(z - c.mola_m) <= tol, c.site + ' is at its published MOLA height', `${Math.round(z)} m, MOLA ${c.mola_m} m`); });
  ok(worst < 60, 'flat landing sites agree to better than 60 m', 'worst ' + Math.round(worst) + ' m');
  const oly = T.heightAt(18.65, -133.8), hel = T.heightAt(-42.4, 70.5);
  ok(oly > 18000 && hel < -5500, 'Olympus Mons is high and Hellas is deep', `${Math.round(oly)} m, ${Math.round(hel)} m`);
  ok(Math.abs(T.heightAt(10, 180) - T.heightAt(10, -180)) < 1e-6 && Math.abs(T.heightAt(10, 359.99) - T.heightAt(10, 0.01)) < 30, 'heights join up across the date line and the prime meridian');
  ok(T.slopeAt(4.5, 135.6) < 1.5, 'the plain at InSight is flat', T.slopeAt(4.5, 135.6).toFixed(2) + '°');
  let scarp = 0; for (let lo = -140; lo <= -128; lo += 0.25) for (let la = 13; la <= 24; la += 0.25) scarp = Math.max(scarp, T.slopeAt(la, lo));
  ok(scarp > 8, 'the flanks of Olympus Mons show a steep regional slope', scarp.toFixed(1) + '°');
  const zb = T.heightAt(BASE.lat, BASE.lon);
  ok(Math.abs(zb - G.ORIGIN.z) < 900, "the model at base is within its resolution of Curiosity's surveyed height", `${Math.round(zb)} m against ${G.ORIGIN.z} m surveyed`);
  ok(T.resolutionAt(BASE.lat, BASE.lon) < 4000 && T.resolutionAt(40, 20) > 14000, 'Gale uses the finer inset, the rest of the planet the global grid');

  console.log('Routes that should be found');
  const end = WP[WP.length - 1], r1 = ask({ lat: end.lat, lon: end.lon, name: 'End of the drive' });
  ok(r1.ok && r1.options.length >= 1, 'a route is found to the end of Curiosity\'s drive', r1.ok ? r1.options.map(sum).join(' | ') : r1.reason);
  const o1 = r1.options[0];
  ok(r1.options.every((o, i) => !i || o.index <= r1.options[i - 1].index || r1.options[i - 1].id === 'preferred'), 'options are ranked by safety index, highest first', r1.options.map(o => o.index).join(' > '));
  ok(o1.line.length >= 2 && Math.abs(o1.line[0][0] - BASE.lat) < 1e-6 && Math.abs(o1.line[o1.line.length - 1][0] - end.lat) < 1e-6, 'the line starts at the walker and ends at the destination');
  ok(o1.index >= 0 && o1.index <= 100 && o1.good.length + o1.bad.length > 0, 'every option has an index from 0 to 100 and reasons', `good: ${o1.good.join('; ')} | bad: ${o1.bad.join('; ')}`);
  const kn = r1.options.find(o => o.metrics.knownShare > 0.6);
  ok(!!kn, 'one option keeps to known ground (Curiosity\'s drive)', kn ? Math.round(kn.metrics.knownShare * 100) + ' % known, ' + Math.round(kn.metrics.distance) + ' m' : 'none');
  const dr = r1.options.concat(r1.refused).find(o => o.id === 'direct' || o.also.indexOf('Most direct') >= 0);
  const straight = Math.hypot(end.x, end.y);
  ok(dr && dr.metrics.distance < straight * 1.03, 'the most direct option is within 3 % of the straight line', dr ? Math.round(dr.metrics.distance) + ' m against ' + Math.round(straight) + ' m' : 'none');

  const near = ask(at(300, -200));
  ok(near.ok && near.options[0].good.some(t => /short travel distance/.test(t)), 'a 360 m walk is tagged as a short travel distance', near.ok ? near.options[0].good.join('; ') : near.reason);
  ok(near.ok && near.options[0].good.some(t => /nearest base/.test(t)), 'and as close to base', near.ok ? near.options[0].good.join('; ') : '');

  console.log('Walked ground and the preferred trail');
  const tr = { id: 't1', name: 'Dog-leg', points: [] };
  for (let i = 0; i <= 200; i++) tr.points.push((p => [p.lat, p.lon])(at(i * 2, 0)));             // 400 m east
  for (let i = 1; i <= 200; i++) tr.points.push((p => [p.lat, p.lon])(at(400, i * 2)));           // then 400 m north
  const dest = Object.assign(at(400, 400), { name: 'Corner' });
  const plain = ask(dest, { known: [] }), walked = ask(dest, { known: [tr] }), pref = ask(dest, { known: [Object.assign({}, tr, { preferred: true })] });
  ok(plain.ok && plain.options[0].metrics.knownShare === 0 && plain.options[0].bad.some(t => /unwalked/.test(t)), 'with no trails, the route is flagged as unwalked ground', plain.options[0].bad.join('; '));
  const wk = walked.options.find(o => o.metrics.knownShare > 0.8);
  ok(!!wk, 'with a walked trail, an option follows it', walked.options.map(o => `${o.label} ${Math.round(o.metrics.knownShare * 100)} %`).join(' | '));
  ok(wk && wk.metrics.distance > 760 && wk.metrics.distance < 840, 'that option has the trail\'s own length (800 m), not the diagonal (566 m)', wk ? Math.round(wk.metrics.distance) + ' m' : '');
  const sameRoute = plain.options[0], onTrail = walked.options.find(o => o.metrics.knownShare > 0.8);
  ok(onTrail && walked.options.some(o => o.metrics.knownShare < 0.3) , 'the direct way is still offered beside it');
  const pf = pref.options.find(o => o.id === 'preferred');
  ok(pf && pf.metrics.preferredShare > 0.8, 'a preferred trail gets its own option', pf ? `${Math.round(pf.metrics.preferredShare * 100)} % on it, index ${pf.index}, rank ${pf.rank}` : pref.options.map(sum).join(' | '));
  ok(pf && (pf.recommended ? pf.index >= Math.max(...pref.options.map(o => o.index)) - K.PREFER_MARGIN : true), 'it is recommended only when within the margin of the best', pf ? (pf.recommended ? 'recommended' : 'not recommended') + ': ' + pref.options.map(o => o.index).join(', ') : '');
  const offTrail = ask(Object.assign(at(-500, -300), { name: 'West' }), { known: [Object.assign({}, tr, { preferred: true })] });
  ok(offTrail.ok && offTrail.notes.some(n => /preferred trail does not lead/.test(n)) && !offTrail.options.some(o => o.id === 'preferred'), 'a preferred trail that leads elsewhere is reported, not forced', offTrail.notes[0]);

  console.log('Routes that must be refused, with the reason');
  const far = ask({ lat: 18.65, lon: -133.8, name: 'Olympus Mons' });
  ok(!far.ok && far.code === 'far' && /No viable route/.test(far.reason), 'Olympus Mons from Gale: too far', far.reason);
  const storm = ask(dest, { dust: dustAt(34, 205) }), s34 = D.assess(34, D.frameAtLs(34, 205), D.cellAt(BASE.lat, BASE.lon).c);
  if (s34.cls === 4) ok(!storm.ok && storm.code === 'dust' && /SEVERE dust storm/.test(storm.reason), 'MY34 Ls 205 (2018 global storm, SEVERE at Gale): refused for dust', storm.reason);
  else ok(storm.ok && storm.options[0].bad.some(t => /dust storm HIGH/.test(t)) && storm.options[0].index < plain.options[0].index - 20, 'MY34 Ls 205 (HIGH at Gale): allowed but marked down hard', storm.ok ? sum(storm.options[0]) + ' | ' + storm.options[0].bad.join('; ') : storm.reason);
  const fake = ask(dest, { dust: () => ({ cls: 4, trend: 'increasing', tau: 1.31, when: 'a test date' }) });
  ok(!fake.ok && fake.code === 'dust' && /optical depth 1\.31/.test(fake.reason), 'a SEVERE storm at the destination is refused, with its optical depth', fake.reason);
  const hz = ask(dest, { hazards: [{ lat: dest.lat, lon: dest.lon, radius: 60, name: 'Cliff edge' }] });
  ok(!hz.ok && hz.code === 'hazard' && /Cliff edge/.test(hz.reason), 'a destination inside a danger marker\'s keep-clear distance is refused', hz.reason);
  const dunes = MW.landmarks.list.find(l => /^Hazard/.test(l.role));
  const inDunes = ask({ lat: dunes.at[0], lon: dunes.at[1], name: 'Dune crest' }, { from: { lat: dunes.at[0] + 0.02, lon: dunes.at[1] }, zones: [{ name: dunes.name, role: dunes.role, outline: dunes.outline }], known: [] });
  ok(!inDunes.ok && inDunes.code === 'zone' && /Bagnold Dunes/.test(inDunes.reason), 'a destination inside a hazard area (Bagnold Dunes) is refused', inDunes.reason);
  /* the steepest regional slope near Olympus Mons, approached from 5 km away */
  let st = { s: 0 }; for (let lo = -140; lo <= -128; lo += 0.125) for (let la = 13; la <= 24; la += 0.125) { const s = T.slopeAt(la, lo); if (s > st.s) st = { s, la, lo }; }
  const cliff = RT.plan({ from: { lat: st.la - 0.08, lon: st.lo - 0.08 }, to: { lat: st.la, lon: st.lo, name: 'Scarp' }, walker: 'astronaut', hour: 10, ls: 90, wx: null, height: T.heightAt, dust: null, bases: [{ lat: st.la - 0.08, lon: st.lo - 0.08, name: 'Camp' }], hazards: [], zones: [], known: [] });
  if (st.s > K.WALKERS.astronaut.slopeMax) ok(!cliff.ok && (cliff.code === 'slope' || cliff.code === 'closed' || cliff.code === 'limit'), 'the steepest flank of Olympus Mons (' + st.s.toFixed(1) + '°) is refused for an astronaut', cliff.reason);
  else ok(cliff.ok ? cliff.options[0].bad.some(t => /steep regional slope|high climb/.test(t)) : true, 'the steepest flank of Olympus Mons (' + st.s.toFixed(1) + '°, under the limit) is marked as steep', cliff.ok ? cliff.options[0].bad.join('; ') : cliff.reason);
  const wall = { lat: BASE.lat, lon: BASE.lon + 0.02 }, ring = [];
  for (let a = 0; a < 360; a += 10) ring.push([wall.lat + 0.004 * Math.cos(a * Math.PI / 180), wall.lon + 0.004 * Math.sin(a * Math.PI / 180)]);
  const long = ask({ lat: BASE.lat - 0.25, lon: BASE.lon - 0.1, name: 'Far rim' });
  ok(!long.ok && long.code === 'limit' && /more than the 8 h/.test(long.reason), 'a walk that cannot be finished and returned from in 8 h is refused', long.reason);

  console.log('What changes the index');
  const evening = ask(dest, { hour: 16.5, known: [] }), morning = ask(dest, { hour: 9, known: [] });
  const longish = Object.assign(at(2500, -3500), { name: 'Outcrop' }), lateLong = ask(longish, { hour: 15.5, known: [] }), earlyLong = ask(longish, { hour: 8, known: [] });
  ok(lateLong.ok && earlyLong.ok && lateLong.options[0].index < earlyLong.options[0].index, 'leaving late in the day lowers the index', `08:00 ${earlyLong.options[0].index}, 15:30 ${lateLong.options[0].index}`);
  ok(lateLong.options[0].bad.some(t => /after dark/.test(t)) && !earlyLong.options[0].bad.some(t => /after dark/.test(t)), 'and says why', lateLong.options[0].bad.join('; '));
  const rob = ask(longish, { walker: 'robot', hour: 8, known: [] });
  ok(rob.ok && rob.walker === 'robot' && rob.options[0].index !== earlyLong.options[0].index && rob.options[0].metrics.sols > 3, 'a robot is scored on its own terms (slower, no way back needed)', rob.ok ? `index ${rob.options[0].index}, ${rob.options[0].metrics.sols.toFixed(1)} sols | ${rob.options[0].good.concat(rob.options[0].bad).join('; ')}` : rob.reason);
  const withBase = ask(longish, { hour: 8, known: [], bases: [BASE, Object.assign({ name: 'Shelter' }, longish)] });
  ok(withBase.ok && withBase.options[0].index > earlyLong.options[0].index && withBase.options[0].metrics.returnTime === 0, 'a "home" marker at the destination raises the index and removes the way back', `${earlyLong.options[0].index} -> ${withBase.options[0].index}`);
  const mid = at(200, 200), haz = ask(dest, { known: [], hazards: [{ lat: mid.lat, lon: mid.lon, radius: 50, name: 'Soft sand' }] });
  const minClear = Math.min(...haz.options.map(o => o.metrics.clearance));
  ok(haz.ok && minClear >= -1, 'routes go round a danger marker on the straight line', haz.ok ? haz.options.map(o => `${o.label} clears by ${Math.round(o.metrics.clearance)} m, ${Math.round(o.metrics.distance)} m`).join(' | ') : haz.reason);
  ok(haz.ok && haz.options[0].metrics.distance > plain.options[0].metrics.distance + 5, 'and are longer for it', `${Math.round(plain.options[0].metrics.distance)} m -> ${Math.round(haz.options[0].metrics.distance)} m`);
  const dusty = ask(dest, { known: [], dust: () => ({ cls: 3, trend: 'increasing', tau: 0.62, when: 'a test date' }) });
  ok(dusty.ok && dusty.options[0].index <= plain.options[0].index - 25 && /dust storm HIGH, rising/.test(dusty.options[0].bad[0]), 'a HIGH, rising dust storm cuts the index and leads the unsafe tags', `${plain.options[0].index} -> ${dusty.options[0].index}: ${dusty.options[0].bad.join('; ')}`);
  const noData = ask(dest, { height: null, dust: null, wx: null, known: [] });
  ok(noData.ok && noData.notes.length >= 3, 'with no terrain, dust or weather data a route is still found, and the gaps are stated', noData.notes.length + ' notes');
  const sn = RT.sun(0, 0), ss = RT.sun(60, 90);
  ok(Math.abs(sn.hours - 12) < 0.01 && ss.hours > 16, 'day length follows latitude and season', `equator at equinox ${sn.hours.toFixed(1)} h, 60° N at midsummer ${ss.hours.toFixed(1)} h`);
  console.log('The live index, where the walker stands');
  const now = (pos, extra) => RT.live(Object.assign({ at: pos, walker: 'astronaut', hour: 10, elapsed: 0, ls: 90, wx: WP[0].wx, height: T.heightAt, slope: T.slopeAt, dust: dustAt(31, 90),
    bases: [BASE], hazards: [], zones: [], known: [CURIOSITY] }, extra || {}));
  const atBase = now(BASE), out3 = now(at(2500, -3500), { hour: 11, elapsed: 3600 }), txt = r => r.factors.map(f => f.key + ' ' + f.risk.toFixed(2)).join(', ');
  ok(atBase.index >= 85 && atBase.bad.length === 0, 'at base in the morning the index is high with nothing unsafe', atBase.index + ': ' + atBase.good.join('; '));
  ok(out3.index < atBase.index - 20 && out3.bad.some(t => /far from base/.test(t)), '4.3 km out, off every trail, it is much lower and says why', out3.index + ': ' + out3.bad.join('; '));
  const eveNear = now(at(300, 0), { hour: 17.9, elapsed: 3600 * 7.6 }), eveFar = now(at(2500, -3500), { hour: 17.9, elapsed: 3600 * 7.6 });
  ok(eveFar.factors.find(f => f.key === 'time').risk === 1 && /past the 8 h limit/.test(eveFar.factors.find(f => f.key === 'time').text), 'near the end of the day, far out: time is at full risk', eveFar.factors.find(f => f.key === 'time').text);
  ok(eveFar.factors.find(f => f.key === 'dark').risk >= 0.5 && eveNear.factors.find(f => f.key === 'dark').risk < 0.5, 'and the way back would end after dark, while close to base it would not', eveFar.factors.find(f => f.key === 'dark').text + ' | ' + eveNear.factors.find(f => f.key === 'dark').text);
  const hzP = at(200, 200), nearHz = now(at(200, 240), { hazards: [{ lat: hzP.lat, lon: hzP.lon, radius: 30, name: 'Soft sand' }] });
  ok(nearHz.worst.key === 'hazard' && /only 10 m from the edge/.test(nearHz.worst.text), '10 m from a danger marker\'s edge, the hazard is the worst factor', nearHz.index + ': ' + nearHz.worst.text);
  const inHz = now(at(200, 210), { hazards: [{ lat: hzP.lat, lon: hzP.lon, radius: 30, name: 'Soft sand' }] });
  ok(inHz.factors.find(f => f.key === 'hazard').risk === 1 && /inside the keep-clear distance/.test(inHz.worst.text), 'inside it, the risk is full', inHz.index + ': ' + inHz.worst.text);
  const stormNow = now(BASE, { dust: dustAt(34, 205) });
  ok(stormNow.index <= 60 && /dust storm/.test(stormNow.worst.text), 'in the 2018 global storm the index at base itself collapses', stormNow.index + ': ' + stormNow.worst.text);
  const liveOn = now({ lat: WP[60].lat, lon: WP[60].lon }), offTrail2 = now(at(2500, -3500));
  ok(liveOn.factors.find(f => f.key === "unknown").risk < 0.05 && offTrail2.factors.find(f => f.key === 'unknown').risk === 1, 'on Curiosity\'s drive the ground is known; 2.9 km off it, it is not', liveOn.factors.find(f => f.key === "unknown").text + ' | ' + offTrail2.factors.find(f => f.key === 'unknown').text);
  const robotNow = now(at(2500, -3500), { walker: 'robot', hour: 11, elapsed: 3600 });
  ok(robotNow.index > out3.index && !robotNow.factors.some(f => f.key === 'dark'), 'a robot in the same spot is scored on its own terms', robotNow.index + ' against ' + out3.index);
  const tl = Date.now(); for (let i = 0; i < 200; i++) now(at(i * 5, -i * 3)); const msl = (Date.now() - tl) / 200;
  ok(msl < 20, 'one live reading takes a few milliseconds', msl.toFixed(2) + ' ms');

  const t0 = Date.now(); for (let i = 0; i < 5; i++) ask({ lat: end.lat, lon: end.lon }); const ms = (Date.now() - t0) / 5;
  ok(ms < 1500, 'a plan takes well under two seconds', Math.round(ms) + ' ms');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
