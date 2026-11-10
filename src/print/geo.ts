// Paper sizes, projections and their extents, and measurements on the projected map.
// Coordinates on the print are millimetres from the top-left corner of the sheet.

import {
  geoAzimuthalEqualArea,
  geoDistance,
  geoMercator,
  geoNaturalEarth1,
  type GeoProjection,
} from 'd3-geo';
import type { AreaId, Box, Orientation, PaperSize, Pt } from './types';

// ---------- Paper ----------

export const PAPER_MM: Record<PaperSize, [number, number]> = { A3: [297, 420], A2: [420, 594], A1: [594, 841] };

/** Sheet size in mm. */
export function pageSize(paper: PaperSize, orientation: Orientation): { w: number; h: number } {
  const [short, long] = PAPER_MM[paper];
  return orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long };
}

/**
 * Styles are designed on A2; other sizes are the same design enlarged or reduced. A-series sheets all
 * have the same proportions, so this keeps the layout identical across sizes.
 */
export function sizeScale(paper: PaperSize): number {
  return PAPER_MM[paper][0] / PAPER_MM.A2[0];
}

/** Pixels needed to print `mm` at `dpi`. */
export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

// ---------- Areas and projections ----------

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export const AREAS: Record<Exclude<AreaId, 'family' | 'world'>, BBox> = {
  atlantic: [-100, -42, 32, 62],
  europe: [-25, 34, 42, 71],
  iberia: [-18, 27, 5, 45],
  'south-america': [-84, -56, -32, 13],
  'north-america': [-130, 12, -55, 62],
  africa: [-20, -36, 53, 38],
};

/** Points along the edge of a lon/lat box, for fitting a projection to it (a polygon's winding is fiddly). */
export function bboxOutline([w, s, e, n]: BBox, step = 2): Pt[] {
  const pts: Pt[] = [];
  for (let x = w; x <= e; x += step) pts.push([x, s], [x, n]);
  for (let y = s; y <= n; y += step) pts.push([w, y], [e, y]);
  pts.push([e, s], [e, n]);
  return pts;
}

/** Box around the family's places, never smaller than a few degrees so one town still shows its region. */
export function familyBBox(points: { lat: number; lon: number }[]): BBox | null {
  if (!points.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const minLon = 6;
  const minLat = 4;
  if (e - w < minLon) [w, e] = [(w + e) / 2 - minLon / 2, (w + e) / 2 + minLon / 2];
  if (n - s < minLat) [s, n] = [(s + n) / 2 - minLat / 2, (s + n) / 2 + minLat / 2];
  return [w, Math.max(-85, s), e, Math.min(85, n)];
}

export const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });

/**
 * The projection for an area, fitted into `frame` (with some padding), and clipped to the frame.
 * World maps use Natural Earth; regions an azimuthal equal-area projection centred on them (little
 * distortion at any size); very wide regions Natural Earth centred on them. A style can ask for
 * Mercator instead (as on a sea chart).
 */
export function makeProjection(
  area: AreaId,
  points: { lat: number; lon: number }[],
  frame: Box,
  pref: 'auto' | 'mercator' = 'auto',
  /** Room around the family's places, as a share of the frame's shorter side. */
  familyPadding = 0.11,
): GeoProjection {
  const box = area === 'family' ? familyBBox(points) : area === 'world' ? null : AREAS[area];
  const short = Math.min(frame.w, frame.h);
  let projection: GeoProjection;
  if (!box) {
    // The whole world.
    const fit = inset(frame, short * 0.03);
    const extent: [Pt, Pt] = [
      [fit.x, fit.y],
      [fit.x + fit.w, fit.y + fit.h],
    ];
    projection =
      pref === 'mercator'
        ? geoMercator().fitExtent(extent, { type: 'MultiPoint', coordinates: bboxOutline([-180, -58, 180, 78], 10) })
        : geoNaturalEarth1().fitExtent(extent, { type: 'Sphere' });
  } else {
    const [w, s, e, n] = box;
    const cLon = (w + e) / 2;
    const cLat = (s + n) / 2;
    if (pref === 'mercator') projection = geoMercator().rotate([-cLon, 0]);
    else if (e - w > 140) projection = geoNaturalEarth1().rotate([-cLon, 0]);
    else projection = geoAzimuthalEqualArea().rotate([-cLon, -cLat]);
    // The family's own places get more room around them, so marks and names don't touch the frame.
    const fit = inset(frame, short * (area === 'family' ? familyPadding : 0.02));
    projection.fitExtent(
      [
        [fit.x, fit.y],
        [fit.x + fit.w, fit.y + fit.h],
      ],
      { type: 'MultiPoint', coordinates: bboxOutline(box) },
    );
  }
  projection.clipExtent([
    [frame.x, frame.y],
    [frame.x + frame.w, frame.y + frame.h],
  ]);
  return projection;
}

