#!/usr/bin/env node
/* build_dust_baselines.js — writes dust-baselines.js, the precomputed seasonal baselines for the dust layer.
 *
 * Run it from the folder that holds marswalk.html:   node build_dust_baselines.js
 * Run it again whenever the dust data pack (window.MARSWALK_DUST) or the baseline settings in config
 * (MW.config.DUST: LS_BIN, LS_WINDOW, MIN_YEARS, MIN_VALUES, SIGMA_REL, SIGMA_ABS) change. If you forget,
 * nothing breaks: the page sees the file is out of date and works the baselines out itself, as before (slowly).
 *
 * Why: working out the baselines in the browser froze the page for about a second at a time, for the first
 * 20 seconds or so. With this file the page only looks them up.
 *
 * What is stored, and why it is exact: every baseline is built from the data pack's own 1-byte readings.
 * The median and 90th percentile are each read between two sorted readings, and the spread comes from the
 * median of two deviations from the median, so instead of the numbers the file keeps which readings they came
 * from (6 bytes), plus how many readings (cnt) and years (yrs) went in. The page then repeats the same
 * arithmetic and gets the very same Float32 values. This script checks every one of them against dust.js's
 * own baselineForBin before it writes anything.
 *
 * Needs Node 18 or later (it uses the same DecompressionStream as the browser). Takes a minute or two.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');

const htmlPath = path.resolve(process.argv[2] || 'marswalk.html');
const outPath = path.join(path.dirname(htmlPath), 'dust-baselines.js');
const html = fs.readFileSync(htmlPath, 'utf8');

/* Load config, the dust data pack and dust.js from the page itself, so this script can never disagree with it. */
const blocks = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
const ctx = { console, Blob, Response, DecompressionStream, atob, Buffer };
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const marker of ['config.js —', 'window.MARSWALK_DUST =', 'dust.js — MW.dust']) {
  const code = blocks.find(b => b.includes(marker));
  if (!code) { console.error('Could not find the "' + marker + '" script in ' + htmlPath); process.exit(1); }
  vm.runInContext(code, ctx);
}

const MISSING = 255;
function lsDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function quantile(s, n, q) { const x = (n - 1) * q, k = Math.floor(x), f = x - k; return k + 1 < n ? s[k] + (s[k + 1] - s[k]) * f : s[k]; }

