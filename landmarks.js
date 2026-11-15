/* landmarks.js — MW.landmarks: the named places, their outlines, and the label layer.
 *
 * To add a landmark, add one entry to LIST:
 *   name, rank     rank 1 = most important (largest label, shown first), 2, 3
 *   role           what the place is for a walker ("Landing site", "Hazard: soft sand" …)
 *   shape          one of
 *                    { point: [lat, lon] }
 *                    { circle: [lat, lon], km: diameter }
 *                    { ellipse: [lat, lon], km: [long axis, short axis], turn: degrees clockwise from east }
 *                    { hull: 'x,y x,y …' }  corner list, lon = 137 + x/1e5, lat = -4 + y/1e5
 *                    { route: true }        the ground covered by the reference route in data.js
 *   minZoom        points only: the zoom from which the name shows (default depends on rank)
 *   size           text shown as the size
 *   missions       surface missions that have been there: [count, 'who and when']
 *   note           one or two plain sentences
 *
 * Hull outlines are not geological boundaries. They are the ground Curiosity actually covered in
 * that place (from its position fixes, NASA MSL_waypoints.json), widened by a 25 m margin.
 * Circles and ellipses are approximate, from the IAU gazetteer centre and diameter.
 *
 * Labels follow map conventions: higher rank and larger places appear first and in larger type;
 * a name disappears once its place is too small to matter at this zoom, or has grown bigger than
 * the screen; names never overlap, the higher rank wins.
 */
