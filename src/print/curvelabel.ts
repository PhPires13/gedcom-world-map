// Text lettered along a route, as engravers wrote a family's name along its voyage: on the
// outside of the curve, reading left to right, kept clear of the stroke.

import { n } from './svg';
import type { Box, Pt } from './types';

export const pathLength = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** The point `d` mm along a line, and the direction there. */
export function pointAt(pts: Pt[], d: number): { p: Pt; dir: Pt } {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (left <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, left / seg) : 0;
      const dir: Pt = seg ? [(pts[i][0] - pts[i - 1][0]) / seg, (pts[i][1] - pts[i - 1][1]) / seg] : [1, 0];
      return { p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t], dir };
    }
    left -= seg;
  }
  return { p: pts[0], dir: [1, 0] };
}

/** The line moved sideways by `d` mm (positive = to the left of its direction, i.e. up on screen when going right). */
export function offsetLine(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + ((b[1] - a[1]) / l) * d, p[1] - ((b[0] - a[0]) / l) * d];
  });
}

/** Smooth SVG path through the points (Catmull–Rom as cubic Béziers), so lettering flows evenly. */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`;
  }
  return d;
}

export interface CurveLabel {
  /** Baseline to letter the text along (reading left to right). */
  baseline: Pt[];
  /** Where the middle of the text sits, as a share of the baseline's length. */
  at: number;
  /** Boxes covering the lettering, for collision checks. */
  boxes: Box[];
}

/**
 * Where to letter text of width `w` and height `h` along a route that bows to the left of its
 * direction of travel (as all routes do, see arcPoints): on that outer side, `gap` beyond the
 * stroke's half-width `half`, reading left to right. Tries the middle first, then either side of
 * it; returns null if the text doesn't fit on the curve or every spot collides.
 */
export function placeAlongCurve(
  route: Pt[],
  w: number,
  h: number,
  half: number,
  gap: number,
  blocked: (b: Box) => boolean,
): CurveLabel | null {
  if (route.length < 2) return null;
  const reversed = route[route.length - 1][0] < route[0][0];
  const reading = reversed ? [...route].reverse() : route;
  // Not reversed: the outside is to the reading line's left (where letters rise); letters sit on a
  // baseline just outside the stroke. Reversed: the outside is below, so the baseline goes lower
  // by the letters' height and they rise towards the route.
  const off = reversed ? -(half + gap + h * 0.78) : half + gap;
  const baseline = offsetLine(reading, off);
  const L = pathLength(baseline);
  if (w > L * 0.9) return null;
  for (const at of [0.5, 0.4, 0.6, 0.32, 0.68]) {
    const start = L * at - w / 2;
    if (start < L * 0.04 || start + w > L * 0.96) continue;
    const boxes: Box[] = [];
    const steps = Math.max(2, Math.ceil(w / (h * 0.7)));
    for (let i = 0; i <= steps; i++) {
      const { p, dir } = pointAt(baseline, start + (i / steps) * w);
      // Middle of the letters: half their height up from the baseline (to the left of reading).
      const c: Pt = [p[0] + dir[1] * h * 0.4, p[1] - dir[0] * h * 0.4];
      boxes.push({ x: c[0] - h * 0.42, y: c[1] - h * 0.42, w: h * 0.84, h: h * 0.84 });
    }
    if (!boxes.some(blocked)) return { baseline, at, boxes };
  }
  return null;
}

/**
 * Most common surnames among the people who moved (the family name: the last of a compound one).
 * Ties go to the one listed first, so callers list fathers first. A second name is added only when
 * at least two people carry it and it's nearly as common as the first.
 */
export function routeSurnames(surnames: string[], max = 2): string[] {
  const counts = new Map<string, number>();
  for (const s of surnames) {
    const last = s.trim().split(/\s+/).filter(Boolean).pop();
    if (last) counts.set(last, (counts.get(last) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]); // stable: ties keep their order
  if (!sorted.length) return [];
  const top = sorted[0][1];
  return sorted.filter(([, c], i) => i === 0 || c >= Math.max(2, top * 0.5)).slice(0, max).map(([s]) => s);
}
