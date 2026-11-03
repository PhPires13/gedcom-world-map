# GEDCOM World Map

Upload a GEDCOM (`.ged`) family tree and see where everyone was born, on an interactive world map.

- **Birth places on a map.** Each person is a dot at their birth place, or their baptism place if no birth place is recorded.
- **Colored by generation.** Warm colors are the most recent generations, cool colors the oldest. Tick a generation to show or hide it, or click its name to show only that one. "Select all" shows or hides them all.
- **Click anyone** for their details: dates, places, occupation, parents, spouses, children and siblings. Every name is a link.
- **Family lines.** Selecting someone draws lines to their parents (blue), children (orange) and spouses (dashed). You can switch to all ancestors and/or all descendants. A dotted line means it skips a relative whose place isn't known. Relatives born in the same town are joined by a curved line. While someone is selected, their town and their relatives' towns stay spread out, even when zoomed out.
- **Density map.** In Display → Show, choose Dots, Density or Both. The density map tiles the map with small hexagons, like a population-density map. Each hexagon takes the color of the most common generation born in and around it, and gets more solid at four density levels. People also count a little toward the hexagons around their own, so towns become areas and nearby towns merge into regions. Hovering shows who was born there, and clicking zooms in. It follows the generation checkboxes.
- **Migration arrows.** Turn on "Migration arrows" in Display to see how the family moved, as a flow map. A parent born in one place who had a child somewhere else made that move, so each arrow belongs to the parents who moved and uses their generation's color. Each generation's moves from one country to another (or between states within a country) share one arrow, as thick as the number of people who moved. Near the start several origins merge into it, and near the end it splits into branches to each destination. The arrow stays the same at every zoom; zooming in only splits its ends into more detailed branches. Opening a person traces their own moves as a solid line and their parents' move (to where they were born) as a dashed line, and fades the rest. Hovering shows who moved and the children they had there. It works with any view and follows the generation checkboxes.
- **Generations timeline.** "Play generations timeline" steps through the generations from oldest to newest, with a play/pause button and a slider at the bottom of the map. With migration arrows on, each step shows the parents' moves that led to that generation's births: the arrows grow out from where the parents were born, and that generation's people appear once the arrows arrive. Earlier generations stay on the map, faded.
- **Grouping.** People born near each other are grouped into pie-chart clusters, colored by generation. Clicking a cluster zooms in. Below zoom 6 a town with several people is one of those disks too. From zoom 6, everyone born there is spread out inside a light circle, with one row per generation (oldest on top). Past zoom 14, the spread grows with the map, so each person keeps their place in the town and zooming in spreads them further apart. When zoomed out, towns with many people are packed tighter, so a group never covers a whole region. Each of those dots works like any other dot. Places less than 1.5 km apart count as the same town. You can turn grouping off.
- **Search** by name, ignoring accents (`antonio` finds António). Use ↑/↓ to move through the results, Enter to open one, and Esc to clear the search. Results open in a dropdown over the menu, and the people you opened recently are listed below the search.
- **Side menu.** Shows the loaded file name with a button to load another one. Its sections can be collapsed, and the browser remembers which ones you closed.

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