(function () {
  'use strict';
  var G = MW.geo, DEG = G.DEG, M = G.M_PER_DEG;
  var CUR = 'Curiosity, sols ';

  var LIST = [
    /* ---- the planet ---- */
    { name: 'Olympus Mons', rank: 1, role: 'Shield volcano', shape: { circle: [18.65, -133.8], km: 610 }, size: '610 km across, about 22 km high',
      missions: [0, 'no surface mission'], note: 'The tallest known volcano in the Solar System. Its summit is above most of the atmosphere.' },
    { name: 'Valles Marineris', rank: 1, role: 'Canyon system', shape: { ellipse: [-13.9, -59.2], km: [3760, 600], turn: 8 }, size: 'about 3,760 km long, up to 7 km deep',
      missions: [0, 'no surface mission'], note: 'A canyon system as long as the United States is wide. Steep walls and landslides make it hard ground.' },
    { name: 'Hellas Planitia', rank: 1, role: 'Impact basin', shape: { circle: [-42.4, 70.5], km: 2300 }, size: '2,300 km across, about 7 km deep',
      missions: [0, 'no surface mission'], note: 'The deepest basin on Mars, so it has the highest air pressure on the planet.' },
    { name: 'Utopia Planitia', rank: 2, role: 'Lowland plain', shape: { circle: [46.7, 117.5], km: 3300 }, size: '3,300 km across',
      missions: [2, 'Viking 2 (1976), Zhurong (2021)'], note: 'The largest recognised impact basin on Mars. Buried ice lies under much of the plain.' },
    { name: 'Chryse Planitia', rank: 2, role: 'Lowland plain', shape: { circle: [28.4, -40.3], km: 1540 }, size: '1,540 km across',
      missions: [2, 'Viking 1 (1976), Mars Pathfinder (1997)'], note: 'A smooth plain where ancient flood channels end. Site of the first successful Mars landing.' },
    { name: 'Elysium Mons', rank: 2, role: 'Shield volcano', shape: { circle: [25.02, 147.21], km: 400 }, size: '400 km across, about 14 km high',
      missions: [0, 'no surface mission'], note: 'The main volcano of the Elysium rise, north of Gale crater.' },
    { name: 'Meridiani Planum', rank: 2, role: 'Plain', shape: { circle: [0.2, -2.5], km: 1060 }, size: 'about 1,060 km across',
      missions: [1, 'Opportunity (2004–2018)'], note: 'Flat plain rich in the iron mineral hematite, a sign of past water. Opportunity drove 45 km here.' },
    { name: 'Gusev crater', rank: 2, role: 'Impact crater', shape: { circle: [-14.53, 175.52], km: 166 }, size: '166 km across',
      missions: [1, 'Spirit (2004–2010)'], note: 'An old crater once fed by a river valley. Spirit found silica deposits from hot springs here.' },
    { name: 'Jezero crater', rank: 2, role: 'Impact crater with a river delta', shape: { circle: [18.38, 77.58], km: 45 }, size: '45 km across',
      missions: [1, 'Perseverance and Ingenuity (2021–)'], note: 'Held a lake about 3.5 billion years ago. Perseverance is collecting rock samples here.' },
    { name: 'InSight', rank: 3, role: 'Landing site (seismic station)', shape: { point: [4.50, 135.62] }, size: 'a single lander',
      missions: [1, 'InSight (2018–2022)'], note: 'Recorded more than 1,300 marsquakes from the plain of Elysium Planitia, about 600 km north of Gale.' },
    { name: 'Viking 1', rank: 3, role: 'Landing site', shape: { point: [22.27, -47.95] }, size: 'a single lander',
      missions: [1, 'Viking 1 (1976–1982)'], note: 'The first spacecraft to operate on Mars for years.' },
    { name: 'Viking 2', rank: 3, role: 'Landing site', shape: { point: [47.64, 134.29] }, size: 'a single lander',
      missions: [1, 'Viking 2 (1976–1980)'], note: 'Photographed morning frost on the ground in Utopia Planitia.' },
    { name: 'Pathfinder', rank: 3, role: 'Landing site', shape: { point: [19.13, -33.22] }, size: 'a lander and the Sojourner rover',
      missions: [1, 'Mars Pathfinder (1997)'], note: 'Carried Sojourner, the first rover on Mars.' },
    { name: 'Phoenix', rank: 3, role: 'Landing site', shape: { point: [68.22, -125.75] }, size: 'a single lander',
      missions: [1, 'Phoenix (2008)'], note: 'Dug into the arctic soil and touched water ice a few centimetres down.' },
    { name: 'Zhurong', rank: 3, role: 'Landing site', shape: { point: [25.07, 109.93] }, size: 'a lander and rover',
      missions: [1, 'Tianwen-1 Zhurong (2021–2022)'], note: "China's first Mars rover, in southern Utopia Planitia." },

    /* ---- Gale crater ---- */
    { name: 'Gale crater', rank: 1, role: 'Impact crater: the exploration zone', shape: { circle: [-5.4, 137.8], km: 154 }, size: '154 km across',
      missions: [1, 'Curiosity (2012–)'], note: 'About 3.7 billion years old. It held lakes and streams, and its central mountain keeps the record in layers.' },
    { name: 'Aeolis Mons (Mount Sharp)', rank: 1, role: 'Layered mountain: the science goal', shape: { ellipse: [-5.08, 137.85], km: [95, 80], turn: 0 }, size: 'about 90 km across, 5.5 km high',
      missions: [1, 'Curiosity, climbing since 2014'], note: 'Each layer is a later chapter of Mars drying out. The walk on this map is on its lower north-west slope.' },
    { name: 'Aeolis Palus', rank: 2, role: 'Crater-floor plain', shape: { ellipse: [-4.47, 137.42], km: [70, 22], turn: -20 }, size: 'a plain about 70 km long',
      missions: [1, 'Curiosity (2012–2014)'], note: 'The flat ground between the crater wall and the mountain: the easy driving, and the landing zone.' },
    { name: 'Peace Vallis', rank: 3, role: 'Ancient river channel', shape: { ellipse: [-4.21, 137.23], km: [35, 5], turn: -50 }, size: 'about 35 km long',
      missions: [0, 'seen from orbit and from the rover'], note: 'A channel that carried water and gravel down the crater wall into a fan near the landing site.' },
    { name: 'Bradbury Landing', rank: 2, role: 'Landing site', shape: { point: [-4.5895, 137.4417] }, minZoom: 9, size: 'a touchdown point',
      missions: [1, 'Curiosity, landed 6 August 2012'], note: 'Where the sky crane set Curiosity down. Named after the writer Ray Bradbury.' },
    { name: 'Yellowknife Bay', rank: 3, role: 'Science stop: first drill site', shape: { hull: '44873,-59020 44881,-59051 44905,-59038 44927,-59015 44938,-58923 44939,-58914 44912,-58947' }, sols: [125, 324],
      missions: [1, CUR + '125–324'], note: 'Mudstone from an ancient lake bed. The first drilled samples showed water here was once fit for life.' },
    { name: 'The Kimberley', rank: 3, role: 'Science stop: sandstone outcrops', shape: { hull: '40136,-64039 40214,-63957 40290,-63773 40297,-63736 40279,-63690 40250,-63627 40217,-63634' }, sols: [574, 634],
      missions: [1, CUR + '574–634'], note: 'Tilted sandstone beds laid down by rivers flowing towards the mountain.' },
    { name: 'Pahrump Hills', rank: 3, role: 'Science stop: base of the mountain', shape: { hull: '37731,-66359 37750,-66358 37778,-66338 37790,-66319 37752,-66257 37745,-66265 37738,-66284' }, sols: [753, 923],
      missions: [1, CUR + '753–923'], note: 'The first outcrop of Mount Sharp itself: fine lake mudstone, drilled three times.' },
    { name: 'Bagnold Dunes', rank: 2, role: 'Hazard: active sand dunes', shape: { hull: '36554,-67875 36563,-67936 36755,-68022 36802,-68005 36802,-68004 36605,-67631' }, sols: [1162, 1250],
      missions: [1, CUR + '1162–1250'], note: 'Dark dunes that still move about a metre a year. Soft sand: a walker or rover can sink in.' },
    { name: 'Murray Buttes', rank: 3, role: 'Landmark: flat-topped hills', shape: { hull: '35276,-69175 35301,-69520 35372,-69627 35413,-69665 35447,-68718 35358,-68867 35283,-69107' }, sols: [1417, 1470],
      missions: [1, CUR + '1417–1470'], note: 'Buttes and mesas of wind-laid sandstone, up to 15 m high. Easy to recognise from a distance.' },
    { name: 'Vera Rubin Ridge', rank: 2, role: 'Science stop: hematite ridge', shape: { hull: '37249,-72474 37444,-72813 37628,-72982 37957,-72927 38173,-72546 37913,-72392 37275,-72368' }, sols: [1809, 2300],
      missions: [1, CUR + '1809–2300'], note: 'A hard ridge rich in the iron mineral hematite. Tough rock: several drill attempts failed here.' },
    { name: 'Glen Torridon', rank: 2, role: 'Science stop: clay-rich valley', shape: { hull: '38000,-72915 38036,-73612 38084,-73705 39371,-73130 39379,-73016 38410,-72568 38154,-72772' }, sols: [2302, 2950],
      missions: [1, CUR + '2302–2950'], note: 'The valley with the most clay minerals found on the mission: the strongest sign of long-lasting water.' },
    { name: 'Marker Band Valley', rank: 3, role: 'Science stop: ancient lake ripples', shape: { hull: '39471,-76076 39911,-77037 40093,-76963 40154,-76926 39719,-76200 39650,-76109 39526,-76076' }, sols: [3640, 3900],
      missions: [1, CUR + '3640–3900'], note: 'A thin dark rock layer with ripples left by waves on a shallow lake.' },
    { name: 'Gediz Vallis', rank: 2, role: 'Science stop: late flood channel', shape: { hull: '40381,-78229 40720,-78681 40854,-78763 40913,-78732 40943,-78575 40911,-78466 40735,-78012' }, sols: [4100, 4360],
      missions: [1, CUR + '4100–4360'], note: 'A channel cut by late floods and debris flows. Curiosity cracked open rocks of pure sulfur here in 2024.' },
    { name: 'Boxwork', rank: 1, role: 'Science goal of this walk', shape: { route: true }, sols: [4560, 5073],
      missions: [1, CUR + '4560–5073'], note: 'A web of low ridges where groundwater once cemented cracks in the rock. Ridges give firm footing; the hollows between hold sand.' }
  ];

  /* ---------------- geometry ---------------- */
  function hullOf(pts) {                                // convex hull of [lat, lon] points
    var p = pts.slice().sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    var cr = function (o, a, b) { return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]); };
    var lo = [], up = [], i;
    for (i = 0; i < p.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop(); lo.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop(); up.push(p[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function widen(poly, metres) {                        // push each corner away from the middle
    var c = centre(poly), k = Math.cos(c[0] * DEG);
    return poly.map(function (p) {
      var dx = (p[1] - c[1]) * M * k, dy = (p[0] - c[0]) * M, d = Math.hypot(dx, dy) || 1, f = (d + metres) / d;
      return [c[0] + dy * f / M, c[1] + dx * f / (M * k)];
    });
  }
  function centre(poly) { var a = 0, b = 0; poly.forEach(function (p) { a += p[0]; b += p[1]; }); return [a / poly.length, b / poly.length]; }
  function ellipse(c, longKm, shortKm, turn) {
    var out = [], k = Math.cos(c[0] * DEG), t = (turn || 0) * DEG;
    for (var i = 0; i < 48; i++) {
      var a = i / 48 * 2 * Math.PI, x = Math.cos(a) * longKm * 500, y = Math.sin(a) * shortKm * 500;
      var e = x * Math.cos(t) + y * Math.sin(t), n = -x * Math.sin(t) + y * Math.cos(t);
      out.push([c[0] + n / M, c[1] + e / (M * k)]);
    }
    return out;
  }
  function extent(poly) {                               // longest side of the bounding box, metres
    var la = poly.map(function (p) { return p[0]; }), lo = poly.map(function (p) { return p[1]; }), c = centre(poly);
    return Math.max((Math.max.apply(null, la) - Math.min.apply(null, la)) * M, (Math.max.apply(null, lo) - Math.min.apply(null, lo)) * M * Math.cos(c[0] * DEG));
  }

  /* Work out each landmark's outline, centre and size once. */
  LIST.forEach(function (lm, i) {
    var s = lm.shape; lm.id = i;
    if (s.point) { lm.outline = null; lm.at = s.point; lm.metres = 0; lm.outlineNote = ''; return; }
    if (s.circle) { lm.outline = ellipse(s.circle, s.km, s.km, 0); lm.outlineNote = 'Outline: approximate, from the catalogued centre and diameter.'; }
    else if (s.ellipse) { lm.outline = ellipse(s.ellipse, s.km[0], s.km[1], s.turn); lm.outlineNote = 'Outline: approximate.'; }
    else {
      var pts = s.route ? G.WP.map(function (w) { return [w.lat, w.lon]; })
        : s.hull.split(' ').map(function (v) { var a = v.split(','); return [-4 + a[1] / 1e5, 137 + a[0] / 1e5]; });
      lm.outline = widen(hullOf(pts), 25);
      lm.outlineNote = 'Outline: the ground Curiosity covered here, with a 25 m margin. It is not a geological boundary.';
    }
    lm.at = centre(lm.outline); lm.metres = extent(lm.outline);
    if (!lm.size) lm.size = 'explored area about ' + G.fmt(Math.round(lm.metres / 10) * 10) + ' m across';
  });

  function contains(lm, lat, lon) {
    if (!lm.outline) return Math.hypot((lat - lm.at[0]) * M, (lon - lm.at[1]) * M * Math.cos(lat * DEG)) < 30;   // within 30 m of a point
    var p = lm.outline, inside = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][0] > lat) !== (p[j][0] > lat) && lon < (p[j][1] - p[i][1]) * (lat - p[i][0]) / (p[j][0] - p[i][0]) + p[i][1]) inside = !inside;
    }
    return inside;
  }
  /* How many separate times a list of [lat, lon, …] points goes into a landmark. */
  function entries(lm, points) {
    var n = 0, was = false;
    for (var i = 0; i < points.length; i++) { var is = contains(lm, points[i][0], points[i][1]); if (is && !was) n++; was = is; }
    return n;
  }

  /* ---------------- label layer ----------------
     opts.onOpen(lm) is called when a name is tapped. */
  var MIN_PX = { 1: 9, 2: 60, 3: 110 };                // a place needs to be this wide on screen before its name shows
  var POINT_ZOOM = { 1: 2, 2: 4, 3: 5 };                // single points have no size: show from this zoom
  var FONT = { 1: 16, 2: 14, 3: 13 };
  function attach(map, opts) {
    var group = L.layerGroup().addTo(map), markers = LIST.map(function (lm) {
      var el = '<span class="lm-name r' + lm.rank + (lm.outline ? '' : ' pt') + '">' + G.escapeHtml(lm.name) + '</span>';
      var m = L.marker(lm.at, { icon: L.divIcon({ className: 'lm', html: el, iconSize: [0, 0] }), keyboard: true, title: lm.name, alt: lm.name, zIndexOffset: 400 - lm.rank * 100 });
      m.on('click', function (e) { L.DomEvent.stop(e); opts.onOpen(lm); });
      return m;
    });
    function refresh() {
      var z = map.getZoom(), mpp = G.metresPerPixel(z), size = map.getSize(), view = map.getBounds().pad(0.1), placed = [];
      var order = LIST.map(function (lm, i) { return i; }).sort(function (a, b) { return LIST[a].rank - LIST[b].rank || LIST[b].metres - LIST[a].metres; });
      var show = {};
      order.forEach(function (i) {
        var lm = LIST[i], px = lm.metres / mpp;
        var ok = lm.outline ? px >= MIN_PX[lm.rank] && px <= 1.5 * Math.min(size.x, size.y)      // too small to matter, or bigger than the screen
                            : z >= (lm.minZoom || POINT_ZOOM[lm.rank]);
        if (!ok || !view.contains(lm.at)) return;
        var p = map.latLngToContainerPoint(lm.at), w = lm.name.length * FONT[lm.rank] * 0.56 + 12, h = FONT[lm.rank] + 10;
        var box = [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
        if (placed.some(function (b) { return box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]; })) return;   // a more important name is already here
        placed.push(box); show[i] = true;
      });
      markers.forEach(function (m, i) { var on = group.hasLayer(m); if (show[i] && !on) group.addLayer(m); else if (!show[i] && on) group.removeLayer(m); });
    }
    map.on('zoomend moveend', refresh); refresh();
    return { refresh: refresh,
      setVisible: function (on) { if (on) { group.addTo(map); refresh(); } else map.removeLayer(group); } };   // the markers filter can hide the names
  }

  MW.landmarks = { list: LIST, contains: contains, entries: entries, attach: attach };
})();
