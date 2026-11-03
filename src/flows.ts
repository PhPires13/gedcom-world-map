// Migration arrows. A parent born in one place who had a child somewhere else moved between the
// two, so each move belongs to the parent (their generation colours and groups it). The child's
// birth is what dates it, so the child's generation decides when it appears in the timeline.
// Moves are grouped so many people making the same move become one thicker arrow per generation.

export interface Place {
  lat: number;
  lon: number;
  /** Place name as written in the file, e.g. "Braga, Portugal"; used to group routes by region. */
  place?: string;
}

export interface Flow {
  /** Where the parents who moved were born. */
  from: Place;
  /** Where they had their children. */
  to: Place;
  /** Generation of the parents who moved: colours and groups the arrow. */
  gen: number;
  /** Generation of the children born at `to`: the timeline step at which the move shows. */
  step: number;
  /** The parents who made this move (born at `from`, had children at `to`). */
  parents: string[];
  /** Their children born at `to`. */
  children: string[];
  /** Which of the generations sharing this from→to route this is (0, 1, …), to fan them apart. */
  lane: number;
}

/** Great-circle distance in km. */
export function distanceKm(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Moves shorter than this are within the same town, not migrations. */
export const MIN_MOVE_KM = 1.5;

const placeKey = (p: Place) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

/**
 * @param shown  whether to include a move, given the generation of the parent who moved and of the
 *               child whose birth dates it
 */
export function computeFlows(
  people: Map<string, { parents: string[] }>,
  located: Map<string, Place>,
  gens: Map<string, number>,
  shown: (moverGen: number, childGen: number) => boolean,
): Flow[] {
  const flows = new Map<string, Flow>();
  for (const [childId, child] of people) {
    const to = located.get(childId);
    const step = gens.get(childId) ?? 0;
    if (!to) continue;
    for (const parentId of child.parents) {
      const from = located.get(parentId);
      const gen = gens.get(parentId) ?? step + 1;
      if (!from || !shown(gen, step) || distanceKm(from, to) < MIN_MOVE_KM) continue;
      const key = `${placeKey(from)}>${placeKey(to)}>${gen}>${step}`;
      let flow = flows.get(key);
      if (!flow) {
        flow = { from, to, gen, step, parents: [], children: [], lane: 0 };
        flows.set(key, flow);
      }
      if (!flow.parents.includes(parentId)) flow.parents.push(parentId);
      if (!flow.children.includes(childId)) flow.children.push(childId);
    }
  }
  // Generations sharing a route get their own lane, most recent first.
  const byRoute = new Map<string, Flow[]>();
  for (const f of flows.values()) {
    const route = `${placeKey(f.from)}>${placeKey(f.to)}`;
    byRoute.set(route, [...(byRoute.get(route) ?? []), f]);
  }
  for (const group of byRoute.values()) group.sort((a, b) => a.gen - b.gen).forEach((f, i) => (f.lane = i));
  return [...flows.values()];
}

/**
 * Points along a curved arrow from p1 to p2 (pixel coordinates). It bows to the left of the
 * direction of travel, so A→B and B→A don't overlap; `bend` is the bow as a share of the length.
 */
export function arcPoints(p1: [number, number], p2: [number, number], bend: number, steps = 24): [number, number][] {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // Left normal (screen y points down), scaled so the curve's apex sits `bend * length` away.
  const cx = (x1 + x2) / 2 + dy * bend * 2;
  const cy = (y1 + y2) / 2 - dx * bend * 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2] as [number, number];
  });
}

/** Triangle for an arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowHead(tip: [number, number], from: [number, number], size: number): [number, number][] {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const back = (da: number): [number, number] => [tip[0] - size * Math.cos(a + da), tip[1] - size * Math.sin(a + da)];
  return [tip, back(0.45), back(-0.45)];
}

// ---------- Bundling: a flow map with trunks that merge and split ----------

type Pt = [number, number];

const centroid = (ends: BundleEnd[]): Pt => {
  const w = ends.reduce((s, e) => s + e.count, 0);
  return [ends.reduce((s, e) => s + e.pt[0] * e.count, 0) / w, ends.reduce((s, e) => s + e.pt[1] * e.count, 0) / w];
};

/** One end of a bundle: one place, or several places close together on screen at this zoom. */
export interface BundleEnd {
  pt: Pt;
  /** People who moved through this end. */
  count: number;
  flows: Flow[];
}

/** All of one generation's moves from one region to another (e.g. Portugal → Brazil). */
export interface Bundle {
  /** Generation of the people who moved. */
  gen: number;
  /** Generation of their children, whose births date the moves (the timeline step). */
  step: number;
  /** Which of the generations sharing this pair of regions this is, to fan them apart. */
  lane: number;
  /** People who moved in this bundle (each once). */
  total: number;
  origins: BundleEnd[];
  dests: BundleEnd[];
}

