// Migration routes on the print: the same bundled flow map as the web app (src/flows.ts), but
// projected into the print's millimetres and turned into pen strokes with arrowheads.

import { bundleFlows, bundleGeometry, laneBend, trimEnd, type Bundle, type Flow, type Place } from '../flows';
import type { Pt } from './types';

export interface RouteStroke {
  /** Generation of the people who moved (colours the route). */
  gen: number;
  kind: 'in' | 'trunk' | 'out';
  /** Centre line, in mm on the sheet. */
  pts: Pt[];
  width: number;
  /** Starts at an origin, so it's drawn tapering in like a pen stroke. */
  fromOrigin: boolean;
  /** Arrowhead at the end of a branch reaching a destination: tip, then the two barbs. */
  arrow?: [Pt, Pt, Pt];
}

export interface RouteDate {
  text: string;
  /** Centre of the label. */
  at: Pt;
  /** Rotation in degrees, kept upright. */
  angle: number;
  gen: number;
}

/** The main piece of a bundle (its trunk, or the route itself), for lettering along. */
export interface RouteMain {
  pts: Pt[];
  gen: number;
  /** Stroke width of the piece. */
  width: number;
  /** Years of the births that date the move ("1902", "1890–1905"); empty if unknown. */
  years: string;
  /** Ids of the people who moved along it. */
  movers: string[];
}

export interface RouteOptions {
  /** Places closer than this (mm) share a bundle end. */
  radius: number;
  minWidth: number;
  maxWidth: number;
  /** Gap left between an arrow tip and the destination mark. */
  endGap: number;
  arrowSize: number;
  /** Hand-drawn wobble, in mm (0 = none). */
  wobble: number;
  /** Distance of date labels from the route's centre line. */
  dateOffset: number;
}

/** Width of a route carrying `count` people, when the busiest carries `max`. */
export function routeWidth(count: number, max: number, minW: number, maxW: number): number {
  if (max <= 1) return minW;
  return minW + (maxW - minW) * Math.sqrt((count - 1) / (max - 1));
}

/** Small deterministic noise, so the same route always wobbles the same way. */
function noise(seed: number, i: number): number {
  return Math.sin(i * 0.83 + seed) * 0.6 + Math.sin(i * 2.11 + seed * 1.7) * 0.4;
}

/** Shifts the inner points of a line sideways a little, as a hand would; the ends stay put. */
export function wobble(pts: Pt[], amount: number, seed: number): Pt[] {
  if (amount <= 0 || pts.length < 3) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = pts[i - 1];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    // Fade in and out so joins between pieces stay smooth.
    const edge = Math.min(i, pts.length - 1 - i) / 3;
    const d = amount * noise(seed, i) * Math.min(1, edge);
    return [p[0] + nx * d, p[1] + ny * d];
  });
}

const along = (pts: Pt[], back: number): Pt => {
  // The point `back` mm before the end of the line.
  let left = back;
  for (let i = pts.length - 1; i > 0; i--) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (left <= seg) {
      const t = seg ? left / seg : 0;
      return [pts[i][0] + (pts[i - 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i - 1][1] - pts[i][1]) * t];
    }
    left -= seg;
  }
  return pts[0];
};

/** Arrowhead with its tip at the end of the line, pointing along it. */
export function arrowAtEnd(pts: Pt[], size: number): [Pt, Pt, Pt] {
  const tip = pts[pts.length - 1];
  const from = along(pts, size);
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const back = (da: number): Pt => [tip[0] - size * Math.cos(a + da), tip[1] - size * Math.sin(a + da)];
  return [tip, back(0.42), back(-0.42)];
}

