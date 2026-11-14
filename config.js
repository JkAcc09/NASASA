/* config.js — every number and every map layer in one place.
 *
 * To add a NASA Trek layer: copy one entry in LAYERS, change `id` to the layer's name on
 * https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars and set `nz` to the deepest zoom
 * the server really has for it. Nothing else in the code needs to change.
 */
window.MW = window.MW || {};

MW.config = {
  /* ---- Mars and the walker ---- */
  R_MARS: 3396190,            // m, IAU Mars 2000 reference radius
  MARS_HOUR: 88775 / 24,      // s in one Mars hour
  WALK: 1.2,                  // m/s, a brisk suited walking pace
  START_HOUR: 10,             // local solar time when a walk begins
  RAD_RATE: 0.67e3 / 24,      // µSv/h, RAD surface average of 0.67 mSv/day (Hassler et al. 2014)

  /* ---- trail ---- */
  SAMPLE: 1.5,                // m between stored trail points
  CELL: 3,                    // m, size of the spatial-index cells
  NEAR: 2.5,                  // m, "the same ground"
  REVISIT_GAP: 12,            // m walked away before coming back counts as a new pass

  /* ---- choices offered in Settings (js/settings.js). The first of each is the default. ---- */
  TRAIL_PALETTES: {               // four shades each: passed once, twice, 3 times, 4 or more
    magenta: ['#FFC2E2', '#FF5FB0', '#D4148C', '#6E0A63'],
    cyan:    ['#C9F5FF', '#5CD3F5', '#0E9BC9', '#06486B'],
    lime:    ['#E9FBB5', '#B6E64C', '#6FAE12', '#34590A'],
    orange:  ['#FFE3BF', '#FFAB52', '#E8590C', '#7A2E06'],
    white:   ['#FFFFFF', '#CFCFCF', '#8C8C8C', '#3A3A3A']
  },
  POINTER_COLOURS: { blue: '#0B5FFF', yellow: '#FFD400', green: '#19C37D', red: '#E5263A', white: '#FFFFFF' },
  THEMES: {                       // name shown in Settings; colours live in css/style.css under body[data-theme]
    blue: 'Blue', night: 'Night blue', grey: 'Grey'
  },
  DISPLAYS: { planner: 'Planner', astronaut: 'Astronaut', robot: 'Robot' },
  MOVES: { hybrid: 'Keys and taps', keys: 'Keys only', click: 'Taps only' },
  DEFAULT_WALKERS: [{ id: 'w1', name: 'Astronaut 1', type: 'astronaut' }, { id: 'w2', name: 'Rover 1', type: 'robot' }],

  /* ---- NASA Mars Trek tiles ---- */
  TREK: 'https://trek.nasa.gov/tiles/Mars/EQ/',
  TREK_PATH: '/1.0.0/default/default028mm/',     // then {z}/{y}/{x}.{ext}

  /* Photo base map: three real resolutions, each drawn only where it is the best available. */
  BASE: [
    { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', nz: 7, opts: { maxZoom: 11 } },
    { id: 'Gale_CTX_BlockAdj_dd', ext: 'png', nz: 12, opts: { minZoom: 8, bounds: [[-6.57, 135.18], [-2.81, 139.24]] } },
    { id: 'curiosity_hirise_mosaic', ext: 'png', nz: 16, opts: { minZoom: 12, bounds: [[-4.9254, 137.1225], [-4.2490, 137.7298]] } }
  ],

  /* Colour ramps, low to high, as [r, g, b] stops. */
  RAMPS: {
    heat:   [[27, 42, 107], [44, 140, 153], [242, 233, 160], [232, 134, 46], [139, 26, 26]],
    amount: [[255, 247, 188], [254, 196, 79], [217, 95, 14], [102, 37, 6]],
    grey:   [[20, 20, 20], [240, 240, 240]],
    mola:   [[59, 42, 140], [46, 127, 208], [63, 191, 106], [242, 226, 74], [232, 138, 46], [192, 57, 43], [139, 90, 60], [242, 242, 242]]
  },

  /* Data layers drawn over the photo map. One is shown at a time.
   *   id, ext, nz   Trek layer name, tile file type, deepest real zoom
   *   res           what one native pixel covers, shown beside the name
   *   read          how a pixel becomes a number: 'grey' (brightness), 'hue' (NASA rainbow,
   *                 violet = low, red = high), 'rgb' (three separate channels), or absent
   *   ramp          recolour with this ramp from RAMPS; absent = keep NASA's own colours
   *   stretch       true = spread the colours over the range inside the current view
   *   legend        ramp used for the legend bar when the layer is not recoloured
   *   ends          words for the low and high end of the bar
   *   what          the quantity, used in the readout under the map
   */
  LAYERS: [
    { key: 'none', name: 'Photo map only', res: '0.6 m',
      note: 'MRO HiRISE at 0.6 m per pixel on site, CTX at 10 m around it, Viking colour beyond the crater.' },

    { group: 'Thermal' },
    { key: 'ir-day', name: 'Daytime infrared', id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', nz: 9, res: '100 m',
      read: 'grey', ramp: 'heat', stretch: true, ends: ['cooler', 'warmer'], what: 'afternoon ground warmth',
      note: 'Mars Odyssey THEMIS, afternoon surface temperature. Warm ground is sun-facing slope or dark sand.' },
    { key: 'ir-night', name: 'Night infrared', id: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', nz: 9, res: '100 m',
      read: 'grey', ramp: 'heat', stretch: true, ends: ['cooler', 'warmer'], what: 'pre-dawn ground warmth',
      note: 'Mars Odyssey THEMIS, surface temperature before dawn. Ground that stays warm is rock. Ground that goes cold is loose dust or sand: softer footing.' },

    { group: 'Topographic' },
    { key: 'topo', name: 'Colour elevation', id: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', ext: 'jpg', nz: 8, res: '200 m',
      legend: 'mola', ends: ['lower', 'higher'], what: 'height',
      note: 'MGS MOLA laser altimetry blended with Mars Express HRSC stereo, in NASA\'s own colours with hill shading. The readout under the map gives the surveyed height in metres.' },
    { key: 'shade', name: 'Shaded relief', id: 'Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw', ext: 'jpg', nz: 8, res: '200 m',
      legend: 'grey', ends: ['in shadow', 'lit'],
      note: 'The same MOLA and HRSC terrain lit from one side, without colour. It shows shape, not a measured quantity.' },

    { group: 'Spectral and chemical' },
    { key: 'cpx', name: 'Clinopyroxene', id: 'TES_Clinopyroxene', ext: 'png', nz: 1, res: '3 km', regional: true,
      read: 'hue', ramp: 'amount', ends: ['less', 'more'], what: 'clinopyroxene',
      note: 'MGS TES mineral map from thermal-emission spectra: a volcanic (basaltic) mineral.' },
    { key: 'plag', name: 'Plagioclase', id: 'TES_Plagioclase', ext: 'png', nz: 1, res: '3 km', regional: true,
      read: 'hue', ramp: 'amount', ends: ['less', 'more'], what: 'plagioclase',
      note: 'MGS TES mineral map: feldspar, the other main ingredient of Martian basalt.' },
    { key: 'clay', name: 'Glass and clay', id: 'TES_Glass_Clay', ext: 'png', nz: 1, res: '3 km', regional: true,
      read: 'hue', ramp: 'amount', ends: ['less', 'more'], what: 'glass and clay',
      note: 'MGS TES map of high-silica glass and sheet silicates: where water has altered the rock.' },
    { key: 'albedo', name: 'Albedo', id: 'Mars_MGS_TES_Albedo_mosaic_global_7410m', ext: 'png', nz: 1, res: '7 km', regional: true,
      read: 'grey', ramp: 'amount', ends: ['darker', 'brighter'], what: 'surface brightness (albedo)',
      note: 'MGS TES. How much sunlight the surface reflects. Bright is dusty, dark is bare rock or sand.' },

    { group: 'Geophysical: surface properties' },
    { key: 'ti', name: 'Thermal inertia', id: 'TES_Thermal_Inertia', ext: 'png', nz: 1, res: '3 km', regional: true,
      read: 'hue', ramp: 'amount', ends: ['fine dust', 'solid rock'], what: 'thermal inertia',
      note: 'MGS TES. How slowly the ground changes temperature: high means bedrock or coarse material, low means fine dust.' },
    { key: 'dust', name: 'Dust cover', id: 'TES_Dust', ext: 'png', nz: 1, res: '3 km', regional: true,
      read: 'hue', ramp: 'amount', ends: ['less dust', 'more dust'], what: 'dust cover',
      note: 'MGS TES dust cover index: how thick the dust coating is on the surface.' },
    { key: 'rough', name: 'Roughness', id: 'mola_roughness', ext: 'png', nz: 1, res: '~1 km', regional: true,
      read: 'rgb', legend: 'grey', ends: ['smoother', 'rougher'], what: 'roughness',
      note: 'MGS MOLA. NASA\'s map mixes three measurements as red, green and blue: height variation over long, medium and short distances. Brighter is rougher.' }
  ],
  REGIONAL_NOTE: ' Regional layer: Trek serves it at about 20 km per pixel, so the whole walk has one value. Press Crater or Planet to see its pattern.',

  /* Quantities measured at each stop of the reference route, used to colour the stops. */
  ROUTE_VARS: [
    { key: 'none', name: 'Plain stops' },
    { key: 'z', name: 'Elevation', unit: ' m', get: function (w) { return w.z; } },
    { key: 'tmax', name: 'Air temperature, daily high', unit: ' °C', get: function (w) { return w.wx.tmax; } },
    { key: 'tmin', name: 'Air temperature, nightly low', unit: ' °C', get: function (w) { return w.wx.tmin; } },
    { key: 'gmax', name: 'Ground temperature, daily high', unit: ' °C', get: function (w) { return w.wx.gmax; } },
    { key: 'p', name: 'Air pressure', unit: ' Pa', get: function (w) { return w.wx.p; } },
    { key: 'uv', name: 'UV index', unit: '', get: function (w) { return w.wx.uv; } }
  ],
  VIRIDIS: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]
};
