/* dust_test.js — checks the dust detection (dust.js) against the real data pack (dust-data.js).
 * Run:  node dust_test.js            (Node 18 or later; no packages needed)
 * Add --report to print what the detection finds in every Martian Year.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['config.js', 'dust-data.js', 'dust.js']) {
  const p = [path.join(__dirname, f), path.join(__dirname, 'js', f)].find(fs.existsSync);
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
}
const D = MW.dust, K = MW.config.DUST;
let failed = 0, passed = 0;
function ok(cond, what, detail) {
  if (cond) passed++; else failed++;
  console.log((cond ? '  ok    ' : '  FAIL  ') + what + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const GALE = [-4.8, 137.38];

D.load().then(() => {
  const P = D.pack, gale = D.cellAt(GALE[0], GALE[1]).c;
  const at = (my, ls, c) => D.assess(my, D.frameAtLs(my, ls), c === undefined ? gale : c);
  const t = v => v === null ? 'none' : v.toFixed(2);

  console.log('Data pack');
  ok(P.years.length >= 3, 'several Martian Years are in the pack', P.years.map(y => y.my).join(' '));
  ok(P.grid.nx * P.grid.ny === P.n && P.years.every(y => y.obs.length === y.frames * P.n), 'every plane has frames x cells values');
  const b = D.cellBounds(gale);
  ok(b.south <= GALE[0] && GALE[0] < b.north && b.west <= GALE[1] && GALE[1] < b.east, 'the Gale cell contains the walk', `${b.south}..${b.north} N, ${b.west}..${b.east} E`);
  ok(D.cellAt(10, -179.5).c === D.cellAt(10, 179.5).c, 'the cell at the date line is one cell on both sides');

  console.log('Seasons and Martian Years (cell over Gale crater)');
  const clear = at(31, 90), dusty = at(31, 230);
  ok(clear.cls === 1, 'MY31, Ls 90 (clear season) is LOW', `tau ${t(clear.tau)}, baseline ${t(clear.baseline && clear.baseline.median)}`);
  ok(dusty.baseline.median > clear.baseline.median * 1.5, 'the baseline is seasonal: dusty-season median is well above the clear-season one', `${t(clear.baseline.median)} -> ${t(dusty.baseline.median)}`);
  const s34 = at(34, 205), s28 = at(28, 280), s25 = at(25, 200);
  ok(s34.cls >= 3 && s34.label === 'OBSERVED', 'MY34, Ls 205 (2018 planet-encircling storm) is HIGH or SEVERE from observations', `${s34.className}, tau ${t(s34.tau)}, ${Math.round(s34.devPct)} %`);
  ok(s28.cls >= 3, 'MY28, Ls 280 (2007 planet-encircling storm) is HIGH or SEVERE', `${s28.className}, tau ${t(s28.tau)}`);
  ok(s25.cls >= 3, 'MY25, Ls 200 (2001 planet-encircling storm) is HIGH or SEVERE', `${s25.className}, tau ${t(s25.tau)}`);
  const q = at(30, 205);
  ok(q.cls <= 2 && q.tau < s34.tau, 'the same season in MY30, a year without a global storm, is lower', `${q.className}, tau ${t(q.tau)}`);
  ok(s34.baseline.years >= K.MIN_YEARS && !isNaN(s34.z), 'the baseline leaves the judged year out and still has enough years', `${s34.baseline.years} years, ${s34.baseline.values} values`);

  console.log('Persistence, region and trend');
  ok(s34.persistent && s34.regional, 'the MY34 storm over Gale is persistent and regional', `${s34.run} frames, ${s34.neighbours.elevated}/${s34.neighbours.observed} neighbours`);
  const rise = at(34, 192), fall = at(34, 235);
  ok(rise.trend === 'increasing', 'MY34 storm onset reads as increasing', `Ls ${rise.ls}, change ${t(rise.change)}`);
  ok(fall.trend === 'decreasing', 'MY34 storm decay reads as decreasing', `Ls ${fall.ls}, change ${t(fall.change)}`);
  ok(clear.trend === 'stable', 'the clear season reads as stable', `change ${t(clear.change)}`);
  /* an isolated spike must not reach HIGH: search the record for elevated cells that are neither persistent nor regional */
  let isolated = 0, isolatedHigh = 0, sev = 0, sevBad = 0;
  for (const y of P.years) {
    const A = D.analyse(y.my);
    for (let o = 0; o < A.cls.length; o++) {
      if (A.kind[o] === 1 && A.elev[o] && A.run[o] < K.PERSIST_FRAMES && A.nbElev[o] < K.REGION_MIN) { isolated++; if (A.cls[o] >= 3) isolatedHigh++; }
      if (A.cls[o] === 4) { sev++; if (!(A.run[o] >= K.PERSIST_FRAMES && A.nbElev[o] >= K.REGION_MIN && A.tau[o] >= K.FLOOR.SEVERE && A.z[o] >= K.Z.SEVERE)) sevBad++; }
    }
  }
  ok(isolated > 0 && isolatedHigh === 0, 'isolated anomalies are never classed above MODERATE', `${isolated} isolated elevated values`);
  ok(sev > 0 && sevBad === 0, 'every SEVERE value meets all four SEVERE criteria', `${sev} SEVERE values`);

  console.log('Missing observations');
  let miss = null, itp = null;
  for (const y of P.years) { const A = D.analyse(y.my); for (let o = 0; o < A.kind.length && !(miss && itp); o++) { if (A.kind[o] === 0 && !miss) miss = [y.my, o]; if (A.kind[o] === 2 && !itp) itp = [y.my, o]; } }
  ok(miss !== null, 'the record contains cells with no data at all');
  if (miss) {
    const a = D.assess(miss[0], Math.floor(miss[1] / P.n), miss[1] % P.n);
    ok(a.cls === 0 && a.className === 'NO DATA' && a.tau === null && a.confidence === 'none', 'a missing cell is NO DATA: no optical depth, no class, never LOW', `MY${a.my} Ls ${a.ls}`);
  }
  if (itp) {
    const a = D.assess(itp[0], Math.floor(itp[1] / P.n), itp[1] % P.n);
    ok(a.label === 'INTERPOLATED' && a.confidence === 'low' && a.relUnc === null, 'a gap filled by kriging is labelled INTERPOLATED with low confidence', `MY${a.my} Ls ${a.ls}, tau ${t(a.tau)}`);
  }
  const A24 = D.analyse(24);
  ok(A24.summary[0].coverage === 0 && isNaN(A24.summary[0].high), 'a frame with no observations reports no storm share rather than 0 %', 'MY24 before the first TES data');
  ok(A24.kind.subarray(0, P.n).every(k => k === 0), 'kriged values with no observation nearby in space or time are not used', 'MY24 frame 1 is NO DATA everywhere');
  const polar = D.assess(34, D.frameAtLs(34, 205), D.cellAt(72, 30).c);
  ok(polar.confidence !== 'high', 'a high-latitude cell never gets high confidence', polar.confidence);

  console.log('Routes');
  const drive = [[-4.7998, 137.3835], [-4.81, 137.385], [-4.826, 137.389]];
  const r1 = D.routeExposure(drive, 34, D.frameAtLs(34, 205)), r0 = D.routeExposure(drive, 31, D.frameAtLs(31, 90));
  ok(r1.cells === 1 && r1.worst >= 3 && r1.kmElevated > 0, 'a short walk in Gale during the MY34 storm: one cell, flagged', `${r1.km.toFixed(2)} km, ${r1.worstName}`);
  ok(r0.worst === 1 && r0.kmElevated === 0, 'the same walk in a clear season is LOW', r0.worstName);
  const long = [[-4.8, 137.4], [-20, 110], [-42, 70], [-45, 40]];                        // Gale to Hellas and beyond
  const f = D.frameAtLs(34, 188), rl = D.routeExposure(long, 34, f);
  const classes = new Set(rl.sections.map(s => s.a.cls));
  ok(rl.cells > 5 && classes.size > 1, 'a long route crosses several cells with different dust classes', `${rl.cells} cells, classes ${[...classes].sort().map(c => K.CLASSES[c]).join(', ')}`);
  ok(Math.abs(rl.sections.reduce((s, x) => s + x.km, 0) - rl.km) < 1e-6 && rl.sections.every(s => s.line.length >= 2), 'the sections add up to the whole route and each has a line to draw', `${Math.round(rl.km)} km`);
  const quiet = D.routeExposure(long, 31, D.frameAtLs(31, 90));
  ok(quiet.score < rl.score, 'the exposure score ranks the storm date above the clear date', `${quiet.score.toFixed(2)} < ${rl.score.toFixed(2)}`);
  const noData = D.routeExposure([[80, 0], [86, 40]], 24, 0);
  ok(noData.worst === 0 && noData.kmNoData > 0 && noData.score > 0, 'a route through unobserved cells is reported as unknown and is not scored as clear', `${Math.round(noData.kmNoData)} km without data, score ${noData.score.toFixed(2)}`);
  ok(D.implications(1).length === 0 && D.implications(3).length === 4, 'operational implications are listed for elevated classes only');

  console.log('Timeline');
  const all = D.framesInLs(34, 0, 360), part = D.framesInLs(34, 180, 270), wrap = D.framesInLs(34, 330, 30);
  ok(all.length === D.year(34).frames && part.length > 10 && part.every(k => D.year(34).ls[k] >= 180 && D.year(34).ls[k] <= 270), 'an Ls range selects the frames inside it', `${part.length} of ${all.length}`);
  ok(wrap.length > 5 && wrap.every(k => { const l = D.year(34).ls[k]; return l >= 330 || l <= 30; }), 'a range through Ls 360 works', `${wrap.length} frames`);
  ok(D.lsDiff(D.year(28).ls[D.frameAtLs(28, D.year(34).ls[60])], D.year(34).ls[60]) < 3, 'frames of two years are matched by season for the comparison');
  ok(D.year(34).ls.every((l, k, a) => !k || l >= a[k - 1]), 'frames run forward in Ls');
  const ev34 = D.analyse(34).events, big = ev34.reduce((m, e) => e.peak > m.peak ? e : m, { peak: 0 });
  ok(big.peak > 0.3 && big.lsFrom < 200 && big.lsTo > 220 && big.worst === 4, 'the MY34 global storm is found as an event from the data alone', `Ls ${Math.round(big.lsFrom)}-${Math.round(big.lsTo)}, peak ${Math.round(big.peak * 100)} % of the observed planet`);
  const risk = D.seasonalRisk(gale, 205);
  ok(risk.pending === 0 && risk.years.length === P.years.length && risk.yearsHigh >= 1 && risk.yearsHigh < risk.yearsWithData, 'the seasonal record counts storm years without calling every year a storm', `${risk.yearsHigh} of ${risk.yearsWithData} years`);

  if (process.argv.includes('--report')) {
    console.log('\nStorm events found in each Martian Year');
    for (const y of P.years) {
      const A = D.analyse(y.my);
      console.log(`  MY${y.my} (${y.instruments}; ${Math.round(y.coverage * 100)} % of grid points observed)`);
      if (!A.events.length) console.log('     none');
      for (const e of A.events) console.log(`     Ls ${String(Math.round(e.lsFrom)).padStart(3)}-${String(Math.round(e.lsTo)).padStart(3)}  ${K.CLASSES[e.worst].padEnd(8)} peak ${String(Math.round(e.peak * 100)).padStart(3)} % at Ls ${Math.round(e.lsPeak)}, ${e.sols} sols`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(2); });
