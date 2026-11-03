// Layout for a "town tree": everyone born at the same spot, spread out on the map around the
// location with one row per generation (oldest at the top, like a family tree).
//
// Below DOTS_FROM_ZOOM a town is just a disk (see main.ts); from there on its people are dots.
// Offsets are in screen pixels at their natural size. Zoomed out, a group is never wider or
// taller than MAX_SPAN (big groups are packed tighter, down to MIN_PITCH between dot centres).
// From SPREAD_FROM_ZOOM on, the spread grows with the map (doubling per zoom level), so each
// person keeps a fixed place within the town and zooming in spreads them further apart.
// Dot size stays the same.

export const DOT = 14;
// Generous gaps so relationship lines between people in the same town have room to show.
const GAP = 12;
const ROW_GAP = 18;
const MAX_PER_ROW = 6;

/** Below this zoom a town is drawn as a single disk, like the clusters between towns. */
export const DOTS_FROM_ZOOM = 6;

/** Zoom level at which the spread starts growing with the map. */
export const SPREAD_FROM_ZOOM = 14;

/** Largest distance between the outermost dot centres when zoomed out, in pixels. */
export const MAX_SPAN = 96;
/** Closest two neighbouring dot centres may be packed: touching, their white borders keep them apart. */
const MIN_PITCH = DOT;

/**
 * How much to multiply the pixel offsets by at a given zoom. Zoomed out it's the layout's
 * `minScale` (1, or less for big groups); from SPREAD_FROM_ZOOM it doubles per zoom level,
 * picking up smoothly from wherever the compact size leaves off.
 */
export function spreadScale(zoom: number, minScale = 1): number {
  return Math.max(minScale, 2 ** (zoom - SPREAD_FROM_ZOOM));
}

export interface SpotDot {
  id: string;
  gen: number;
  /** Dot centre, in pixels from the map location (the centre of the layout), at minimum size. */
  dx: number;
  dy: number;
}

export interface SpotLayout {
  /** Size at natural spread (scale 1), including the dots themselves. */
  width: number;
  height: number;
  dots: SpotDot[];
  /** Scale used when zoomed out: below 1 for groups that would otherwise exceed MAX_SPAN. */
  minScale: number;
}

/** Half the width/height of the area the dots cover when spread by `scale`. */
export function spreadBox(layout: SpotLayout, scale: number): { halfW: number; halfH: number } {
  return {
    halfW: ((layout.width - DOT) / 2) * scale + DOT / 2,
    halfH: ((layout.height - DOT) / 2) * scale + DOT / 2,
  };
}

const rowWidth = (n: number) => n * DOT + (n - 1) * GAP;

/**
 * @param ids     people born at this spot
 * @param gen     generation of a person (0 = most recent)
 * @param year    birth year, used to order people within a row
 */
export function layoutSpot(ids: string[], gen: (id: string) => number, year: (id: string) => number | undefined): SpotLayout {
  const byGen = new Map<number, string[]>();
  for (const id of ids) byGen.set(gen(id), [...(byGen.get(gen(id)) ?? []), id]);

  // Oldest generation first; long generations wrap onto extra rows of the same colour.
  const rows: { gen: number; ids: string[] }[] = [];
  for (const g of [...byGen.keys()].sort((a, b) => b - a)) {
    const people = byGen.get(g)!.sort((a, b) => (year(a) ?? 9999) - (year(b) ?? 9999));
    for (let i = 0; i < people.length; i += MAX_PER_ROW) rows.push({ gen: g, ids: people.slice(i, i + MAX_PER_ROW) });
  }

  const inner = Math.max(...rows.map((r) => rowWidth(r.ids.length)));
  const width = inner;
  const height = rows.length * DOT + (rows.length - 1) * ROW_GAP;

  // Cap the zoomed-out size, without packing dots closer than MIN_PITCH.
  const span = Math.max(width, height) - DOT;
  // Only the spacings this group actually uses limit how tight it can get.
  const pitches = [
    ...(rows.some((r) => r.ids.length > 1) ? [DOT + GAP] : []),
    ...(rows.length > 1 ? [DOT + ROW_GAP] : []),
  ];
  const tightest = pitches.length ? MIN_PITCH / Math.min(...pitches) : 1;
  const minScale = span > MAX_SPAN ? Math.max(tightest, MAX_SPAN / span) : 1;

  const dots: SpotDot[] = [];
  rows.forEach((row, r) => {
    const left = (inner - rowWidth(row.ids.length)) / 2;
    row.ids.forEach((id, c) => {
      const x = left + c * (DOT + GAP) + DOT / 2;
      const y = r * (DOT + ROW_GAP) + DOT / 2;
      dots.push({ id, gen: row.gen, dx: x - width / 2, dy: y - height / 2 });
    });
  });
  return { width, height, dots, minScale };
}