/** Text for the years a move happened, from the birth years of the children it's dated by. */
export function yearsLabel(years: number[]): string {
  if (!years.length) return '';
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/**
 * Turns flows into strokes in print coordinates. Flows whose ends can't be projected (off the
 * map's projection) are dropped. Small bundles come first so the big routes are drawn on top.
 */
export function projectRoutes(
  flows: Flow[],
  project: (p: Place) => Pt | null,
  opts: RouteOptions,
  birthYear: (childId: string) => number | undefined,
): { strokes: RouteStroke[]; dates: RouteDate[]; bundles: Bundle[]; mains: RouteMain[] } {
  const visible = flows.filter((f) => project(f.from) && project(f.to));
  const bundles = bundleFlows(visible, (p) => project(p)!, opts.radius).sort((a, b) => a.total - b.total);
  const max = Math.max(1, ...bundles.flatMap((b) => [b.total, ...b.origins.map((e) => e.count), ...b.dests.map((e) => e.count)]));
  const strokes: RouteStroke[] = [];
  const dates: RouteDate[] = [];
  const mains: RouteMain[] = [];

  for (const [bi, b] of bundles.entries()) {
    const paths = bundleGeometry(b, laneBend(b.lane));
    const hasIn = paths.some((p) => p.kind === 'in');
    const hasTrunk = paths.some((p) => p.kind === 'trunk');
    for (const [pi, path] of paths.entries()) {
      const width = routeWidth(path.count, max, opts.minWidth, opts.maxWidth);
      let pts = wobble(path.pts, opts.wobble, bi * 7.3 + pi * 3.1);
      let arrow: RouteStroke['arrow'];
      if (path.kind === 'out') {
        pts = trimEnd(pts, opts.endGap);
        // Arrowheads grow with the route, so a heavy route doesn't end in a tiny point.
        if (opts.arrowSize > 0 && pts.length >= 2) arrow = arrowAtEnd(pts, Math.max(opts.arrowSize, width * 2.8));
      }
      const fromOrigin = path.kind === 'in' || (path.kind === 'trunk' && !hasIn) || (path.kind === 'out' && !hasIn && !hasTrunk);
      strokes.push({ gen: b.gen, kind: path.kind, pts, width, fromOrigin, arrow });
    }

    // One date per bundle, on the outside of the bend in the middle of its main piece.
    const main = paths.find((p) => p.kind === 'trunk') ?? paths.find((p) => p.kind === 'out' && !hasTrunk);
    const children = [...new Set([...b.dests.flatMap((e) => e.flows.flatMap((f) => f.children))])];
    const text = yearsLabel(children.map(birthYear).filter((y): y is number => y !== undefined));
    if (main) {
      const movers = [...new Set(b.origins.flatMap((e) => e.flows.flatMap((f) => f.parents)))];
      const stroke = strokes[strokes.length - paths.length + paths.indexOf(main)];
      mains.push({ pts: stroke.pts, gen: b.gen, width: stroke.width, years: text, movers });
    }
    if (main && text) {
      const mid = Math.floor(main.pts.length / 2);
      const a = main.pts[Math.max(0, mid - 1)];
      const c = main.pts[Math.min(main.pts.length - 1, mid + 1)];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      // Routes bow to the left of their direction of travel (see arcPoints), so that's the outside.
      const nx = (c[1] - a[1]) / len;
      const ny = -(c[0] - a[0]) / len;
      const off = opts.dateOffset + routeWidth(b.total, max, opts.minWidth, opts.maxWidth) / 2;
      let angle = (Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      dates.push({ text, at: [main.pts[mid][0] + nx * off, main.pts[mid][1] + ny * off], angle, gen: b.gen });
    }
  }
  return { strokes, dates, bundles, mains };
}

/**
 * Outline of a stroke whose width can vary along it (thin at the start when it tapers), as a
 * closed polygon for SVG.
 */
export function ribbon(pts: Pt[], width: (t: number) => number): Pt[] {
  if (pts.length < 2) return [];
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const hw = width(run / total) / 2;
    left.push([pts[i][0] + nx * hw, pts[i][1] + ny * hw]);
    right.push([pts[i][0] - nx * hw, pts[i][1] - ny * hw]);
    if (i < seg.length) run += seg[i];
  }
  return [...left, ...right.reverse()];
}
