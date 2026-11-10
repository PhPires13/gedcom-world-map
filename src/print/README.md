# Heritage map print

A framed, print-ready map of a family's migrations: aged paper, engraved coastlines, inked
routes between birthplaces, flag roundels, a cartouche and a legend. Open `print.html` (the
**Print** button in the map app's header) to design and export one.

## How it fits together

| File | What it does |
| --- | --- |
| `render.ts` | `renderHeritageMap(data, options, assets)` → SVG string. Pure: no DOM, no network. |
| `data.ts` | From a parsed tree to `PrintData`: people by branch (all / ancestors / father's side / mother's side) and generation, and their moves (`computeFlows`). |
| `geo.ts` | Paper sizes, areas, projection fitting (`makeProjection`), scale and degree marks. |
| `routes.ts` | The web app's bundled flow map (`bundleFlows` + `bundleGeometry`) projected into mm and turned into tapered pen strokes with arrows and year labels. |
| `layout.ts` | Cartouche and legend layout, panel/roundel/label placement without overlaps. |
| `ornaments.ts` | Compass rose, rhumb lines, scale bar, frame, panel borders. |
| `countries.ts` | Which country a place is in (Natural Earth polygons, then the place name) and country names in pt/en. |
| `style.ts`, `styles/*.json` | Styles as data, and their validation. |
| `designer.ts`, `assets-browser.ts` | The designer page and the browser loaders for map data, flags and fonts. |
| `png.ts` | Writes 300 dpi into exported PNGs (canvas doesn't). |

Coordinates on the sheet are millimetres. Styles are designed on A2 and scale with the paper,
so A3 and A1 are the same design reduced or enlarged (A-series sheets share proportions).

## Adding a style

Drop a JSON file in `styles/` with the same shape as `antique.json`. It is validated on load
(`validateStyle`); errors are logged and the style is skipped. Fonts are referenced by family,
weight and style and loaded from the matching `@fontsource/<family>` package, so a new font
only needs `npm install @fontsource/<family>`. The ornament kinds (`frame.kind`,
`compass.kind`, `cartouche.kind`, `marks.kind`, `routes.arrow`) choose between the drawings in
`ornaments.ts`/`render.ts`; a genuinely new ornament needs code.

## Exports

All in the browser for now:

- **SVG**: fonts embedded as data URLs, so it renders the same anywhere.
- **PNG**: the SVG drawn onto a canvas at 300 dpi (A2 = 7016 × 4961 px) with a pHYs chunk.
- **PDF**: that 300 dpi image (JPEG, quality 0.93) on a page of the exact paper size (jsPDF).

### Needs a server later

- **Vector PDF.** svg2pdf can't draw SVG filters (paper grain, stains, ink wobble) and jsPDF
  only embeds TTF fonts, so an in-browser vector PDF would not match the preview. A headless
  Chromium (`page.pdf()`) or resvg on the server can run `renderHeritageMap` unchanged and
  produce either a vector PDF or the raster at any dpi.
- **Large sizes on weak devices.** A1 at 300 dpi is 9933 × 7016 px (≈ 280 MB of canvas).
  Desktop Chrome manages it (A2 takes ~10 s); iPhones and iPads cap canvases at ~16 MP and
  will refuse even A3 (4961 × 3508 px ≈ 17 MP).
- **Colour.** Exports are sRGB. A print-on-demand partner may want CMYK or a specific ICC
  profile and bleed; that conversion belongs on the server.
- **Geocoding.** The designer reuses the map's Nominatim cache and looks up missing places at
  1 per second. A service with many customers needs its own geocoder or a paid plan.
- **Server assets.** On Node, load `world-atlas/countries-{50m,10m}.json`,
  `flag-icons/flags/1x1/<cc>.svg` and the `@fontsource` WOFF2 files with `fs` and pass them
  in `PrintAssets`; pass a `measure` backed by the real fonts (e.g. opentype.js) for exact
  text fitting (without one, widths are estimated from each font's `widthFactor`).

## Data, fonts and flags: licences

| Source | Used for | Licence |
| --- | --- | --- |
| [Natural Earth](https://www.naturalearthdata.com/) 4.1.0 admin-0 countries, 1:50m and 1:10m | Coastlines, borders, country lookup | Public domain |
| [`world-atlas`](https://github.com/topojson/world-atlas) 2.0.2 | Natural Earth as TopoJSON | ISC |
| [`d3-geo`](https://github.com/d3/d3-geo) 3.1, [`topojson-client`](https://github.com/topojson/topojson-client) 3.1 | Projections, paths | ISC |
| [`flag-icons`](https://github.com/lipis/flag-icons) 7.6 (1×1 SVGs) | Flag roundels | MIT |
| [`i18n-iso-countries`](https://github.com/michaelwittig/node-i18n-iso-countries) 7.14 | Country codes and pt/en names | MIT |
| IM Fell English, IM Fell English SC (Igino Marini) via `@fontsource` 5.3 | Antique style | SIL OFL 1.1 |
| Cinzel, EB Garamond via `@fontsource` 5.3 | Nautical style | SIL OFL 1.1 |
| Jost via `@fontsource` 5.3 | Modern style | SIL OFL 1.1 |
| [`jsPDF`](https://github.com/parallax/jsPDF) 4.2 | PDF export | MIT |

The OFL allows embedding the fonts in documents and selling those documents; it doesn't allow
selling the fonts on their own. No OpenStreetMap tiles or data are drawn on the print (the
map app's Nominatim lookups only turn place names into coordinates).

Worth a check before selling: some countries regulate how their flag and arms are reproduced
(Brazil's Lei 5.700/1971, for example). Showing them on a family map is ordinary use, but
it's a question for whoever reviews the product legally.