ctx.MW.dust.load().then(D => {
  const t0 = Date.now(), P = D.pack, K = ctx.MW.config.DUST, n = P.n, lut = P.lut, Y = P.years.length;
  const bins = Math.round(360 / K.LS_BIN), E = bins * n * Y;
  const fingerprint = D.baselineFingerprint(ctx.MARSWALK_DUST);

  /* Planes in the order [bin][cell][year]: neighbouring years share most of their readings, so their entries
     are nearly alike and compress well. */
  const mA = new Uint8Array(E), mB = new Uint8Array(E), pA = new Uint8Array(E), pB = new Uint8Array(E),
        dA = new Uint8Array(E), dB = new Uint8Array(E), yrsP = new Uint8Array(E), cnt = new Uint16Array(E);
  const has = P.years.map(() => new Array(bins).fill(0));
  let checked = 0, bad = 0;

  P.years.forEach((yy, yi) => {
    const used = new Set(yy.ls.map(l => Math.floor((((l % 360) + 360) % 360) / K.LS_BIN)));
    for (const bin of used) {
      has[yi][bin] = 1;
      const centre = (bin + 0.5) * K.LS_BIN, picks = [];
      P.years.forEach(y => {
        if (y.my === yy.my) return;
        const fs = []; for (let f = 0; f < y.frames; f++) if (lsDiff(y.ls[f], centre) <= K.LS_WINDOW) fs.push(f);
        if (fs.length) picks.push({ y, fs });
      });
      const B = D.baselineForBin(yy.my, bin, true);           // the reference: dust.js computing it the slow way
      for (let c = 0; c < n; c++) {
        const bytes = []; let yrs = 0;
        for (const p of picks) {
          let had = false;
          for (const f of p.fs) { const b = p.y.obs[f * n + c]; if (b !== MISSING) { bytes.push(b); had = true; } }
          if (had) yrs++;
        }
        const e = (bin * n + c) * Y + yi, m = bytes.length;
        cnt[e] = m; yrsP[e] = yrs;
        if (yrs >= K.MIN_YEARS && m >= K.MIN_VALUES) {
          bytes.sort((a, b) => a - b);                        // lut is increasing, so this is the order of the values
          const s = Float32Array.from(bytes, b => lut[b]);
          const km = Math.floor((m - 1) * 0.5), kp = Math.floor((m - 1) * 0.9), med = quantile(s, m, 0.5);
          const dev = bytes.map(b => ({ b, v: Math.fround(Math.abs(lut[b] - med)) })).sort((a, b) => a.v - b.v);
          mA[e] = bytes[km]; mB[e] = bytes[Math.min(km + 1, m - 1)];
          pA[e] = bytes[kp]; pB[e] = bytes[Math.min(kp + 1, m - 1)];
          dA[e] = dev[km].b;  dB[e] = dev[Math.min(km + 1, m - 1)].b;
        }
      }
      /* Decode this bin exactly as the page will, and compare with the reference. */
      const R = D.decodeBaselineBin({ Y, n, mA, mB, pA, pB, dA, dB, yrs: yrsP, cnt }, yi, bin);
      for (let c = 0; c < n; c++) {
        checked++;
        const same = (a, b) => a === b || (a !== a && b !== b);
        if (!same(R.med[c], B.med[c]) || !same(R.p90[c], B.p90[c]) || !same(R.sig[c], B.sig[c]) || R.cnt[c] !== B.cnt[c] || R.yrs[c] !== B.yrs[c]) bad++;
      }
    }
    process.stdout.write('  MY' + yy.my + ' done\n');
  });
  if (bad) { console.error(bad + ' of ' + checked + ' baselines did not match dust.js. Nothing written.'); process.exit(1); }

  /* Store the second byte of each pair as a difference from the first, then every plane as differences
     from the previous entry: mostly zeros, which gzip packs tightly. */
  const rel = (a, b) => Uint8Array.from(b, (v, i) => (v - a[i]) & 255);
  const delta = a => { const o = new Uint8Array(a.length); let prev = 0; for (let i = 0; i < a.length; i++) { o[i] = (a[i] - prev) & 255; prev = a[i]; } return o; };
  const planes = [mA, rel(mA, mB), pA, rel(pA, pB), dA, rel(dA, dB), yrsP,
                  Uint8Array.from(cnt, v => v & 255), Uint8Array.from(cnt, v => v >> 8)];
  const gz = zlib.gzipSync(Buffer.concat(planes.map(p => Buffer.from(delta(p)))), { level: 9 });

  const out = {
    format: 'marswalk-dust-baselines', version: 1, built: new Date().toISOString(),
    fingerprint: fingerprint,                  // data pack + baseline settings this file was built from
    years: P.years.map(y => y.my), bins: bins, n: n,
    has: has.map(r => r.join('')),             // per year, which Ls bins are stored (1) or not (0)
    planes: ['medA', 'medB-medA', 'p90A', 'p90B-p90A', 'madA', 'madB-madA', 'yrs', 'cntLo', 'cntHi'],
    data: gz.toString('base64')
  };
  fs.writeFileSync(outPath,
    '/* Marswalk dust baselines. Written by build_dust_baselines.js on ' + out.built.slice(0, 10) + '; do not edit by hand.\n' +
    ' * The seasonal baseline of every cell, Ls bin and Martian Year, precomputed so the page does not have to.\n' +
    ' * If this file is missing or out of date the page computes the same values itself. */\n' +
    'window.MARSWALK_DUST_BASELINES = ' + JSON.stringify(out) + ';\n');
  console.log('Checked ' + checked + ' baselines: all identical to dust.js.');
  console.log('Wrote ' + path.relative(process.cwd(), outPath) + ' (' + (fs.statSync(outPath).size / 1e6).toFixed(1) + ' MB) in ' + Math.round((Date.now() - t0) / 1000) + ' s.');
}).catch(e => { console.error(e); process.exit(1); });