/**
 * Region of a place at a given depth, from its name: depth 0 is the country (the last part, as in
 * "Braga, Portugal"), depth 1 the last two parts, and so on. A name with a single part ("Porto")
 * says nothing about its country, so at depth 0 it falls in a coarse 8° grid cell instead; deeper
 * than its name goes, a place is just its own location.
 */
export function regionOf(p: Place, depth: number): string {
  const parts = (p.place ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (depth === 0 && parts.length < 2) return `grid:${Math.floor(p.lat / 8)},${Math.floor(p.lon / 8)}`;
  if (parts.length > depth) return parts.slice(parts.length - 1 - depth).join('|');
  return `at:${placeKey(p)}`;
}

/** The two regions a move goes between: countries if they differ, else states, else the places. */
function routeRegions(f: Flow): [string, string] {
  for (let depth = 0; depth < 6; depth++) {
    const a = regionOf(f.from, depth);
    const b = regionOf(f.to, depth);
    if (a !== b) return [a, b];
  }
  return [`at:${placeKey(f.from)}`, `at:${placeKey(f.to)}`];
}

/** Merge places closer than `radius` pixels into one end, centred on their people. */
function clusterEnds(items: { place: Place; flow: Flow }[], project: (p: Place) => Pt, radius: number): BundleEnd[] {
  const byPlace = new Map<string, { pt: Pt; flows: Flow[]; count: number }>();
  for (const { place, flow } of items) {
    const key = placeKey(place);
    const e = byPlace.get(key) ?? { pt: project(place), flows: [], count: 0 };
    e.flows.push(flow);
    e.count += flow.parents.length;
    byPlace.set(key, e);
  }
  const ends: (BundleEnd & { anchor: Pt })[] = [];
  for (const e of [...byPlace.values()].sort((a, b) => b.count - a.count)) {
    const near = ends.find((c) => Math.hypot(c.anchor[0] - e.pt[0], c.anchor[1] - e.pt[1]) < radius);
    if (!near) {
      ends.push({ pt: e.pt, anchor: e.pt, count: e.count, flows: [...e.flows] });
      continue;
    }
    const w = near.count + e.count;
    near.pt = [(near.pt[0] * near.count + e.pt[0] * e.count) / w, (near.pt[1] * near.count + e.pt[1] * e.count) / w];
    near.count = w;
    near.flows.push(...e.flows);
  }
  return ends.map(({ anchor: _a, ...e }) => e);
}

/**
 * Group flows into bundles. The trunk is the same at every zoom: one per generation and pair of
 * regions (countries, or states within a country). Only the ends depend on zoom: places closer than
 * `radius` pixels share an end, so zooming out gathers the branches and zooming in splits them out
 * to each city. Moves that would be shorter than `radius` on screen are left out at this zoom.
 */
export function bundleFlows(flows: Flow[], project: (p: Place) => Pt, radius: number): Bundle[] {
  const groups = new Map<string, { gen: number; step: number; pair: string; flows: Flow[] }>();
  for (const f of flows) {
    const pair = routeRegions(f).join('>');
    const key = `${f.gen}|${f.step}|${pair}`;
    const g = groups.get(key) ?? { gen: f.gen, step: f.step, pair, flows: [] };
    g.flows.push(f);
    groups.set(key, g);
  }

  const bundles: (Bundle & { pair: string })[] = [];
  for (const { gen, step, pair, flows: fs } of groups.values()) {
    const origins = clusterEnds(fs.map((f) => ({ place: f.from, flow: f })), project, radius);
    const dests = clusterEnds(fs.map((f) => ({ place: f.to, flow: f })), project, radius);
    const total = new Set(fs.flatMap((f) => f.parents)).size;
    const O = origins.length === 1 ? origins[0].pt : centroid(origins);
    const D = dests.length === 1 ? dests[0].pt : centroid(dests);
    if (Math.hypot(D[0] - O[0], D[1] - O[1]) < radius) continue; // too short to see at this zoom
    bundles.push({ gen, step, lane: 0, total, origins, dests, pair });
  }

  // Generations sharing a pair of regions get their own lane, most recent first.
  const byPair = new Map<string, Bundle[]>();
  for (const b of bundles) byPair.set(b.pair, [...(byPair.get(b.pair) ?? []), b]);
  for (const group of byPair.values()) group.sort((a, b) => a.gen - b.gen).forEach((b, i) => (b.lane = i));
  return bundles.map(({ pair: _p, ...b }) => b);
}

/** A piece of a bundle to draw: branches merging in, the shared trunk, or branches splitting out. */
export interface BundlePath {
  kind: 'in' | 'trunk' | 'out';
  pts: Pt[];
  /** People along this piece (sets its width). */
  count: number;
  /** The bundle end this branch leads from ('in') or to ('out'). */
  end?: BundleEnd;
}

/** Points along a quadratic Bézier curve. */
export function quadPoints(p0: Pt, c: Pt, p1: Pt, steps = 16): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]] as Pt;
  });
}

