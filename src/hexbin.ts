// Hexagon density map: the map is tiled with hexagons (in screen pixels at one zoom level), each
// filled with the main generation of the people born in and around it, in a few discrete density
// levels, like a classic population-density map.

export interface BinPoint {
  x: number;
  y: number;
  gen: number;
}

export interface Hex {
  /** Hexagon centre, in the same pixel coordinates as the points. */
  cx: number;
  cy: number;
  /** Density: 1 per person born inside, plus NEIGHBOUR_WEIGHT per person born in a neighbouring hexagon. */
  weight: number;
  /** Weight per generation; the largest decides the colour. */
  byGen: Map<number, number>;
  /** People born inside this hexagon (not counting neighbours), per generation. */
  people: Map<number, number>;
  /** Most weighted generation; ties go to the most recent one. */
  mainGen: number;
}

const SQRT3 = Math.sqrt(3);

/** How much a person also counts towards the six hexagons around their own, so towns become areas. */
export const NEIGHBOUR_WEIGHT = 0.4;

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Axial coordinates of the pointy-top hexagon of radius `r` containing (x, y). */
export function hexOf(x: number, y: number, r: number): [number, number] {
  const q = ((SQRT3 / 3) * x - y / 3) / r;
  const s = ((2 / 3) * y) / r;
  // Round in cube coordinates (q, s, -q-s), fixing the component with the largest rounding error.
  let rq = Math.round(q);
  let rs = Math.round(s);
  const rt = Math.round(-q - s);
  const dq = Math.abs(rq - q);
  const ds = Math.abs(rs - s);
  const dt = Math.abs(rt - (-q - s));
  if (dq > ds && dq > dt) rq = -rs - rt;
  else if (ds > dt) rs = -rq - rt;
  return [rq, rs];
}

/** Bin points into pointy-top hexagons of radius `r`, spreading a little weight to neighbours. */
export function hexDensity(points: BinPoint[], r: number, neighbourWeight = NEIGHBOUR_WEIGHT): Hex[] {
  const bins = new Map<string, Hex>();
  const add = (q: number, s: number, gen: number, w: number, own: boolean) => {
    const key = `${q},${s}`;
    let hex = bins.get(key);
    if (!hex) {
      hex = { cx: r * SQRT3 * (q + s / 2), cy: r * 1.5 * s, weight: 0, byGen: new Map(), people: new Map(), mainGen: gen };
      bins.set(key, hex);
    }
    hex.weight += w;
    hex.byGen.set(gen, (hex.byGen.get(gen) ?? 0) + w);
    if (own) hex.people.set(gen, (hex.people.get(gen) ?? 0) + 1);
  };
  for (const p of points) {
    const [q, s] = hexOf(p.x, p.y, r);
    add(q, s, p.gen, 1, true);
    if (neighbourWeight > 0) for (const [dq, ds] of NEIGHBOURS) add(q + dq, s + ds, p.gen, neighbourWeight, false);
  }
  for (const hex of bins.values()) {
    let best = -1;
    for (const [g, w] of hex.byGen) {
      if (w > best + 1e-9 || (Math.abs(w - best) <= 1e-9 && g < hex.mainGen)) {
        best = w;
        hex.mainGen = g;
      }
    }
  }
  return [...bins.values()];
}

/** The six corners of a pointy-top hexagon. */
export function hexCorners(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

/**
 * Discrete density levels, like the classes of a population map. Level 0 is only "near people"
 * (weight from neighbours), level 1 about one person, level 2 a few, level 3 many.
 */
export const DENSITY_LEVELS = [
  // The faintest level stays fairly strong so colours read as vivid, not pastel, over the light map.
  { min: 0, opacity: 0.45 },
  { min: 1, opacity: 0.55 },
  { min: 2, opacity: 0.63 },
  { min: 5, opacity: 0.72 }, // even the densest areas stay see-through, so the map shows underneath
] as const;

export function densityLevel(weight: number): number {
  let level = 0;
  DENSITY_LEVELS.forEach((l, i) => {
    if (weight >= l.min) level = i;
  });
  return level;
}
