# GEDCOM World Map

Upload a GEDCOM (`.ged`) family tree and see where everyone was born, on an interactive world map.

- **Birth places on a map.** Each person is a dot at their birth place, or their baptism place if no birth place is recorded.
- **Colored by generation.** Warm colors are the most recent generations, cool colors the oldest. Click a generation in the legend to show or hide it.
- **Click anyone** for their details: dates, places, occupation, parents, spouses, children and siblings. Every name is a link.
- **Family lines.** Selecting someone draws lines to their parents (blue), children (orange) and spouses (dashed). You can switch to all ancestors and/or all descendants. A dotted line means it skips a relative whose place isn't known. Relatives born in the same town are joined by a curved line. While someone is selected, their town and their relatives' towns stay spread out, even when zoomed out.
- **Grouping.** People born near each other are grouped into pie-chart clusters, colored by generation. Clicking a cluster zooms in. Below zoom 6 a town with several people is one of those disks too. From zoom 6, everyone born there is spread out inside a light circle, with one row per generation (oldest on top). Past zoom 14, the spread grows with the map, so each person keeps their place in the town and zooming in spreads them further apart. When zoomed out, towns with many people are packed tighter, so a group never covers a whole region. Each of those dots works like any other dot. Places less than 1.5 km apart count as the same town. You can turn grouping off.
- **Search** by name.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Then drop in a `.ged` file, or click **Try a sample family tree**.

```bash
npm test         # unit tests (parser, generations, helpers)
npm run build    # static build in dist/, which you can host anywhere
```

## How it works

- **Parsing** happens entirely in the browser (`src/gedcom.ts`). Supported encodings are UTF-8, UTF-16 and Windows-1252. ANSEL-encoded files will load, but accented letters may come out wrong.
- **Coordinates.** If a place has `MAP` / `LATI` / `LONG` in the file, those coordinates are used as-is. Otherwise the place name is looked up with [OpenStreetMap Nominatim](https://nominatim.org/). Only the place name is sent, never people's data.
  - Lookups are rate-limited to one per second (Nominatim's usage policy), so a tree with 300 unique places takes about 5 minutes the first time.
  - Results are cached in `localStorage`, so the next load is instant.
  - If the full place isn't found, a less specific version is tried, e.g. `Hamlet, Town, County, Country` → `Town, County, Country`. When that happens the person's panel says the location is approximate.
- **Generations** (`src/generations.ts`) are counted through the family links: parents are one generation older, children one younger, spouses the same. Generation 1 is the most recent.

## Notes

- Map tiles come from the public OpenStreetMap tile server, which is fine for personal use. For heavy or public traffic, switch to a tile provider with an API key (the `L.tileLayer` URL in `src/main.ts`).
- `public/sample.ged` is a fictional family.
