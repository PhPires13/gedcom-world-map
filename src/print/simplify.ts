// The "essential" routes of a family: instead of one arrow per generation per pair of towns, a
// few arrows between regions (countries, or a layout's medallions), each carrying everyone who
// made that move across all generations, and only the most important ones. Pure, so the
// interactive map can use the same selection.

import type { Flow, Place } from '../flows';
import type { Pt } from './types';

export interface EssentialRoute {
  fromRegion: string;
  toRegion: string;
  /** The town most of the movers left from, and the one most of their children were born in. */
  from: Place;
  to: Place;
  /** All the moves merged into this route. */
  flows: Flow[];
  /** People who moved along it (each once). */
  movers: string[];
  children: string[];
  /** Movers in the direct line of the person the print is centred on. */
  directMovers: number;
  /** The generation that colours the route: the one with most movers, the most recent on a tie. */
  gen: number;
  /** The generation of the children born after the move that dates it (most recent among the dominant). */
  step: number;
  score: number;
}

export interface SimplifyOptions {
  /** Region of a place: a country code, a district, a medallion… */
  regionOf: (p: Place) => string;
  /** Most routes to keep. */
  maxRoutes: number;
  /** Ids of the direct line (the person the print is centred on and their ancestors). */
  directLine?: Set<string>;
  /** Each mover in the direct line counts as 1 + boost people when ranking. */
  directBoost?: number;
  /**
   * How many routes may stay within a region (0 = moves within a region are dropped). They come on
   * top of maxRoutes, never more than a third of it in all.
   */
  internalRoutes?: (region: string) => number;
  /** Where a place lands on the sheet, to avoid routes that would cross. */
  project?: (p: Place) => Pt | null;
}

const placeKey = (p: Place) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

/** The place that occurs most often (weighted), keeping the first on a tie. */
function mostCommon(items: { place: Place; n: number }[]): Place {
  const tally = new Map<string, { place: Place; n: number }>();
  for (const { place, n } of items) {
    const e = tally.get(placeKey(place)) ?? { place, n: 0 };
    e.n += n;
    tally.set(placeKey(place), e);
  }
  return [...tally.values()].reduce((a, b) => (b.n > a.n ? b : a)).place;
}

/** Whether two segments cross (endpoints touching doesn't count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  if (near(a, c) || near(a, d) || near(b, c) || near(b, d)) return false;
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Merges moves into one route per pair of regions and keeps the most important: ranked by the
 * number of people who moved, direct-line movers boosted. Routes that would cross one already kept
 * are only taken if there's room left once every route that doesn't cross has been considered.
 */
export function essentialRoutes(flows: Flow[], o: SimplifyOptions): EssentialRoute[] {
  const groups = new Map<string, { from: string; to: string; flows: Flow[] }>();
  for (const f of flows) {
    const from = o.regionOf(f.from);
    const to = o.regionOf(f.to);
    const key = `${from}>${to}`;
    const g = groups.get(key) ?? { from, to, flows: [] };
    g.flows.push(f);
    groups.set(key, g);
  }
  const boost = o.directBoost ?? 0;
  const routes: EssentialRoute[] = [...groups.values()].map((g) => {
    const movers = [...new Set(g.flows.flatMap((f) => f.parents))];
    const children = [...new Set(g.flows.flatMap((f) => f.children))];
    const directMovers = movers.filter((id) => o.directLine?.has(id)).length;
    // The generation with the most movers colours the route; on a tie, the most recent.
    const perGen = new Map<number, Set<string>>();
    for (const f of g.flows) for (const p of f.parents) perGen.set(f.gen, (perGen.get(f.gen) ?? new Set()).add(p));
    const gen = [...perGen].sort((a, b) => b[1].size - a[1].size || a[0] - b[0])[0][0];
    const step = Math.min(...g.flows.filter((f) => f.gen === gen).map((f) => f.step));
    return {
      fromRegion: g.from,
      toRegion: g.to,
      from: mostCommon(g.flows.map((f) => ({ place: f.from, n: f.parents.length }))),
      to: mostCommon(g.flows.map((f) => ({ place: f.to, n: f.children.length }))),
      flows: g.flows,
      movers,
      children,
      directMovers,
      gen,
      step,
      score: movers.length + boost * directMovers,
    };
  });
  // Most important first; on a tie, the direct line's, then the earlier move (older generation),
  // then by name, so the choice is stable.
  routes.sort(
    (a, b) =>
      b.score - a.score || b.directMovers - a.directMovers || b.gen - a.gen || `${a.fromRegion}>${a.toRegion}`.localeCompare(`${b.fromRegion}>${b.toRegion}`),
  );

  const chosen: EssentialRoute[] = [];
  const internalUsed = new Map<string, number>();
  const ends = (r: EssentialRoute): [Pt, Pt] | null => {
    const a = o.project?.(r.from);
    const b = o.project?.(r.to);
    return a && b ? [a, b] : null;
  };
  const allowed = (r: EssentialRoute) => (internalUsed.get(r.fromRegion) ?? 0) < (o.internalRoutes?.(r.fromRegion) ?? 0);
  const take = (r: EssentialRoute) => {
    chosen.push(r);
    if (r.fromRegion === r.toRegion) internalUsed.set(r.fromRegion, (internalUsed.get(r.fromRegion) ?? 0) + 1);
  };
  const crosses = (r: EssentialRoute) => {
    const e = ends(r);
    if (!e) return false;
    return chosen.some((c) => {
      const f = ends(c);
      return !!f && segmentsCross(e[0], e[1], f[0], f[1]);
    });
  };
  // Routes between regions first, those that cross nothing before those that would; then a few
  // routes within a region where the layout allows them (a medallion), on top of the cap but
  // never more than a third of it.
  const between = routes.filter((r) => r.fromRegion !== r.toRegion);
  const within = routes.filter((r) => r.fromRegion === r.toRegion);
  const deferred: EssentialRoute[] = [];
  for (const r of between) {
    if (chosen.length >= o.maxRoutes) break;
    if (crosses(r)) deferred.push(r);
    else take(r);
  }
  for (const r of deferred) {
    if (chosen.length >= o.maxRoutes) break;
    take(r);
  }
  const extra = Math.ceil(o.maxRoutes / 3);
  for (const r of within) {
    if (chosen.length - Math.min(chosen.length, o.maxRoutes) >= extra && chosen.length >= o.maxRoutes) break;
    if (internalUsed.size && [...internalUsed.values()].reduce((a, b) => a + b, 0) >= extra) break;
    if (allowed(r)) take(r);
  }
  return chosen;
}

/** Each essential route as a single move, so the usual flow drawing (and its labels) applies. */
export function routesAsFlows(routes: EssentialRoute[]): Flow[] {
  return routes.map((r) => ({ from: r.from, to: r.to, gen: r.gen, step: r.step, parents: r.movers, children: r.children, lane: 0 }));
}

/** How many routes a print of this size carries: fewer on a small sheet. */
export const routeCap = (paper: 'A3' | 'A2' | 'A1') => ({ A3: 5, A2: 7, A1: 8 })[paper];