/** Unit vector from a to b. */
const unit = (a: Pt, b: Pt): Pt => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};

/**
 * Shapes for a bundle: several origins merge into the trunk near the start, the trunk carries
 * everyone, and it splits into one branch per destination near the end. A bundle with a single
 * origin and destination is just one curved arrow.
 *
 * The merge and split points sit past every origin/destination along the direction of travel (so
 * no branch has to double back) but never more than a quarter of the way, and branches join the
 * trunk heading the same way it does, so there are no kinks.
 */
export function bundleGeometry(b: Bundle, bend: number): BundlePath[] {
  const O = b.origins.length === 1 ? b.origins[0].pt : centroid(b.origins);
  const D = b.dests.length === 1 ? b.dests[0].pt : centroid(b.dests);
  const len = Math.hypot(D[0] - O[0], D[1] - O[1]) || 1;
  const u = unit(O, D);
  const along = (p: Pt, from: Pt) => (p[0] - from[0]) * u[0] + (p[1] - from[1]) * u[1];
  const reach = (ends: BundleEnd[], c: Pt, sign: 1 | -1) => {
    if (ends.length < 2) return 0;
    const spread = Math.max(...ends.map((e) => Math.hypot(e.pt[0] - c[0], e.pt[1] - c[1])));
    const ahead = Math.max(...ends.map((e) => sign * along(e.pt, c))); // furthest end past the centre
    return Math.min(Math.max(spread * 0.8, ahead + 20), len / 4);
  };
  const mergeDist = reach(b.origins, O, 1);
  const splitDist = reach(b.dests, D, -1);
  const M: Pt = [O[0] + u[0] * mergeDist, O[1] + u[1] * mergeDist];
  const S: Pt = [D[0] - u[0] * splitDist, D[1] - u[1] * splitDist];

  const single = b.dests.length === 1;
  const trunkPts = arcPoints(M, S, bend);
  const startDir = unit(trunkPts[0], trunkPts[1]);
  const endDir = unit(trunkPts[trunkPts.length - 2], trunkPts[trunkPts.length - 1]);

  const paths: BundlePath[] = [];
  if (b.origins.length > 1) {
    for (const e of b.origins) {
      // Arrive at the merge point already heading along the trunk, without overshooting past it.
      const ahead = (M[0] - e.pt[0]) * startDir[0] + (M[1] - e.pt[1]) * startDir[1];
      const k = Math.max(0, Math.min(Math.hypot(M[0] - e.pt[0], M[1] - e.pt[1]) * 0.5, ahead * 0.8));
      const c: Pt = [M[0] - startDir[0] * k, M[1] - startDir[1] * k];
      paths.push({ kind: 'in', pts: quadPoints(e.pt, c, M), count: e.count, end: e });
    }
  }
  paths.push({ kind: single ? 'out' : 'trunk', pts: trunkPts, count: b.total, end: single ? b.dests[0] : undefined });
  if (!single) {
    for (const e of b.dests) {
      // Leave the split point still heading the way the trunk was going, then turn to the destination;
      // never further ahead than the destination itself, so the branch doesn't hook back.
      const ahead = (e.pt[0] - S[0]) * endDir[0] + (e.pt[1] - S[1]) * endDir[1];
      const k = Math.max(0, Math.min(Math.hypot(e.pt[0] - S[0], e.pt[1] - S[1]) * 0.5, ahead * 0.8));
      const c: Pt = [S[0] + endDir[0] * k, S[1] + endDir[1] * k];
      paths.push({ kind: 'out', pts: quadPoints(S, c, e.pt), count: e.count, end: e });
    }
  }
  return paths;
}

/** How much a route curves for the `lane`-th generation sharing it: a little more each, within limits. */
export function laneBend(lane: number): number {
  return 0.1 + 0.035 * Math.min(lane, 4);
}

/** The path with its last `gap` pixels removed (e.g. to stop an arrow before a marker). */
export function trimEnd(pts: Pt[], gap: number): Pt[] {
  const total = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  if (total <= gap * 1.5) return cutPath(pts, 0.4); // very short: keep a stub so the arrow still shows
  return cutPath(pts, (total - gap) / total);
}

/** The first `frac` (0..1) of a path, by length, ending exactly at that point. */
export function cutPath(pts: Pt[], frac: number): Pt[] {
  if (frac >= 1) return pts;
  if (frac <= 0) return [pts[0]];
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) * frac;
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const t = seg[i] ? left / seg[i] : 0;
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
      return out;
    }
    left -= seg[i];
    out.push(pts[i + 1]);
  }
  return out;
}
