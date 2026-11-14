# Marswalk

A field map for one Marswalk (EVA) at the Mount Sharp boxwork in Gale crater, built for the
NASA Space Apps 2026 challenge "Interplanetary Survival Guide: Martian Map".

It shows a layered NASA map of the site, a pointer for where the walker (astronaut or robot) is
and which way they are looking, and a trail that remembers every pass over the same ground in order.
Trails can be recorded, saved, replayed and shared as files.

![Night infrared over the HiRISE photo map, with Curiosity's route](docs/night-infrared-over-hirise.jpg)

## Run it

- **Quickest:** open `dist/marswalk.html` in Chrome, Edge or Firefox. It is the whole app in one file.
- **From source:** open `index.html`, or serve the folder with `python -m http.server` and open
  `http://localhost:8000`.
- **GitHub Pages:** enable Pages on the main branch. There is no build step.

The map imagery streams from NASA's Mars Trek tile server, so the browser needs internet access.
If the tiles cannot be reached the page says so; the route, pointer and trail still work.

## Where things live

Plain JavaScript, no framework and no build step. Each file adds to one global object, `MW`,
and they load in this order (see the bottom of `index.html`):

| File | What it holds | Edit it when you want to… |
|---|---|---|
| `js/config.js` | Every constant, colour ramp and map layer | add or change a layer, tune the trail, change walking speed |
| `js/data.js` | The NASA data pack: Curiosity's route, REMS weather, Navcam photo ids | move to another site or refresh the data |
| `js/geo.js` | Unpacks `data.js`; coordinate conversion; number and text formatting | change the coordinate model |
| `js/tiles.js` | `MW.SmoothTiles`: the tile layer (over-zoom, recolouring, reading values) | change how tiles are drawn or sampled |
| `js/trail.js` | `MW.Trail`: trail points, pass counting, way back, saved-trail format | change what counts as "the same ground" |
| `js/store.js` | `MW.store`: saved trails in the browser's storage | keep trails somewhere else (a server, a suit computer) |
| `js/app.js` | The page: map, pointer, movement, recording, readouts, main loop | change behaviour or the interface |
| `css/style.css` | All styling | change the look |
| `tools/build.py` | Packs everything into `dist/marswalk.html` | you changed any file above: run `python tools/build.py` |
| `vendor/` | Leaflet 1.9.4, unmodified | – |

`js/app.js` is divided into eight numbered sections listed at its top. `trail.js` and `store.js`
do not touch the map or the page, so they can be reused or tested on their own.

### Common changes

**Add a map layer.** Find the layer on the
[Trek layer list](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars), then add one entry
to `LAYERS` in `js/config.js`:

```js
{ key: 'my-layer', name: 'Name in the list', id: 'Trek_Layer_Name', ext: 'png', nz: 9, res: '100 m',
  read: 'grey', ramp: 'heat', stretch: true, ends: ['cooler', 'warmer'], what: 'ground warmth',
  note: 'One or two sentences on what the layer shows and how to read it.' }
```

`nz` is the deepest zoom the server really has: request
`{TREK}{id}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}` at rising `z` until it returns 404.
The fields `read`, `ramp`, `stretch`, `legend`, `ends` and `what` are explained above `LAYERS`.
The legend bar, the readout under the map and the tick on the bar all follow from the entry.

**Feed a real position.** Call this from any script, as often as fixes arrive:

```js
Marswalk.setPose({ lat: -4.8012, lon: 137.3829, heading: 215 });   // heading: degrees clockwise from north
Marswalk.releasePose();                                            // hand control back to the page
```

**Move to another site.** Replace the three strings in `js/data.js` (the comment at its top gives
each source and encoding) and the `BASE` layers and bounds in `js/config.js`.

## What is on the map

| Kind | Layer | Source (Trek layer id) | Deepest real zoom | Ground per pixel |
|---|---|---|---|---|
| Optical | Photo base | MRO HiRISE `curiosity_hirise_mosaic` | 16 | 0.6 m |
| Optical | Photo base, surroundings | MRO CTX `Gale_CTX_BlockAdj_dd` | 12 | 10 m |
| Optical | Photo base, planet | Viking `Mars_Viking_MDIM21_ClrMosaic_global_232m` | 7 | 325 m |
| Thermal | Daytime and night infrared | Odyssey THEMIS `THEMIS_DayIR/NightIR_ControlledMosaics_100m_v2_oct2018` | 9 | 100 m |
| Topographic | Colour elevation, shaded relief | MOLA + HRSC `Mars_MOLA_blend200ppx_HRSC_*` | 8 | 200 m |
| Spectral, chemical | Clinopyroxene, plagioclase, glass and clay, albedo | MGS TES `TES_*` | 1 | regional |
| Geophysical | Thermal inertia, dust cover, roughness | MGS TES, MGS MOLA | 1 | regional |
| Atmospheric | Air and ground temperature, pressure, UV at every route stop | Curiosity REMS | per sol | in place |
| Radiation | Dose rate and dose for this walk | Model on the RAD surface average, 0.67 mSv/day | modelled | – |
| Point of view | Navcam photo at every third stop | Curiosity raw images | per stop | – |

The reference route is Curiosity's real drive: 120 end-of-drive positions from sol 4560 to 5073,
2.9 km long with 175 m of climb. Base (0, 0) is the first of them.

## How the readings work, and what they are not

Every data layer has the same legend bar: a low word, the colours, a high word, and a tick at the
walker's own value. The same value is shown as a number under the map.

- **Thermal layers** are greyscale pictures. The page stretches the grey range inside the current
  view across a blue-to-red ramp. The number is *relative to the view*: 0 is the coolest ground in
  view, 100 the warmest. The THEMIS mosaics are normalised, so they do not carry kelvin.
- **Mineral, thermal-inertia and dust layers** come from Trek already painted in a rainbow. The page
  reads the hue back into a number (violet 0, red 100) and repaints it on one pale-to-deep ramp, so
  deeper always means more. The scale is fixed. The direction was checked against known regions
  (dusty Arabia reads high dust and low thermal inertia; Syrtis Major reads high pyroxene and
  plagioclase). The number is a position on NASA's colour scale, not a physical unit: Trek does
  not publish the unit range of these colour scales.
- **Albedo** is a greyscale picture on the same fixed pale-to-deep ramp.
- **Roughness** is NASA's three-channel composite; the readout gives the three channels.
- **Colour elevation** keeps NASA's colours; the readout gives the surveyed height in metres.
- **Weather** numbers are Curiosity's measured daily low and high; the hour-by-hour curve between
  them, and all radiation figures, are models and are labelled so on the page.

To get physical units for the regional layers, the next step is to download the numeric TES grids
from the PDS and sample those instead of the pictures.

## The trail

A point is stored every 1.5 m with its time, odometer and look direction. A new pass over a spot
is counted when the walker comes within 2.5 m of earlier trail after walking at least 12 m away
from it. The line is drawn as four canvas strokes (once, twice, three times, four or more), so
drawing cost does not grow with the number of colours. Tapping the trail lists every pass in order.
"Show way back" draws the trail in reverse with every loop cut out.

### Saved trails

"Record a new trail" starts a fresh trail; "Stop and save" names and stores it in the browser
(`localStorage`, key `marswalk.trails.v1`). A saved trail can be shown on the map, replayed
(the pointer waits at its start until Start is pressed), downloaded and imported. The file is JSON:

```json
{ "format": "marswalk-trail", "version": 1, "id": "t…", "name": "Ridge loop",
  "savedAt": "2026-11-14T08:30:00.000Z", "source": "walked",
  "site": "Mount Sharp boxwork, Gale crater, Mars", "base": { "lat": -4.799847, "lon": 137.383541 },
  "distance_m": 84.2, "duration_s": 157,
  "fields": ["lat", "lon", "seconds", "heading_deg"],
  "points": [[-4.8260233, 137.388886, 0, 188], …] }
```

## Coordinates

Planetocentric latitude and east longitude, as the NASA tiles use (Leaflet `L.CRS.EPSG4326`).
Local x and y are metres east and north of base on a sphere of radius 3,396,190 m.
Height is metres relative to the MOLA geoid. Heading is degrees clockwise from north.

## Known gaps

- No CRISM mineral map, HiRISE terrain model, slope map or geologic-unit lookup. Trek does not
  serve these as tiles for this site; they need downloading from PDS/USGS and tiling.
- The map needs a live connection to NASA's servers. An offline tile pack is the main step
  before any use where the link can drop.
- No oxygen, battery or turn-back budget, no position-uncertainty ring, no notes on waypoints.
- REMS weather ends at sol 4995 in the public feed; later stops reuse that sol.
- Saved trails stay in one browser unless downloaded.

## Credits

Imagery and data: NASA/JPL-Caltech, USGS, University of Arizona, MSSS, ASU, ESA/DLR/FU Berlin (HRSC).
Map library: Leaflet 1.9.4 (BSD-2-Clause). NASA does not endorse this project.
