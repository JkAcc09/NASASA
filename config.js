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
  POINTER_COLOURS: { cyan: '#5CC8FF', blue: '#0B5FFF', yellow: '#FFD400', green: '#19C37D', red: '#E5263A', white: '#FFFFFF' },
  THEMES: {                       // name shown in Settings; colours live in style.css under body[data-theme]
    console: 'Console', graphite: 'Graphite', ember: 'Ember', aurora: 'Aurora', nebula: 'Nebula',
    red: 'Night red', daylight: 'Daylight', contrast: 'Direct sun'
  },
  THEMES_BEFORE_1_7: {            // the themes of the printed-map look, and the console theme each one now opens as
    blue: 'console', night: 'console', teal: 'aurora', grey: 'graphite', black: 'graphite', sand: 'ember', green: 'aurora', violet: 'nebula'
  },
  READOUTS: [                     // the readouts along the bottom of the screen, ticked on or off in Settings > Display
    { group: 'Position and movement', key: 'pos',   name: 'Position from base',   what: 'how far east and north of base',      on: true },
    { group: 'Position and movement', key: 'll',    name: 'Latitude and longitude', what: 'to six decimal places',             on: false },
    { group: 'Position and movement', key: 'z',     name: 'Height',               what: 'above the MOLA datum',                on: true },
    { group: 'Position and movement', key: 'hdg',   name: 'Bearing',              what: 'which way the walker is facing',     on: true },
    { group: 'Position and movement', key: 'dist',  name: 'Distance travelled',   what: 'since the walk began',                on: true },
    { group: 'Position and movement', key: 'home',  name: 'Displacement from base', what: 'straight line, or back along the trail when Show way back is on',  on: true },
    { group: 'Position and movement', key: 'time',  name: 'Time on the surface',  what: 'and the local time of day',           on: true },
    { group: 'Position and movement', key: 'slope', name: 'Slope here',           what: "along the drive from Curiosity's fixes, otherwise regional", on: true },
    { group: 'Walk budget',           key: 'o2',    name: 'Oxygen left',          what: 'modelled from pace and climb (astronaut)', on: true },
    { group: 'Walk budget',           key: 'batt',  name: 'Battery left',         what: 'modelled; a robot recharges in sunlight', on: true },
    { group: 'Walk budget',           key: 'turn',  name: 'Turn back in',         what: 'time until the way back needs what is left', on: true },
    { group: 'Conditions',            key: 'safety', name: 'Safety index, live',  what: 'how safe it is to be where the walker is now, 0 to 100', on: true },
    { group: 'Conditions',            key: 'probe', name: 'Map layer reading',    what: 'when a map overlay is switched on',   on: true },
    { group: 'Conditions',            key: 'air',   name: 'Air temperature',      what: 'just above the ground',                                  on: true },
    { group: 'Conditions',            key: 'gnd',   name: 'Ground temperature',   what: 'at the surface',                                  on: true },
    { group: 'Conditions',            key: 'p',     name: 'Air pressure',         what: 'of the thin Martian air',               on: true },
    { group: 'Conditions',            key: 'uv',    name: 'UV level',             what: 'low to very high',                    on: true },
    { group: 'Conditions',            key: 'rad',   name: 'Radiation dose rate',  what: 'per hour, from the surface',            on: true },
    { group: 'Conditions',            key: 'dose',  name: 'Dose this walk',       what: 'received so far',                       on: true },
    { group: 'Conditions',            key: 'dust',  name: 'Dust activity',        what: 'dust storm class here and now',       on: true }
  ],
  UNITS: { si: 'SI (metres, °C)', us: 'US (feet, °F)' },
  RO_LAYOUTS: { side: 'Tabs beside the map', focus: 'Numbers first, mini-map' },
  ALARM_LEVELS: [40, 50, 60, 70],   // choices for "alarm when the live safety index is below"; the default is in settings.js
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

    { group: 'Thermal', info: 'thermal' },
    { key: 'ir-day', name: 'Daytime infrared', id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', nz: 9, res: '100 m',
      read: 'grey', ramp: 'heat', stretch: true, ends: ['cooler', 'warmer'], what: 'afternoon ground warmth',
      note: 'Mars Odyssey THEMIS, afternoon surface temperature. Warm ground is sun-facing slope or dark sand.' },
    { key: 'ir-night', name: 'Night infrared', id: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', nz: 9, res: '100 m',
      read: 'grey', ramp: 'heat', stretch: true, ends: ['cooler', 'warmer'], what: 'pre-dawn ground warmth',
      note: 'Mars Odyssey THEMIS, surface temperature before dawn. Ground that stays warm is rock. Ground that goes cold is loose dust or sand: softer footing.' },

    { group: 'Topographic', info: 'elevation' },
    { key: 'topo', name: 'Colour elevation', id: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', ext: 'jpg', nz: 8, res: '200 m',
      legend: 'mola', ends: ['lower', 'higher'], what: 'height',
      note: 'MGS MOLA laser altimetry blended with Mars Express HRSC stereo, in NASA\'s own colours with hill shading. The readout under the map gives the surveyed height in metres.' },
    { key: 'shade', name: 'Shaded relief', id: 'Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw', ext: 'jpg', nz: 8, res: '200 m',
      legend: 'grey', ends: ['in shadow', 'lit'],
      note: 'The same MOLA and HRSC terrain lit from one side, without colour. It shows shape, not a measured quantity.' },

    { group: 'Spectral and chemical', info: 'spectral' },
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

    { group: 'Geophysical: surface properties', info: 'surface' },
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
    { key: 'uv', name: 'UV index', unit: '', get: function (w) { return w.wx.uv; } },
    { key: 'grade', name: 'Slope along the drive', unit: '°', get: function (w) { return Math.round(w.grade * 10) / 10; } }
  ],
  VIRIDIS: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],

  /* ---- Dust storm activity (js/dust.js, js/dust-ui.js). Every threshold of the detection is here. ----
   * Optical depth (tau) is the column dust optical depth in infrared absorption at 9.3 µm, normalised to 610 Pa.
   * The absolute floors are this project's own operating choices, not a published standard: they stop a small
   * rise over a very clear season from being called a storm. Visible-light optical depth is roughly 2.6 times
   * the 9.3 µm absorption value (Montabone et al. 2015), so 0.15 / 0.30 / 0.80 are about 0.4 / 0.8 / 2.1 visible. */
  DUST: {
    LS_BIN: 5,                 // degrees of Ls: the baseline is worked out once per bin of this width
    LS_WINDOW: 10,             // degrees of Ls either side of the bin centre that count as "the same season"
    MIN_YEARS: 3,              // other Martian Years needed at a place and season before a baseline is trusted
    MIN_VALUES: 6,             // observations needed for that baseline
    SIGMA_REL: 0.15,           // the spread used is never smaller than this share of the median...
    SIGMA_ABS: 0.02,           // ...nor than this optical depth (the data's own precision)
    Z: { MODERATE: 2, HIGH: 4, SEVERE: 6 },                 // robust standard deviations above the seasonal median
    FLOOR: { MODERATE: 0.15, HIGH: 0.30, SEVERE: 0.80 },    // and at least this optical depth
    PERSIST_FRAMES: 2,         // consecutive elevated frames that make a rise "persistent" (2 frames = 10 sols)
    PERSIST_SKIP: 2,           // frames without an observation that may be stepped over while counting
    REGION_MIN: 3,             // elevated neighbours (of the 8 around a cell) that make activity "regional"
    TREND_FRAMES: 4,           // frames, ending at the one shown, used for the trend (4 frames = 20 sols)
    TREND_REL: 0.20,           // change over that window, as a share of its mean, that counts as rising or falling
    TREND_ABS: 0.03,           // and at least this much optical depth
    /* Earth date of Ls 0 of each Martian Year (Piqueux et al. 2015 calendar), used only to show an approximate month. */
    MY_START: { 24: '1998-07-14', 25: '2000-05-31', 26: '2002-04-18', 27: '2004-03-05', 28: '2006-01-21', 29: '2007-12-09', 30: '2009-10-26',
                31: '2011-09-13', 32: '2013-07-31', 33: '2015-06-18', 34: '2017-05-05', 35: '2019-03-23', 36: '2021-02-07' },
    ITP_FRAMES: 2,             // an INTERPOLATED value is used only if the cell was observed within this many frames,
                               // or a neighbouring cell is observed in the same frame; otherwise the cell is NO DATA
    POLAR_LAT: 60,             // poleward of this, retrievals near the polar caps are less reliable: confidence is
                               // lowered there, and those cells are left out of the planet-wide storm share
    EVENT_AREA: 0.02,          // share of the observed planet at HIGH or SEVERE that starts a "storm event"
    CLASSES: ['NO DATA', 'LOW', 'MODERATE', 'HIGH', 'SEVERE'],
    CLASS_COLOURS: ['#7C8794', '#2E8B8B', '#F2C744', '#E8742A', '#B01E3C'],
    TAU_MAX: 1.5,              // top of the optical-depth colour bar; deeper values share the last colour
    RAMP_TAU: [[255, 244, 214], [240, 190, 110], [205, 120, 50], [150, 60, 25], [80, 20, 15]],
    RAMP_DEV: [[40, 90, 160], [150, 190, 220], [245, 240, 225], [235, 150, 70], [160, 25, 35]],   // -100 % … +300 % of baseline
    TREND_COLOURS: { increasing: '#C2321F', stable: '#C9C2A6', decreasing: '#2F6FB0', unknown: '#7C8794' }
  },

  /* ---- Markers (js: markers.js, nav-ui.js). The four built-in icons; the first is the default. ----
   *   name    shown in the icon picker and the filter      colour  the badge on the map
   *   role    what the route-finder does with a marker of this kind */
  MARKER_ICONS: {
    pin:    { name: 'Pin',    colour: '#6D28D9', role: 'A note or a destination.' },
    home:   { name: 'Home',   colour: '#0E8A5F', role: 'A base or shelter: the route-finder measures "distance from the nearest base" to it.' },
    crater: { name: 'Crater', colour: '#37474F', role: 'A crater or other landform worth finding again.' },
    danger: { name: 'Danger', colour: '#D7263D', role: 'A hazard: routes keep outside its keep-clear distance.' }
  },
  MARKER_MAX_ICONS: 12,         // uploaded icons kept in the browser
  MARKER_ICON_PX: 64,           // an uploaded picture is shrunk to this many pixels square

  /* ---- Route-finder (router.js). Every limit, weight and threshold of the safety index is here. ----
   * These are this project's own planning assumptions, not NASA flight rules. Slope and climb come from the
   * terrain pack (terrain.js), which resolves features about 15 km across: they are regional values. */
  /* ---- Places: the location selector, checkpoints and sites (places.js, places-ui.js) ---- */
  PLACES: {
    LOCAL_KM: 60,               // the walker can be moved this far from base and keep the same base; farther starts a new site
    STOP_EVERY: 10,             // the list shows every tenth Curiosity stop; a search for "sol 4700" finds any of them
    MAX_RESULTS: 40,            // results shown for a search
    /* The sharpest imagery where you land, and the deepest zoom worth showing there. Checked in order. */
    IMAGERY: [
      { name: 'MRO HiRISE', res: '0.6 m per pixel', zoom: 17, bounds: [[-4.9254, 137.1225], [-4.2490, 137.7298]] },
      { name: 'MRO CTX', res: '10 m per pixel', zoom: 13, bounds: [[-6.57, 135.18], [-2.81, 139.24]] },
      { name: 'the Viking colour mosaic', res: 'about 232 m per pixel', zoom: 8, bounds: null }
    ]
  },

  /* ---- Walk budget (budget.js): oxygen, battery and the turn-back point. MODELLED: these are this project's
   * planning assumptions, not suit or rover specifications. Sources for the rough sizes:
   *   oxygen   1 litre of O2 per 20.1 kJ of metabolism (respiratory quotient about 0.85); 1.43 g per litre.
   *            Apollo surface EVAs averaged about 230 W of metabolism, peaks near 500 W.
   *   suit     about 0.7 kg of breathing oxygen and a battery of about 1.2 kWh carry an 8 h EVA with reserve.
   *   robot    a solar rover the size of Spirit or Opportunity: 1.3 m² of panels; dust in the air cuts the sunlight.
   *            Curiosity and Perseverance run on a nuclear generator instead and are not modelled here. */
  BUDGET: {
    RESERVE: 0.15,              // share of oxygen and battery always kept back
    astronaut: {
      o2Kg: 0.70,               // breathing oxygen carried
      o2PerJ: 7.11e-8,          // kg of O2 per joule of metabolism
      metRest: 150,             // W, standing in the suit
      metPerMs: 125,            // W more for each m/s of walking on the level
      mass: 200,                // kg, person and suit, for the cost of climbing
      climbEff: 0.2,            // muscle efficiency when climbing
      battWh: 1200,             // suit battery
      drawW: 80,                // W: fans, pump, radio, displays
      heatFrom: -20,            // °C: below this air temperature the suit heaters run...
      heatPerC: 1.0,            // ...this many watts for each degree colder
      airUnknown: -60           // °C assumed where no temperature is measured (far from Gale)
    },
    robot: {
      battWh: 1000, idleW: 50, driveW: 120,
      panelM2: 1.3, panelEff: 0.24,
      solarConst: 586,          // W/m², mean sunlight at Mars's distance from the Sun
      visPerIr: 2.6             // visible-light optical depth for each unit of 9.3 µm absorption optical depth
    }
  },

  /* ---- Offline map (offline.js, sw.js): which tiles "Save the walk area" fetches ---- */
  OFFLINE: {
    TILE_KB: 25,                // average tile size, for the estimate shown before saving
    MAX_TILES: 6000,            // never fetch more than this in one go
    /* For each photo base layer (BASE, by position): the zooms saved and how far around the walk area, in km.
       radius null = the whole planet. Deepest zooms only near the walk; coarse zooms for the surroundings. */
    PLAN: [
      [{ zooms: [0, 4], radius: null }, { zooms: [5, 7], radius: 300 }],
      [{ zooms: [8, 10], radius: 60 }, { zooms: [11, 12], radius: 12 }],
      [{ zooms: [12, 14], radius: 6 }, { zooms: [15, 16], radius: 2.5 }]
    ],
    OVERLAY: { radius: 30 }     // the map overlay switched on, if any: every zoom it has, this far around
  },

  ROUTER: {
    GRID: 120,                  // the search grid is at most this many cells along its longer side
    CELL_MIN: 3,                // m, the smallest search cell
    MARGIN: 0.35,               // room searched either side of the straight line, as a share of its length...
    MARGIN_MIN: 150,            // ...and never less than this many metres
    WX_RADIUS: 150000,          // m from base inside which Curiosity's REMS temperatures are used
    RETURN_DETOUR: 1.25,        // the way back to the nearest base is taken as the straight line times this
    AT_BASE: 30,                // m: a destination this close to a base needs no way back
    DANGER_RADIUS: 50,          // m: keep-clear distance of a danger marker unless the marker sets its own
    PREFER_MARGIN: 5,           // the preferred trail is recommended when its index is within this many points of the best
    TWILIGHT: 0.4,              // hours of usable light before sunrise and after sunset
    TAG_GOOD: 0.25,             // a factor at or below this risk is given as a reason the route is safe
    TAG_BAD: 0.5,               // a factor at or above this risk is given as a reason it is unsafe
    MEAN_SHARE: 0.6,            // the index mixes the weighted mean of the risks (this share) with the single worst one (the rest)
    DUST_RISK: [0.4, 0, 0.45, 0.85, 1],     // risk by activity class: NO DATA, LOW, MODERATE, HIGH, SEVERE
    DUST_RISING: 0.1,           // added when optical depth has been increasing
    /* What each kind of walker can do, and how much each factor counts for them (weights add up to 1).
     *   speed m/s on level ground     climbRate metres of climb that cost one extra hour (0: no extra time)
     *   hours the longest outing, out and back     sols, driveHours a robot's longest traverse and its driving day
     *   slopeEasy..slopeMax regional slope, degrees: no risk below, impassable above. Measured over about 7 km, only
     *       0.25 % of Mars is steeper than 10° and 0.004 % steeper than 20°; the flank of Mount Sharp at the boxwork is 8.5°
     *   climbRef a climb this high is full risk; climbMax is refused     baseFar m from the nearest base that is full risk
     *   tempRef a fall in air temperature this large (°C) is full risk     dustBlock activity class that closes a route
     *   unknownRef metres of ground nobody has walked or driven that count as full risk (a short hop off the trail counts less) */
    WALKERS: {
      astronaut: { speed: 1.2, climbRate: 600, hours: 8, needsReturn: true, slopeEasy: 6, slopeMax: 18, climbRef: 600, climbMax: 1500,
        baseFar: 5000, tempRef: 40, unknownRef: 2000, dustBlock: 4,
        w: { dust: 0.20, slope: 0.12, climb: 0.08, base: 0.14, time: 0.14, temp: 0.08, dark: 0.10, unknown: 0.08, hazard: 0.06 } },
      robot: { speed: 0.04, climbRate: 0, sols: 30, driveHours: 6, needsReturn: false, slopeEasy: 8, slopeMax: 22, climbRef: 1500, climbMax: 5000,
        baseFar: 20000, tempRef: 60, unknownRef: 1000, dustBlock: 4,
        w: { dust: 0.24, slope: 0.20, climb: 0.08, base: 0.04, time: 0.18, temp: 0.02, dark: 0, unknown: 0.14, hazard: 0.10 } }
    },
    IMPORTANCE: { dust: 1, slope: 1, time: 1, dark: 0.9, hazard: 0.9, base: 0.8, climb: 0.7, temp: 0.7, unknown: 0.6 },   // how far one bad factor alone can pull the index down
    /* The live index: the same factors, worked out for where the walker stands now (router.js, live). And its alarm. */
    LIVE: {
      OFF_TRAIL: 300,           // m from the nearest known trail that counts as full risk
      FACTOR_ALARM: 0.8,        // one factor at or above this risk raises the alarm...
      FACTOR_CLEAR: 0.7,        // ...until it falls back below this
      INDEX_CLEAR: 5,           // the index alarm stops once the index is this many points back above the limit
      DROP: 15,                 // a fall of this many index points...
      JUMP: 0.3,                // ...or a rise of this much in one factor's risk...
      WINDOW: 600               // ...within this many seconds of the walk counts as a large change
    }
  },

  /* ---- Explanations behind the (i) buttons. A button carries data-info="key"; app.js shows the entry.
   *   term   the heading          what   what it is, in plain words, with its unit
   *   why    why a walker cares   basis  where the number comes from: measured, historical, interpolated or modelled */
  GLOSSARY: {
    places: { term: 'Going to a place',
      what: 'The arrow shows a place on the map and leaves the walker where it is. The walker icon moves the walker there and starts a new trail. Within 60 km of base the base stays put; farther away the base moves with the walker, and that place becomes a new site.',
      why: 'Planning a walk elsewhere needs distances, the route-finder and the walk budget to count from a base near it.',
      basis: 'Positions are planetocentric latitude and east longitude. A flat map of metres is accurate to well under 1 % within 60 km of its centre, which is why the base moves beyond that.' },
    slope: { term: 'Terrain slope',
      what: 'How steep the ground is, in degrees from level. On Curiosity\'s drive it is measured from the rover\'s own position fixes over about 60 m. Elsewhere it is the regional slope of the land over about 15 km.',
      why: 'Steep ground costs more oxygen and time, and loose slopes can slide. Above about 15° a suited walk gets hard.',
      basis: 'Along the drive: measured (Curiosity\'s fixes, about 25 m apart). Elsewhere: the MOLA shape model, which cannot see a cliff, a dune or a boulder.' },
    walkBudget: { term: 'Walk budget: oxygen, battery, turn back',
      what: 'Oxygen and battery left, in percent, and how long you can keep going out before what is left, less a 15 % reserve, only just covers the walk back to base. A robot shows its battery, which recharges in sunlight.',
      why: 'The turn-back point is the most important number on a walk: past it, the way home is not covered.',
      basis: 'MODELLED from your pace, climb and the air temperature, with assumed suit and rover sizes (BUDGET in config.js). Not a suit reading. A robot\'s sunlight is dimmed by the dust observed on the Timeline\'s date.' },
    companions: { term: 'Walking together',
      what: 'Other walkers shown on the map at the same time as yours: standing still, replaying a route beside you, or following their own position fixes.',
      why: 'A real EVA is never solo: you need to know where your partner or rover is.',
      basis: 'Replays use the route\'s recorded positions. Position fixes come from outside the app (Marswalk.setPose with a walker id).' },
    season: { term: 'Best season for a walk',
      what: 'For this place: the typical dust optical depth through the Martian year in every observed year, how often each season had HIGH or SEVERE dust, and the clearest 60° of Ls with its next Earth dates.',
      why: 'Choosing the season is the simplest way to lower the risk of meeting a dust storm.',
      basis: 'HISTORICAL: statistics of OBSERVED values from Martian Years 24 to 36. A record of past years, not a forecast; Earth dates are approximate.' },
    offline: { term: 'Offline map',
      what: 'The app and the map tiles you have viewed are kept in the browser, so the page still opens and shows the map with no connection. "Save the walk area" fetches the tiles around the walk ahead of time.',
      why: 'A link to Earth or to a base server can drop during a walk; the map should not.',
      basis: 'A service worker (sw.js). It needs a web address, http://localhost or https: a file opened by double-click cannot use one.' },
    liveSafety: { term: 'Live safety index',
      what: 'The safety index for where the walker stands at this moment, from 0 to 100: higher is safer. It uses the same factors as a route: dust here, regional slope, height above base, distance from the nearest base, time used plus the way back, temperature drop, daylight left for the way back, distance from known trails, and distance from marked hazards.',
      why: 'It changes as you walk. If it falls below your limit, drops quickly, or one factor turns critical, the safety alarm says which factor and why. Turn the readout and the alarm on or off in Settings > Display.',
      basis: 'Calculated by Marswalk about once a second. Dust is OBSERVED from orbit for the Timeline\'s date; slope and height are regional (MOLA shape model, about 15 km); temperature and daylight are MODELLED. The limits are this project\'s planning assumptions, not NASA flight rules.' },
    safetyIndex: { term: 'Safety index',
      what: 'A score from 0 to 100 for one route: higher is safer. It combines dust activity, regional slope, climb, distance from the nearest base, travel time, temperature drop, daylight, how much of the route is on ground already walked, and how close it passes to marked hazards. One bad factor pulls the score down even when the rest are good.',
      why: 'It lets you compare routes at a glance. The tags under each route say which factors help and which hurt.',
      basis: 'Calculated by Marswalk. Dust is OBSERVED from orbit for the date chosen on the Timeline; slope and climb are regional, from the MOLA shape model (about 15 km resolution), so a local cliff does not show; temperature and daylight are MODELLED. The limits and weights are this project\'s planning assumptions, not NASA flight rules.' },
    regionalSlope: { term: 'Regional slope and climb',
      what: 'The tilt of the land measured over kilometres, in degrees, and the height gained along a route in metres.',
      why: 'A long steady climb costs time and energy. It does not tell you about a cliff, a dune or a boulder field on the way: mark those with a danger marker.',
      basis: 'From the MarsTopo719 shape model of Mars (MGS MOLA laser altimetry) and the GMM-3 gravity model. It resolves features about 15 km across.' },
    preferredTrail: { term: 'Preferred trail',
      what: 'One saved trail (or Curiosity\'s drive) that you have starred as the way you would rather go.',
      why: 'The route-finder checks a route along it first and recommends it whenever it is nearly as safe as the best route found.',
      basis: 'Your own choice, kept in this browser.' },
    activityClass: { term: 'Activity class',
      what: 'How unusual the dust in the air is for this place and season: LOW, MODERATE, HIGH or SEVERE. NO DATA means nothing was observed, not that the air is clear.',
      why: 'HIGH or SEVERE can mean less light, less solar power and a walk worth rescheduling.',
      basis: 'Worked out by Marswalk from orbiter observations. It describes past observations; it is not a forecast.' },
    opticalDepth: { term: 'Dust optical depth',
      what: 'How much dust is in the whole column of air above the ground, also called atmospheric opacity or tau. It has no unit: around 0.1 is clear, above 1 is a major storm. Marswalk uses the infrared value at 9.3 µm; in visible light it is about 2.6 times larger.',
      why: 'More dust blocks more sunlight. It does not tell you the visibility where you stand.',
      basis: 'OBSERVED: measured from orbit (MGS TES, Odyssey THEMIS, MRO MCS) for a cell hundreds of km wide, averaged over 5 sols. ± is the retrieval uncertainty.' },
    baseline: { term: 'Seasonal baseline',
      what: 'What is normal here at this time of the Martian year: the median optical depth, and the level exceeded only 1 time in 10 (90th percentile).',
      why: 'The same dust level can be ordinary in the dusty season and alarming in the clear season.',
      basis: 'HISTORICAL: statistics of observations from the other Martian Years in the record.' },
    deviation: { term: 'Deviation from baseline',
      what: 'How far the current optical depth is above (+) or below (−) the seasonal median, in percent. "Robust spreads" counts how many typical year-to-year variations that is.',
      why: 'A large positive deviation is the sign of a dust event rather than normal seasonal haze.',
      basis: 'Calculated from an observed value and the historical baseline.' },
    trend: { term: 'Recent trend',
      what: 'Whether optical depth has been increasing, decreasing or stable over the last 20 sols.',
      why: 'Rising dust is more of a concern than the same level falling.',
      basis: 'A straight-line fit through recent observations. It says what has happened, not what will.' },
    regional: { term: 'Regional activity',
      what: 'How many of the 8 neighbouring map cells also show elevated dust, and how much of the observed planet is affected.',
      why: 'Dust raised over a wide region lasts longer and is harder to avoid than a single local rise.',
      basis: 'Counted from observed cells only.' },
    confidence: { term: 'Confidence',
      what: 'How far to trust this cell\'s result: high, medium or low.',
      why: 'Low confidence means the class could be wrong; look for more recent or closer data.',
      basis: 'Lowered for interpolated values, large retrieval uncertainty, few years of history, or high latitudes.' },
    labels: { term: 'Data labels',
      what: 'OBSERVED: measured by an instrument. HISTORICAL: statistics of past observations. INTERPOLATED: estimated between observations. MODELLED: calculated from a model.',
      why: 'An estimate should not be trusted like a measurement, so every dust value says which it is.',
      basis: 'No dust value in Marswalk is modelled.' },
    ls: { term: 'Solar longitude (Ls)',
      what: 'Where Mars is in its orbit, in degrees from 0 to 360: the Martian calendar. Ls 0° is northern spring equinox, 90° summer, 180° autumn, 270° winter.',
      why: 'Dust follows the seasons. Most large storms happen between Ls 180° and 360°.',
      basis: 'An exact astronomical quantity, taken from the data set for each observation.' },
    martianYear: { term: 'Martian Year (MY)',
      what: 'A count of Mars years, each 669 sols (687 Earth days). MY1 began in April 1955; MY34 covers 2017 to 2019. A sol is one Mars day, 24 h 40 min.',
      why: 'Comparing the same season in different years shows what is normal and what was a storm.',
      basis: 'A calendar convention. Earth months shown beside it are approximate.' },
    elevation: { term: 'Elevation',
      what: 'Height in metres above or below Mars\'s reference level (the MOLA datum, since Mars has no sea level). Gale crater floor is about 4,500 m below it.',
      why: 'Climbs cost time, energy and oxygen; the profile shows how steep the route gets.',
      basis: 'Measured: along the route from Curiosity\'s own position fixes; on the map from MGS MOLA laser altimetry and Mars Express HRSC stereo (200 m per pixel).' },
    temperature: { term: 'Air and ground temperature',
      what: 'Temperature in °C of the air about 1.5 m up, and of the ground surface.',
      why: 'Sets suit heating needs; the ground swings far more than the air between day and night.',
      basis: 'Measured: the daily low and high from Curiosity\'s REMS station. Modelled: the hour-by-hour curve between them.' },
    pressure: { term: 'Air pressure',
      what: 'Pressure of the Martian air in pascals (Pa). About 700 to 900 Pa here: under 1 % of Earth\'s.',
      why: 'It is far too low to breathe or to keep liquids from boiling, so suit integrity is everything.',
      basis: 'Measured by Curiosity\'s REMS station, one value per sol.' },
    uv: { term: 'UV index',
      what: 'Strength of ultraviolet sunlight at the surface, as a category: low, moderate, high or very high.',
      why: 'Mars has no ozone layer; UV ages suit materials and visors. Dust in the air lowers it.',
      basis: 'Measured by Curiosity\'s REMS station, as a daily category.' },
    dose: { term: 'Radiation dose',
      what: 'Dose rate in microsieverts per hour (µSv/h), and the dose added up over this walk (µSv). About 28 µSv/h on the surface: roughly 100 times Earth\'s background.',
      why: 'Dose accumulates over a mission; time outside is part of the budget.',
      basis: 'MODELLED: scaled from the RAD instrument\'s published surface average of 0.67 mSv a day. Not a live reading.' },
    thermal: { term: 'Thermal (infrared) layers',
      what: 'How warm the ground is in the afternoon or before dawn, seen in infrared. Shown from 0 (coolest in view) to 100 (warmest in view), not in degrees.',
      why: 'Ground that stays warm at night is rock; ground that goes cold is loose dust or sand, which is softer footing.',
      basis: 'Measured by Mars Odyssey THEMIS at 100 m per pixel. The scale is relative to the current view.' },
    spectral: { term: 'Spectral and chemical layers',
      what: 'What the surface is made of (minerals) and how bright it is (albedo), read from the infrared light it gives off. Shown from 0 to 100 on NASA\'s colour scale, not in physical units.',
      why: 'Minerals point to volcanic rock or water-altered ground worth sampling.',
      basis: 'Measured by MGS TES at 3 to 7 km per pixel: regional values, the same across a whole walk.' },
    surface: { term: 'Surface properties',
      what: 'Thermal inertia (how slowly ground changes temperature: rock is high, dust is low), dust cover on the ground, and roughness. Dust cover is dust lying on the surface, not dust in the air.',
      why: 'They hint at footing: bedrock, sand or thick dust.',
      basis: 'Measured by MGS TES and MOLA at 1 to 3 km per pixel: regional values. For dust in the air, see Dust Storm.' }
  }
};
