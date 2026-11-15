/* globe.js — MW.globe: the start screen's scene. Mars and Phobos turn, and the Mars Reconnaissance Orbiter flies a
 * tilted ring round the planet, in front of it for half the orbit and hidden behind it for the other half.
 *
 * WHY IT RUNS IN A WORKER. While the start screen shows, the page is busy: it parses 6 MB of scripts, unpacks the
 * terrain and dust records and builds the map. Drawn on the page, the scene would stop whenever that work runs (it did,
 * for about ten seconds). So the scene is drawn in a Web Worker of its own, on an OffscreenCanvas: the page hands it
 * the canvas and the three pictures once, and from then on the worker draws every frame by itself, whatever the page
 * is doing. Where a browser cannot do that (no OffscreenCanvas, or no WebGL inside a worker) the same code runs on the
 * page instead. This file loads straight after the start screen's markup, before the app's scripts, so the scene is
 * up within a moment of opening.
 *
 * It is also cheap to draw, so a modest graphics chip keeps up while the map loads beside it:
 *   - each body is drawn only inside its own box (scissor), not over the whole screen, and only that area is cleared;
 *   - the resolution follows the frame rate: if frames take too long it steps down (to 60 % at most) and back up
 *     again when there is room. The canvas is stretched to fit, so the layout never changes.
 *   - the relief is already in mars-color.jpg (make_art.py), so nothing is computed from the terrain at start.
 *
 * Pictures (all NASA 3D Resources, public domain): mars-color.jpg (Viking colour mosaic with MOLA relief shaded in),
 * phobos.jpg, mro.webp. They are the <img> elements #art-mars, #art-phobos and #art-sat in index.html.
 *
 *   MW.globe.ready      a Promise: true once the scene shows, false if it cannot (no WebGL: the painted planet stays)
 *   MW.globe.stop()     stop drawing and free the GPU memory (intro.js, once the app is in view)
 *   MW.globe.layout(w, h)   where the planet sits: { x, y, r } in CSS px (style.css --px, --py, --pr say the same)
 *   MW.globe.view       { worker, fps, scale }: how it is running
 */