/** Whether the projection draws the whole globe (so the sea stops at its outline). */
export const showsWholeSphere = (area: AreaId, pref: 'auto' | 'mercator') => area === 'world' && pref !== 'mercator';

// ---------- Measuring ----------

/** Kilometres per millimetre at a point on the map, measured east–west. */
export function kmPerMm(projection: GeoProjection, at: Pt): number {
  const a = projection.invert?.([at[0] - 5, at[1]]);
  const b = projection.invert?.([at[0] + 5, at[1]]);
  if (!a || !b) return NaN;
  return (geoDistance(a, b) * 6371) / 10;
}

/** A round length (1, 2, 2.5 or 5 × 10ⁿ km) whose bar is close to `targetMm` long. */
export function niceScaleKm(kmPerMmValue: number, targetMm: number): number {
  const raw = kmPerMmValue * targetMm;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10];
  let best = pow;
  for (const s of steps) if (Math.abs(s * pow - raw) < Math.abs(best - raw)) best = s * pow;
  return best;
}

export interface FrameTick {
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Position along the side, in mm on the sheet (x for top/bottom, y for left/right). */
  pos: number;
  /** Longitude (top/bottom) or latitude (left/right) in degrees. */
  deg: number;
}

/** Where the graticule's meridians and parallels meet the edges of the map frame, for degree labels. */
export function frameTicks(projection: GeoProjection, frame: Box, step: number): FrameTick[] {
  const ticks: FrameTick[] = [];
  const [x0, y0, x1, y1] = [frame.x, frame.y, frame.x + frame.w, frame.y + frame.h];
  const maxJump = Math.max(frame.w, frame.h) * 0.2;
  const raw = (p: Pt): Pt | null => {
    // Projecting a point ignores the clip extent, so lines can be followed past the frame.
    const q = projection(p);
    return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? [q[0], q[1]] : null;
  };
  const cross = (pts: (Pt | null)[], deg: number, horizontalEdges: boolean) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > maxJump) continue;
      if (horizontalEdges) {
        for (const [y, side] of [
          [y0, 'top'],
          [y1, 'bottom'],
        ] as const) {
          if ((a[1] - y) * (b[1] - y) < 0) {
            const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
            if (x > x0 && x < x1) ticks.push({ side, pos: x, deg });
          }
        }
      } else {
        for (const [x, side] of [
          [x0, 'left'],
          [x1, 'right'],
        ] as const) {
          if ((a[0] - x) * (b[0] - x) < 0) {
            const y = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
            if (y > y0 && y < y1) ticks.push({ side, pos: y, deg });
          }
        }
      }
    }
  };
  for (let lon = -180; lon < 180; lon += step) {
    const pts: (Pt | null)[] = [];
    for (let lat = -85; lat <= 85; lat += 0.5) pts.push(raw([lon, lat]));
    cross(pts, lon, true);
  }
  for (let lat = -80; lat <= 80; lat += step) {
    const pts: (Pt | null)[] = [];
    for (let lon = -180; lon <= 180; lon += 0.5) pts.push(raw([lon, lat]));
    cross(pts, lat, false);
  }
  // One tick per degree value per side (a line can graze an edge twice).
  const seen = new Set<string>();
  return ticks
    .filter((t) => {
      const k = `${t.side}|${t.deg}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.side === b.side ? a.pos - b.pos : a.side.localeCompare(b.side)));
}

/** "40°N", "20°W" (or "20°O" in Portuguese). */
export function degreeLabel(deg: number, kind: 'lat' | 'lon', lang: 'pt' | 'en'): string {
  const a = Math.abs(Math.round(deg));
  if (a === 0) return '0°';
  if (kind === 'lat') return `${a}°${deg > 0 ? 'N' : 'S'}`;
  if (a === 180) return '180°';
  return `${a}°${deg > 0 ? (lang === 'pt' ? 'L' : 'E') : lang === 'pt' ? 'O' : 'W'}`;
}

/**
 * Which Natural Earth detail to draw at a given map scale: 1:50m for world and ocean-wide maps,
 * 1:10m once a millimetre on paper covers less than ~8 km (a country or region).
 */
export const topologyDetail = (kmPerMmValue: number): '50m' | '10m' => (kmPerMmValue < 8 ? '10m' : '50m');
