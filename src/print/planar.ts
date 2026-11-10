// Map geometry flattened to the sheet: rings of points in mm, which the artistic layouts move,
// scale and clip themselves (d3 only projects; what happens after is plain 2-D geometry).

import type { GeoProjection, GeoStream } from 'd3-geo';
import type { Geometry } from 'geojson';
import { n } from './svg';
import type { Box, Pt } from './types';

export type Ring = Pt[];

/** Projects a geometry to rings on the sheet, letting d3 handle antimeridian cuts and resampling. */
export function projectRings(geometry: Geometry, projection: GeoProjection): Ring[] {
  const rings: Ring[] = [];
  let ring: Ring | null = null;
  const sink: GeoStream = {
    point(x, y) {
      if (ring && Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
    },
    lineStart() {
      ring = [];
    },
    lineEnd() {
      if (ring && ring.length > 2) rings.push(ring);
      ring = null;
    },
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  };
  streamGeometry(geometry, projection.stream(sink));
  return rings;
}

/** Feeds a geometry into a d3 stream (Polygon and MultiPolygon, the only kinds country data has). */
function streamGeometry(g: Geometry, stream: GeoStream) {
  const polygon = (coords: number[][][]) => {
    stream.polygonStart();
    for (const r of coords) {
      stream.lineStart();
      // GeoJSON rings repeat their first point at the end; d3 streams don't.
      for (let i = 0; i < r.length - 1; i++) stream.point(r[i][0], r[i][1]);
      stream.lineEnd();
    }
    stream.polygonEnd();
  };
  if (g.type === 'Polygon') polygon(g.coordinates);
  else if (g.type === 'MultiPolygon') for (const p of g.coordinates) polygon(p);
  else if (g.type === 'GeometryCollection') for (const x of g.geometries) streamGeometry(x, stream);
}

/** Signed area (positive or negative depending on winding). */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

export function ringCentroid(r: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f;
    cx += (r[j][0] + r[i][0]) * f;
    cy += (r[j][1] + r[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function ringsBounds(rings: Ring[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether a point is inside a set of rings (even–odd, so holes work). */
export function pointInRings(p: Pt, rings: Ring[]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Clips a ring to a rectangle (Sutherland–Hodgman); empty if it falls outside. */
export function clipRing(ring: Ring, b: Box): Ring {
  const edges: [(p: Pt) => boolean, (a: Pt, c: Pt) => Pt][] = [
    [(p) => p[0] >= b.x, (a, c) => [b.x, a[1] + ((b.x - a[0]) * (c[1] - a[1])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.x + b.w, (a, c) => [b.x + b.w, a[1] + ((b.x + b.w - a[0]) * (c[1] - a[1])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.y, (a, c) => [a[0] + ((b.y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]), b.y]],
    [(p) => p[1] <= b.y + b.h, (a, c) => [a[0] + ((b.y + b.h - a[1]) * (c[0] - a[0])) / (c[1] - a[1]), b.y + b.h]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

export type Transform = (p: Pt) => Pt;

/** An affine "scale about a centre, then move" transform. */
export const scaleAbout = (center: Pt, s: number, shift: Pt = [0, 0]): Transform => (p) => [
  center[0] + (p[0] - center[0]) * s + shift[0],
  center[1] + (p[1] - center[1]) * s + shift[1],
];

/** SVG path data for rings after a transform, optionally clipped to a box. */
export function ringsPath(rings: Ring[], t: Transform = (p) => p, clip?: Box, minStep = 0.05): string {
  let d = '';
  for (const r of rings) {
    let pts = r.map(t);
    if (clip) {
      const bb = ringsBounds([pts]);
      // Skip rings entirely outside the clip box, keep those entirely inside as they are.
      if (bb.x > clip.x + clip.w || bb.y > clip.y + clip.h || bb.x + bb.w < clip.x || bb.y + bb.h < clip.y) continue;
      if (!(bb.x >= clip.x && bb.y >= clip.y && bb.x + bb.w <= clip.x + clip.w && bb.y + bb.h <= clip.y + clip.h)) pts = clipRing(pts, clip);
    }
    if (pts.length < 3) continue;
    // Drop points closer than `minStep` mm to the previous one: invisible, and they bloat the file.
    let last: Pt | null = null;
    let seg = '';
    for (const p of pts) {
      if (last && Math.abs(p[0] - last[0]) < minStep && Math.abs(p[1] - last[1]) < minStep) continue;
      seg += `${seg ? 'L' : 'M'}${n(p[0])},${n(p[1])}`;
      last = p;
    }
    d += `${seg}Z`;
  }
  return d;
}