window.MW = window.MW || {};
(function () {
  'use strict';
  var ORBIT = { a: 1.42, b: 0.44, tilt: -24, period: 56, phase: 0.55 };     // MRO's ring, in Mars radii, and seconds per turn
  function layout(w, h) {
    if (w / h >= 1.15) return { x: 0.30 * w, y: 0.49 * h, r: Math.min(0.32 * h, 0.22 * w) };     // wide: Mars on the left
    return { x: 0.5 * w, y: 0.25 * h, r: Math.min(0.34 * w, 0.17 * h) };                         // tall: above the words
  }

  /* ================================================================ the renderer: the same code in a worker or on the page.
     It knows nothing of the page: it is told the canvas, the pictures, the size and the layout, and it says when the
     first frame is up ('ready'), how fast it runs ('stats'), or that it cannot draw ('error'). */
  function RENDERER(post) {
    var DEG = Math.PI / 180, gl = null, cv = null, P = {}, T = {}, B = {}, alive = false, t0 = 0, W = 0, H = 0, dpr = 1, scale = 1, L = null, O = null, reduce = false;
    var sat = { w: 1, h: 1 }, tag = { w: 1, h: 1 }, ema = 16, slowN = 0, fastN = 0, frames = 0, statT = 0, lastTs = 0, sent = false, gap = 0;
    var raf = typeof requestAnimationFrame === 'function' ? function (f) { return requestAnimationFrame(f); } : function (f) { return setTimeout(function () { f(performance.now()); }, 16); };
    var noraf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout, rafId = 0;

    var SPHERE_VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
    var SPHERE_FS = [
      'precision highp float;',
      'uniform vec2 C;uniform float R,tl,ln,haze;uniform sampler2D tm;',
      'const float PI=3.14159265;',
      'void main(){',
      ' float th=tan(asin(1./3.2));',
      ' vec2 p=(gl_FragCoord.xy-C)/R*th;',
      ' vec3 o=vec3(0.,0.,3.2),d=normalize(vec3(p,-1.));',
      ' float b=dot(o,d),c=dot(o,o)-1.,h=b*b-c;',
      ' vec3 Ls=normalize(vec3(.62,.38,.69));',
      ' float closest=length(o-d*b);',
      ' if(h>0.){',
      '  vec3 n=normalize(o+d*(-b-sqrt(h)));',
      '  float cs=cos(tl),sn=sin(tl);',
      '  vec3 q=vec3(n.x,n.y*cs+n.z*sn,-n.y*sn+n.z*cs);',
      '  float lat=asin(clamp(q.y,-1.,1.)),lon=ln+atan(q.x,q.z);',
      '  vec3 base=texture2D(tm,vec2(fract((lon/PI+1.)*.5),.5-lat/PI)).rgb;',
      '  float lit=smoothstep(-.1,.6,dot(n,Ls)),rim=pow(1.-max(dot(n,-d),0.),2.5);',
      '  gl_FragColor=vec4(base*(.035+1.02*lit)+vec3(1.,.58,.38)*rim*.45*lit*haze,1.);',
      ' } else if(haze>0.){',
      '  float g=1.-smoothstep(1.,1.08,closest);',
      '  float a2=g*g*.6*clamp(dot(normalize(o-d*b),Ls)*.9+.35,0.,1.);',
      '  gl_FragColor=vec4(vec3(1.,.56,.36),a2);',
      ' } else discard;',
      '}'].join('\n');
    var SPRITE_VS = 'attribute vec2 a;uniform vec2 V,C,S;uniform float rot;varying vec2 uv;' +
      'void main(){vec2 q=a*S;float c=cos(rot),s=sin(rot);vec2 p=C+vec2(q.x*c-q.y*s,q.x*s+q.y*c);uv=a+.5;gl_Position=vec4(p.x/V.x*2.-1.,1.-p.y/V.y*2.,0.,1.);}';
    var SPRITE_FS = 'precision mediump float;uniform sampler2D tm;uniform float k,al;varying vec2 uv;void main(){vec4 c=texture2D(tm,uv);gl_FragColor=vec4(c.rgb*k,c.a)*al;}';
    var LINE_VS = 'attribute vec3 a;uniform vec2 V;varying float t;void main(){t=a.z;gl_Position=vec4(a.x/V.x*2.-1.,1.-a.y/V.y*2.,0.,1.);}';
    var LINE_FS = 'precision mediump float;uniform vec4 col;uniform float dash;varying float t;void main(){if(fract(t*dash)>.42)discard;gl_FragColor=col;}';

    function compile(vs, fs, names) {
      var p = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(function (x) {
        var s = gl.createShader(x[0]); gl.shaderSource(s, x[1]); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s);
      });
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = { p: p, a: gl.getAttribLocation(p, 'a') }; names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); }); return u;
    }
    function texture(unit, src, premult) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premult);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function tagPicture() {                                             // the small "MRO" label, drawn once
      var w = 92, h = 38, c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d'); g.fillStyle = 'rgba(6,12,20,0.78)'; g.strokeStyle = 'rgba(92,200,255,0.6)'; g.lineWidth = 2;
      g.beginPath(); if (g.roundRect) g.roundRect(1, 1, w - 2, h - 2, 8); else g.rect(1, 1, w - 2, h - 2); g.fill(); g.stroke();
      g.fillStyle = '#9BDDFF'; g.font = '600 22px ui-monospace, "SF Mono", Menlo, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('M R O', w / 2, h / 2 + 1); tag.w = w / 2; tag.h = h / 2; return c;
    }
    function ringPoint(phi) {                                           // CSS px, and depth: +1 nearest the viewer
      var x = Math.cos(phi) * O.a * L.r, y = Math.sin(phi) * O.b * L.r, c = Math.cos(O.tilt * DEG), s = Math.sin(O.tilt * DEG);
      return { x: L.x + x * c - y * s, y: L.y + x * s + y * c, z: Math.sin(phi) };
    }
    function ringBuffers() {                                            // the ring's back half and front half, as dashed lines
      ['back', 'front'].forEach(function (part, k) {
        var v = [], N = 72;
        for (var i = 0; i <= N; i++) { var phi = (k ? 0 : Math.PI) + i / N * Math.PI, p = ringPoint(phi); v.push(p.x, p.y, phi / (2 * Math.PI)); }
        if (!B[part]) B[part] = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, B[part]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); B[part].n = N + 1;
      });
    }
    function size() {
      var px = Math.min(dpr, 1.5) * scale, w = Math.max(1, Math.round(W * px)), h = Math.max(1, Math.round(H * px));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      return px;
    }
    function scissor(px, x0, y0, x1, y1) {                             // a box in CSS px (y down) as a scissor in device px (y up)
      var a = Math.max(0, Math.floor(x0 * px)), b = Math.max(0, Math.floor((H - y1) * px)), c = Math.min(cv.width, Math.ceil(x1 * px)), d = Math.min(cv.height, Math.ceil((H - y0) * px));
      gl.scissor(a, b, Math.max(0, c - a), Math.max(0, d - b));
    }
    function sphere(px, unit, x, y, r, tilt, lon, haze) {
      var m = haze ? 1.09 : 1.02; scissor(px, x - r * m, y - r * m, x + r * m, y + r * m);
      gl.useProgram(P.s.p); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.tri); gl.enableVertexAttribArray(P.s.a); gl.vertexAttribPointer(P.s.a, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(P.s.tm, unit); gl.uniform2f(P.s.C, x * px, (H - y) * px); gl.uniform1f(P.s.R, r * px);
      gl.uniform1f(P.s.tl, tilt * DEG); gl.uniform1f(P.s.ln, lon * DEG); gl.uniform1f(P.s.haze, haze);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function sprite(px, unit, x, y, w, h, rot, k, al) {
      var e = Math.hypot(w, h) / 2 + 2; scissor(px, x - e, y - e, x + e, y + e);
      gl.useProgram(P.q.p); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.quad); gl.enableVertexAttribArray(P.q.a); gl.vertexAttribPointer(P.q.a, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(P.q.tm, unit); gl.uniform2f(P.q.V, W, H); gl.uniform2f(P.q.C, x, y); gl.uniform2f(P.q.S, w, h); gl.uniform1f(P.q.rot, rot);
      gl.uniform1f(P.q.k, k); gl.uniform1f(P.q.al, al);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function ring(px, part, a) {
      var bx = L.r * O.a * 1.1 + 4; scissor(px, L.x - bx, L.y - bx, L.x + bx, L.y + bx);
      gl.useProgram(P.l.p); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, B[part]); gl.enableVertexAttribArray(P.l.a); gl.vertexAttribPointer(P.l.a, 3, gl.FLOAT, false, 0, 0);
      gl.uniform2f(P.l.V, W, H); gl.uniform4f(P.l.col, 0.59, 0.8, 1, a); gl.uniform1f(P.l.dash, 140);
      gl.drawArrays(gl.LINE_STRIP, 0, B[part].n);
    }
    function frame(ts) {
      if (!alive) return;
      rafId = raf(frame);
      var dt = lastTs ? ts - lastTs : 16; lastTs = ts; ema = ema * 0.92 + dt * 0.08; frames++; if (dt > gap) gap = dt;
      /* the resolution follows the frame rate: down 15 % after a second of slow frames, up again after four seconds of fast ones */
      if (ema > 24) { slowN++; fastN = 0; } else if (ema < 17.5) { fastN++; slowN = 0; } else { slowN = fastN = 0; }
      if (slowN > 50 && scale > 0.6) { scale = Math.max(0.6, scale * 0.85); slowN = 0; }
      if (fastN > 240 && scale < 1) { scale = Math.min(1, scale / 0.85); fastN = 0; }
      if (ts - statT > 2000) { post({ type: 'stats', fps: Math.round(1000 / ema), scale: +scale.toFixed(2), gap: Math.round(gap), frames: frames }); statT = ts; gap = 0; }
      var t = reduce ? 0 : (ts - t0) / 1000, px = size();
      gl.viewport(0, 0, cv.width, cv.height);
      var bx = Math.max(L.r * O.a * 1.2, L.r * 1.1) + 60;                  // everything that moves stays inside this box
      gl.enable(gl.SCISSOR_TEST); scissor(px, L.x - bx, L.y - bx, L.x + bx, L.y + bx); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      /* Phobos: an orbit seen nearly edge-on, 1.9 Mars radii out (it is really 2.8), a fifteenth of Mars' size */
      var a = (t / 40) * 2 * Math.PI + 0.9, ox = Math.cos(a) * 1.9, oz = Math.sin(a) * 1.9, oy = Math.sin(a) * 0.22 - Math.cos(a) * 0.12, tl = -16 * DEG;
      var ph = { z: oz, draw: function () { if (T.phobos) sphere(px, 1, L.x + L.r * (ox * Math.cos(tl) - oy * Math.sin(tl)), L.y - L.r * (ox * Math.sin(tl) + oy * Math.cos(tl)), L.r * 0.075 * (1 + oz * 0.06), 0, -a / DEG + 90, 0); } };
      /* MRO on its ring, larger and brighter when near */
      var phi = O.phase + (reduce ? 0 : t / O.period * 2 * Math.PI), p = ringPoint(phi), k = 0.82 + 0.22 * p.z, sw = L.r * 0.82 * k, sh = sw * sat.h / sat.w;
      var mro = { z: p.z, draw: function () {
        if (!T.sat) return;
        sprite(px, 2, p.x, p.y, sw, sh, (-10 + 7 * Math.cos(phi)) * DEG, Math.min(1, 0.55 + 0.45 * Math.max(0, p.z + 0.4)), 1);
        var side = p.x > L.x ? -1 : 1;                                  // the label on the outer side, away from the words
        if (p.z > 0) sprite(px, 3, p.x + side * (sw * 0.42 + tag.w / 2), p.y - sw * 0.5 + tag.h / 2, tag.w, tag.h, 0, 1, Math.min(1, p.z * 4));
      } };
      var back = [ph, mro].filter(function (o) { return o.z < 0; }).sort(function (x, y) { return x.z - y.z; });
      var front = [ph, mro].filter(function (o) { return o.z >= 0; }).sort(function (x, y) { return x.z - y.z; });
      back.forEach(function (o) { o.draw(); });
      ring(px, 'back', 0.24);
      sphere(px, 0, L.x, L.y, L.r, 14, (30 + 3.6 * t) % 360, 1);
      ring(px, 'front', 0.5);
      front.forEach(function (o) { o.draw(); });
      if (!sent) { sent = true; post({ type: 'ready' }); }
    }
    function init(m) {
      try {
        cv = m.canvas; W = m.w; H = m.h; dpr = m.dpr; L = m.layout; O = m.orbit; reduce = m.reduce;
        gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false });
        if (!gl) throw new Error('no WebGL here');
        P.s = compile(SPHERE_VS, SPHERE_FS, ['C', 'R', 'tl', 'ln', 'haze', 'tm']);
        P.q = compile(SPRITE_VS, SPRITE_FS, ['V', 'C', 'S', 'rot', 'tm', 'k', 'al']);
        P.l = compile(LINE_VS, LINE_FS, ['V', 'col', 'dash']);
        B.tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, B.tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        B.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, B.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
        gl.enable(gl.BLEND);
        T.mars = texture(0, m.mars, false);
        if (m.phobos) T.phobos = texture(1, m.phobos, false);
        if (m.sat) { T.sat = texture(2, m.sat, true); sat.w = m.sat.width; sat.h = m.sat.height; }
        T.tag = texture(3, tagPicture(), true);
        [m.mars, m.phobos, m.sat].forEach(function (b) { if (b && b.close) b.close(); });     // the GPU has them now
        ringBuffers(); alive = true; t0 = performance.now(); rafId = raf(frame);
      } catch (e) { post({ type: 'error', message: e.message }); }
    }
    function stop() {
      alive = false; noraf(rafId);
      if (gl) { Object.keys(T).forEach(function (k) { gl.deleteTexture(T[k]); }); var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); gl = null; }
    }
    return function (m) {
      if (m.type === 'init') init(m);
      else if (m.type === 'resize') { W = m.w; H = m.h; dpr = m.dpr; L = m.layout; if (gl) ringBuffers(); }
      else if (m.type === 'stop') stop();
    };
  }

  /* ================================================================ the page's side */
  var view = { worker: false, fps: 0, scale: 1, colour: false, running: false }, send = null, worker = null, settle;
  var ready = new Promise(function (r) { settle = r; });
  function onMessage(m) {
    if (m.type === 'ready') { view.running = true; settle(true); }
    else if (m.type === 'stats') { view.fps = m.fps; view.scale = m.scale; view.gap = m.gap; view.frames = m.frames; view.worstGap = Math.max(view.worstGap || 0, m.gap); }
    else if (m.type === 'error') { if (worker) fallback(m.message); else settle(false); }
  }
  function loaded(img) {
    if (!img) return Promise.resolve(null);
    var ok = img.complete && img.naturalWidth ? Promise.resolve() : new Promise(function (res, rej) { img.addEventListener('load', res, { once: true }); img.addEventListener('error', rej, { once: true }); });
    return ok.then(function () { return img.naturalWidth ? img : null; }, function () { return null; });
  }
  function bitmap(img, premult) {                                         // decoded off the page's thread where the browser can
    if (!img) return Promise.resolve(null);
    if (typeof createImageBitmap !== 'function') return Promise.resolve(img);
    return createImageBitmap(img, { premultiplyAlpha: premult ? 'premultiply' : 'none' }).catch(function () { return img; });
  }
  var canvas = null, pics = null;
  function message(extra) {
    var w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    var m = { w: w, h: h, dpr: window.devicePixelRatio || 1, layout: layout(w, h) };
    for (var k in extra) m[k] = extra[k];
    return m;
  }
  function onPage(why) {                                                  // the same renderer, on the page's own thread
    view.worker = false; view.why = why || '';
    var handle = RENDERER(function (m) { onMessage(m); });
    send = function (m) { handle(m); };
    Promise.all([bitmap(pics[0]), bitmap(pics[1]), bitmap(pics[2], true)]).then(function (b) {
      send(message({ type: 'init', canvas: canvas, mars: b[0], phobos: b[1], sat: b[2], orbit: ORBIT, reduce: reduceMotion() }));
    });
  }
  function fallback(why) {                                                // the worker could not draw: give the page a fresh canvas
    if (worker) { worker.terminate(); worker = null; }
    var fresh = canvas.cloneNode(false); canvas.parentNode.replaceChild(fresh, canvas); canvas = fresh;
    onPage(why);
  }
  function reduceMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function start() {
    canvas = document.getElementById('intro-globe');
    if (!canvas || /[?&]intro=0\b/.test(location.search)) { settle(false); return; }
    loaded(document.getElementById('art-mars')).then(function (mars) {
      if (!mars) { settle(false); return; }                                // no picture: the painted planet stays
      view.colour = true;
      pics = [mars, document.getElementById('art-phobos'), document.getElementById('art-sat')];
      return Promise.all([loaded(pics[1]), loaded(pics[2])]).then(function (r) {
        pics[1] = r[0]; pics[2] = r[1];
        var canWork = typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function' && 'transferControlToOffscreen' in canvas;
        if (!canWork) { onPage('no OffscreenCanvas'); return; }
        try {
          var src = 'var handle=(' + RENDERER.toString() + ')(function(m){postMessage(m);});onmessage=function(e){handle(e.data);};';
          worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        } catch (e) { onPage('no worker: ' + e.message); return; }
        worker.onmessage = function (e) { onMessage(e.data); };
        worker.onerror = function (e) { e.preventDefault(); fallback('worker failed'); };
        view.worker = true;
        Promise.all([bitmap(pics[0]), bitmap(pics[1]), bitmap(pics[2], true)]).then(function (b) {
          if (!worker) return;
          var off = canvas.transferControlToOffscreen();
          send = function (m, tr) { if (worker) worker.postMessage(m, tr || []); };
          send(message({ type: 'init', canvas: off, mars: b[0], phobos: b[1], sat: b[2], orbit: ORBIT, reduce: reduceMotion() }), [off].concat(b.filter(function (x) { return x && x.close; })));
        });
      });
    }).catch(function (e) { if (window.console) console.warn('Start screen scene not drawn: ' + e.message); settle(false); });
    window.addEventListener('resize', function () { if (send) send(message({ type: 'resize' })); });
  }
  function stop() {
    if (send) send({ type: 'stop' });
    if (worker) { var w = worker; worker = null; setTimeout(function () { w.terminate(); }, 100); }
    send = null; view.running = false;
  }
  MW.globe = { ready: ready, stop: stop, layout: layout, orbit: ORBIT, view: view, get running() { return view.running; } };
  start();
})();
