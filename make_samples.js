/* make_samples.js — writes the sample trails: samples.js (built into the page) and one file per sample in
 * sample-trails/ (to try "Import a trail file" with). Run from this folder:   node make_samples.js
 *
 * Every sample is laid out in metres from the Gale base (Curiosity's first stop of the reference drive, sol 4560),
 * turned into latitude and longitude with geo.js, the same way the page does it, and timed at the walker's own
 * pace (ROUTER.WALKERS in config.js). They are made-up walks for practice, not
 * records of real ones: their names start with "Sample" and their source is "sample".
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const here = __dirname, ctx = { console, Math, JSON, Date, document: { getElementById() { return null; } } };
ctx.window = ctx; ctx.MW = {};
vm.createContext(ctx);
for (const f of ['config.js', 'data.js', 'geo.js']) vm.runInContext(fs.readFileSync(path.join(here, f), 'utf8'), ctx, { filename: f });
const C = ctx.MW.config, G = ctx.MW.geo, WP = G.WP;
const STEP = 3;                                                   // m between stored points (the page stores 1.5 m; 3 m keeps the files small)
const SPEED = { astronaut: C.ROUTER.WALKERS.astronaut.speed, robot: C.ROUTER.WALKERS.robot.speed };

/* a path through corner points, filled in every STEP metres */
function fill(corners) {
  const out = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / STEP));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
const wp = (i) => [WP[i].x, WP[i].y];
const range = (a, b) => { const r = []; for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) r.push(i); return r; };

function record(id, name, walkerType, walkerName, xy, note) {
  let d = 0, t = 0;
  const v = SPEED[walkerType], pts = [];
  for (let i = 0; i < xy.length; i++) {
    if (i) { const s = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]); d += s; t += s / v; }
    const j = Math.min(i + 1, xy.length - 1), k = j === i ? i - 1 : i;           // heading: towards the next point (the last keeps the one before)
    const hdg = (Math.atan2(xy[j][0] - xy[k][0], xy[j][1] - xy[k][1]) * 180 / Math.PI + 360) % 360;
    const ll = G.toLL(xy[i][0], xy[i][1]);
    pts.push([+ll[0].toFixed(7), +ll[1].toFixed(7), Math.round(t), Math.round(hdg)]);
  }
  return {
    format: 'marswalk-trail', version: 1, id, name, savedAt: '2026-11-15T00:00:00.000Z', source: 'sample',
    walker: { name: walkerName, type: walkerType }, site: 'Mount Sharp boxwork, Gale crater, Mars',
    base: { lat: G.ORIGIN.lat, lon: G.ORIGIN.lon }, note,
    distance_m: Math.round(d * 10) / 10, duration_s: Math.round(t),
    fields: ['lat', 'lon', 'seconds', 'heading_deg'], points: pts
  };
}

const S = [];
/* 1. Out along Curiosity's first drive to stop 14 and back the same way: every metre is walked twice. */
S.push(record('s-out-back', 'Sample · Out and back on the drive', 'astronaut', 'Astronaut 1',
  fill(range(0, 14).map(wp).concat(range(13, 0).map(wp))),
  'Out along Curiosity’s first drive to stop 14 and back the same way. The whole line darkens to "twice"; Show way back draws it straight home.'));
/* 2. A loop: out on the drive, back across open ground to the east, crossing the outbound line once. */
S.push(record('s-ridge-loop', 'Sample · Boxwork ridge loop', 'astronaut', 'Astronaut 1',
  fill(range(0, 13).map(wp).concat([[-170, -275], [-110, -250], [-60, -190], [-95, -120], [-150, -95], [-120, -45], [-55, -20], [0, 0]])),
  'Out on the drive, home across the ridges to the east. It crosses its own outbound line, so one stretch shows two passes.'));
/* 3. A figure of eight, twice round: the crossing in the middle is passed four times or more. */
(function () {
  const cx = 55, cy = -95, a = 70, pts = [[0, 0], [cx, cy]];
  for (let lap = 0; lap < 2; lap++) for (let k = 1; k <= 120; k++) { const u = k / 120 * 2 * Math.PI; pts.push([cx + a * Math.sin(u), cy + a * Math.sin(u) * Math.cos(u)]); }
  pts.push([0, 0]);
  S.push(record('s-figure-eight', 'Sample · Figure-eight practice', 'astronaut', 'Astronaut 2', fill(pts),
    'Two laps of a figure of eight south-east of base. The crossing turns the deepest shade: passed four times or more.'));
})();
/* 4. A rover's survey: six parallel lanes 25 m apart, as a robot maps a patch of ground. */
(function () {
  const pts = [[0, 0]], x0 = 30, y0 = -30, L = 150, gap = 25;
  for (let lane = 0; lane < 6; lane++) { const x = x0 + lane * gap; pts.push(lane % 2 ? [x, y0 - L] : [x, y0], lane % 2 ? [x, y0] : [x, y0 - L]); }
  pts.push([0, 0]);
  S.push(record('s-rover-grid', 'Sample · Rover survey grid', 'robot', 'Rover 1', fill(pts),
    'A robot sweeping six 150 m lanes east of base at rover pace (4 cm/s), the way a site is mapped before a crew walks it.'));
})();
/* 5. A detour: straight south, round a 40 m keep-clear circle, and on. */
(function () {
  const pts = [[0, 0], [20, -60]], c = [20, -110], r = 40;
  for (let k = 0; k <= 18; k++) { const u = Math.PI / 2 + k / 18 * Math.PI; pts.push([c[0] - r * Math.cos(u) * -1, c[1] + r * Math.sin(u)]); }
  pts.push([20, -230], [80, -260]);
  S.push(record('s-hazard-detour', 'Sample · Detour round a hazard', 'astronaut', 'Astronaut 1', fill(pts),
    'South from base, then a half circle 40 m round a hazard (try a danger marker there), and on to the south-east.'));
})();

fs.writeFileSync(path.join(here, 'samples.js'),
  '/* samples.js — the sample trails offered under "Saved routes and trails". Written by make_samples.js: do not edit by hand.\n' +
  ' * Each is an ordinary trail record (the same format as a downloaded .marswalk.json file). */\n' +
  'MW.SAMPLE_TRAILS = ' + JSON.stringify(S) + ';\n');
fs.mkdirSync(path.join(here, 'sample-trails'), { recursive: true });
for (const s of S) fs.writeFileSync(path.join(here, 'sample-trails', s.id.slice(2) + '.marswalk.json'), JSON.stringify(s, null, 1).replace(/\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+),\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g, '[$1, $2, $3, $4]') + '\n');
S.forEach(s => console.log(s.name.padEnd(40), (s.distance_m + ' m').padStart(9), (Math.round(s.duration_s / 60) + ' min').padStart(9), s.points.length + ' points'));
