// Artistic map layouts. "Geographic" and "close-up" use a true projection (render.ts); the two
// here deliberately bend geography so the family's countries read clearly on the wall:
//
// - storybook: each country with family in it is enlarged around its middle and lifted off the
//   map; the continents on either side of an ocean are pulled together. Places and routes move
//   with their country, so everything stays consistent.
// - vignette (medallions): each group of family places becomes a round inset map, enlarged,
//   laid out roughly where it is in the world, and the routes run between the medallions.
//
// Both are described by data (layouts/*.json) and produce an ArtMap: where each place goes on
// the sheet, plus the SVG for the map underneath.

import type { GeoProjection } from 'd3-geo';
import type { Geometry, MultiPolygon, Polygon } from 'geojson';
import { distanceKm } from '../flows';
import type { CountryLocator } from './countries';
import { countryName } from './countries';
import { inset, kmPerMm, makeProjection } from './geo';
import { overlaps } from './layout';
import { pointInRings, projectRings, ringArea, ringCentroid, ringsBounds, ringsPath, scaleAbout, type Ring, type Transform } from './planar';
import type { PrintStyle } from './style';
import { el, n } from './svg';
import type { Box, Lang, Pt } from './types';

export const LAYOUT_KINDS = ['accurate', 'storybook', 'vignette'] as const;

export interface LayoutSpec {
  id: string;
  name: string;
  description?: string;
  kind: (typeof LAYOUT_KINDS)[number];
  /** accurate: always fit to the family's places (ignoring the chosen area), with this padding. */
  fitFamily?: boolean;
  /** Padding around the family's places, as a share of the map's shorter side. */
  padding?: number;
  storybook?: {
    /** Smallest size a family country is enlarged to, as a share of the family's extent. */
    targetShare: number;
    /** Most a country is enlarged. */
    maxScale: number;
    /** How far continents move towards each other across an ocean (0 = not at all, 0.5 = halfway). */
    pull: number;
    /** Overlap allowed between enlarged regions before they're pushed apart (share of their size). */
    overlap: number;
    /** Homelands closer than this (share of the family's extent) are enlarged together as one region. */
    regionShare: number;
    /** Strength of the shadow under the enlarged countries (0..1). */
    shadow: number;
    /** Opacity of the rest of the world (0..1). */
    background: number;
  };
  vignette?: {
    /** Medallion radius in mm on A2, for the smallest and the largest group of places. */
    minRadius: number;
    maxRadius: number;
    /** Places within this distance (km) in one country share a medallion. */
    clusterKm: number;
    /** Smallest area a medallion shows, as a radius in km, so one town still shows its region. */
    minKm: number;
    /** Share of the radius the family's places spread over. */
    fill: number;
    /** Opacity of the faint world map behind the medallions (0 = none). */
    ghost: number;
    /** Space between medallions, in mm on A2. */
    gap: number;
    /** Most medallions on one print; groups in the same country are merged to stay under it. */
    maxMedallions?: number;
    /** Most medallions for one country (its home region plus, say, its islands). */
    maxPerCountry?: number;
  };
}

export function validateLayout(s: unknown): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['layout must be an object'];
  const o = s as Record<string, any>;
  if (typeof o.id !== 'string' || !o.id) e.push('id must be a non-empty string');
  if (typeof o.name !== 'string' || !o.name) e.push('name must be a non-empty string');
  if (!LAYOUT_KINDS.includes(o.kind)) e.push(`kind must be one of ${LAYOUT_KINDS.join(', ')}`);
  const num = (path: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) e.push(`${path} must be a number between ${min} and ${max}`);
  };
  if (o.padding !== undefined) num('padding', o.padding, 0, 0.4);
  if (o.kind === 'storybook') {
    const b = o.storybook ?? {};
    num('storybook.targetShare', b.targetShare, 0, 1);
    num('storybook.maxScale', b.maxScale, 1, 10);
    num('storybook.pull', b.pull, 0, 0.9);
    num('storybook.overlap', b.overlap, 0, 0.9);
    num('storybook.regionShare', b.regionShare, 0, 1);
    num('storybook.shadow', b.shadow, 0, 1);
    num('storybook.background', b.background, 0, 1);
  }
  if (o.kind === 'vignette') {
    const v = o.vignette ?? {};
    num('vignette.minRadius', v.minRadius, 5, 200);
    num('vignette.maxRadius', v.maxRadius, 5, 300);
    if (v.maxRadius < v.minRadius) e.push('vignette.maxRadius must be at least vignette.minRadius');
    num('vignette.clusterKm', v.clusterKm, 1, 5000);
    num('vignette.minKm', v.minKm, 1, 5000);
    num('vignette.fill', v.fill, 0.1, 1);
    num('vignette.ghost', v.ghost, 0, 1);
    num('vignette.gap', v.gap, 0, 100);
    if (v.maxMedallions !== undefined) num('vignette.maxMedallions', v.maxMedallions, 1, 30);
    if (v.maxPerCountry !== undefined) num('vignette.maxPerCountry', v.maxPerCountry, 1, 30);
  }
  return e;
}

/** A place on the map: its coordinates and (for grouping) its name. */
export interface GeoPlace {
  lat: number;
  lon: number;
  place?: string;
}

export interface Medallion {
  center: Pt;
  r: number;
  code: string;
  name: string;
  people: number;
}

/** A laid-out map: where things go on the sheet, and the drawing underneath them. */
export interface ArtMap {
  place(p: GeoPlace): Pt | null;
  /** SVG of the map (sea, land, coasts), drawn clipped to the frame. */
  base: string;
  defs: string[];
  isLand(pt: Pt): boolean;
  /** Where to write a country's name, and whether a point is still inside it; null if not shown. */
  countryLabel(code: string): { at: Pt; inside: (pt: Pt) => boolean } | null;
  /** Where an ocean name written at lon/lat would go. */
  water(lon: number, lat: number): Pt | null;
  medallions: Medallion[];
}

// ---------- Pieces of countries, flattened to the sheet ----------

interface Piece {
  code: string;
  rings: Ring[];
  /** Size of its outer ring (mm²). */
  area: number;
  centroid: Pt;
  lon: number;
  lat: number;
}

const polygonsOf = (g: Geometry): Polygon[] =>
  g.type === 'Polygon' ? [g] : g.type === 'MultiPolygon' ? (g as MultiPolygon).coordinates.map((c) => ({ type: 'Polygon', coordinates: c }) as Polygon) : [];

function piecesFor(locator: CountryLocator, projection: GeoProjection): Piece[] {
  const pieces: Piece[] = [];
  for (const c of locator.countries) {
    for (const poly of polygonsOf(c.feature.geometry)) {
      const rings = projectRings(poly, projection);
      if (!rings.length) continue;
      const outer = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
      const centroid = ringCentroid(outer);
      // Where the piece is on the globe (to tell continents apart): its centre, unprojected, or the
      // first point of its outline if the centre falls off the projection.
      const [lon, lat] = projection.invert?.(centroid) ?? poly.coordinates[0][0];
      pieces.push({ code: c.code, rings, area: Math.abs(ringArea(outer)), centroid, lon, lat });
    }
  }
  return pieces;
}

/**
 * The land masses that move together when an ocean is narrowed: the Americas, Africa with Eurasia,
 * Oceania and Antarctica, told apart by where a piece of land lies.
 */
export function plateOf(lon: number, lat: number): 'americas' | 'afroeurasia' | 'oceania' | 'antarctica' {
  if (lat < -60) return 'antarctica';
  if (lon < -30 && lon > -170) return 'americas';
  if ((lon > 110 && lat < -10) || lon >= 165 || lon <= -170) return 'oceania';
  return 'afroeurasia';
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const len = (a: Pt) => Math.hypot(a[0], a[1]);

/** Uniform scale and shift that fits `b` into `into` (centred). */
export function fitBox(b: Box, into: Box): Transform {
  const s = Math.min(into.w / Math.max(b.w, 1e-6), into.h / Math.max(b.h, 1e-6));
  const ox = into.x + (into.w - b.w * s) / 2 - b.x * s;
  const oy = into.y + (into.h - b.h * s) / 2 - b.y * s;
  return (p) => [p[0] * s + ox, p[1] * s + oy];
}

/**
 * Pushes overlapping circles apart (heavier ones move less), optionally pulling each back
 * towards where it started and keeping it inside a box and out of keep-out boxes.
 */
export function relaxCircles(
  circles: { c: Pt; r: number; w: number; home?: Pt }[],
  opts: { gap: number; overlap?: number; within?: Box; keepOut?: Box[]; spring?: number; iterations?: number },
): Pt[] {
  const pos = circles.map((c) => [...c.c] as Pt);
  const it = opts.iterations ?? 200;
  for (let k = 0; k < it; k++) {
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const need = (circles[i].r + circles[j].r) * (1 - (opts.overlap ?? 0)) + opts.gap;
        let d = sub(pos[j], pos[i]);
        let dist = len(d);
        if (dist >= need) continue;
        if (dist < 1e-6) {
          d = [Math.cos(i + j), Math.sin(i + j)];
          dist = 1;
        }
        const push = need - dist;
        const wi = circles[j].w / (circles[i].w + circles[j].w);
        const u = mul(d, 1 / dist);
        pos[i] = sub(pos[i], mul(u, push * wi));
        pos[j] = add(pos[j], mul(u, push * (1 - wi)));
      }
    }
    for (let i = 0; i < circles.length; i++) {
      const { r, home } = circles[i];
      if (home && opts.spring) pos[i] = add(pos[i], mul(sub(home, pos[i]), opts.spring));
      for (const b of opts.keepOut ?? []) {
        // Out of the box by the shortest way.
        const q: Pt = [Math.max(b.x, Math.min(pos[i][0], b.x + b.w)), Math.max(b.y, Math.min(pos[i][1], b.y + b.h))];
        const d = sub(pos[i], q);
        const dist = len(d);
        const need = r + opts.gap;
        if (dist >= need) continue;
        if (dist < 1e-6) {
          // Centre inside the box: leave by the nearest side.
          const exits: [number, Pt][] = [
            [pos[i][0] - b.x, [b.x - need, pos[i][1]]],
            [b.x + b.w - pos[i][0], [b.x + b.w + need, pos[i][1]]],
            [pos[i][1] - b.y, [pos[i][0], b.y - need]],
            [b.y + b.h - pos[i][1], [pos[i][0], b.y + b.h + need]],
          ];
          pos[i] = exits.sort((a, c) => a[0] - c[0])[0][1];
        } else pos[i] = add(q, mul(d, need / dist));
      }
      if (opts.within) {
        const w = opts.within;
        pos[i] = [Math.max(w.x + r, Math.min(w.x + w.w - r, pos[i][0])), Math.max(w.y + r, Math.min(w.y + w.h - r, pos[i][1]))];
      }
    }
  }
  return pos;
}

interface DrawCtx {
  style: PrintStyle;
  k: number;
  lang: Lang;
  frame: Box;
}

// ---------- Storybook ----------

export function buildStorybook(
  people: GeoPlace[],
  locator: CountryLocator,
  spec: NonNullable<LayoutSpec['storybook']> & { padding: number },
  ctx: DrawCtx,
): ArtMap {
  const { style: S, k, frame } = ctx;
  const projection = makeProjection('family', people, frame, 'auto').clipExtent(null);
  const pieces = piecesFor(locator, projection);
  const byCode = new Map<string, Piece[]>();
  for (const p of pieces) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
  const proj = (p: GeoPlace): Pt | null => {
    const q = projection([p.lon, p.lat]);
    return q && Number.isFinite(q[0]) ? [q[0], q[1]] : null;
  };

  // The piece of its country each place is on (or the nearest one: towns on the coast).
  const pieceOf = (p: GeoPlace, pt: Pt): Piece | undefined => {
    const own = byCode.get(locator.locate(p)) ?? [];
    return own.find((x) => pointInRings(pt, x.rings)) ?? [...own].sort((a, b) => len(sub(a.centroid, pt)) - len(sub(b.centroid, pt)))[0];
  };
  const placed = people.map((p) => ({ p, pt: proj(p) })).filter((x): x is { p: GeoPlace; pt: Pt } => !!x.pt);
  const featured = [...new Set(placed.map(({ p, pt }) => pieceOf(p, pt)).filter((x): x is Piece => !!x))];
  const pb = ringsBounds([placed.map((x) => x.pt)]);
  const extent = Math.max(Math.hypot(pb.w, pb.h), Math.min(frame.w, frame.h) * 0.25);

  // Regions: neighbouring homelands on the same land mass (Portugal, Spain, France…) are
  // enlarged together, so they keep their places beside each other.
  const regions = clusterRegions(featured, extent * spec.regionShare);
  interface Region {
    pieces: Set<Piece>;
    featured: Piece[];
    center: Pt;
    scale: number;
    plate: string;
    size: number;
  }
  const regs: Region[] = regions.map((members) => {
    const box = ringsBounds(members.map((m) => m.rings[0]));
    const grown = inset(box, -Math.max(box.w, box.h) * 0.08);
    const plate = plateOf(members[0].lon, members[0].lat);
    // Neighbours whose middle is within the region come along, so its coasts stay whole.
    const all = new Set(members);
    for (const p of pieces) {
      const [x, y] = p.centroid;
      if (x >= grown.x && x <= grown.x + grown.w && y >= grown.y && y <= grown.y + grown.h && plateOf(p.lon, p.lat) === plate) all.add(p);
    }
    // Enlarge until a typical homeland in it is targetShare of the family's extent (tiny islands aside).
    const largest = Math.max(...members.map((m) => m.area));
    const sizes = members.filter((m) => m.area > largest * 0.05).map((m) => Math.sqrt(m.area)).sort((a, b) => a - b);
    const typical = sizes[Math.floor(sizes.length / 2)];
    const scale = Math.max(1, Math.min(spec.maxScale, (spec.targetShare * extent) / typical));
    return { pieces: all, featured: members, center: [box.x + box.w / 2, box.y + box.h / 2], scale, plate, size: Math.hypot(box.w, box.h) / 2 };
  });
  const regionOf = new Map<Piece, Region>();
  // Smaller regions win a piece both want (it's more likely to be one of their own).
  for (const r of [...regs].sort((a, b) => b.size - a.size)) for (const p of r.pieces) regionOf.set(p, r);
  for (const r of regs) for (const p of r.featured) regionOf.set(p, r);

  // Pull the land masses across the ocean towards each other.
  const anchors = new Map<string, Pt>();
  for (const pl of new Set(regs.map((r) => r.plate))) {
    const rs = regs.filter((r) => r.plate === pl);
    anchors.set(pl, mul(rs.map((r) => r.center).reduce(add, [0, 0]), 1 / rs.length));
  }
  const center = mul([...anchors.values()].reduce(add, [0, 0] as Pt), 1 / Math.max(1, anchors.size));
  const shiftFor = (pull: number) => (pl: string): Pt => (anchors.size > 1 && anchors.has(pl) ? mul(sub(center, anchors.get(pl)!), pull) : [0, 0]);

  // Small islands far from their region's coast (Madeira, the Azores) would be thrown far out to
  // sea by the enlargement; instead each is brought in until it sits just off the enlarged coast.
  const islandCentre = new Map<Piece, Pt>();
  for (const r of regs) {
    if (r.scale <= 1) continue;
    const members = [...r.pieces];
    const largest = Math.max(...members.map((m) => m.area));
    const big = members.filter((m) => m.area >= largest * 0.03);
    const grow = scaleAbout(r.center, r.scale);
    const bigRings = big.map((m) => m.rings.map((ring) => ring.map(grow)));
    const gap = extent * 0.015;
    for (const isl of members) {
      if (big.includes(isl)) continue;
      const box = ringsBounds([isl.rings[0]]);
      const half: Pt = [(box.w * r.scale) / 2 + gap, (box.h * r.scale) / 2 + gap];
      const clear = (c: Pt) =>
        ![c, add(c, half), sub(c, half), [c[0] + half[0], c[1] - half[1]] as Pt, [c[0] - half[0], c[1] + half[1]] as Pt].some((q) => bigRings.some((rings) => pointInRings(q, rings)));
      let at = r.center;
      for (let m = 1; m <= r.scale + 1e-9; m += 0.1) {
        at = add(r.center, mul(sub(isl.centroid, r.center), m));
        if (clear(at)) break;
      }
      islandCentre.set(isl, at);
    }
  }
  // Land points of each plate near the family, as enlarged, to keep the plates from colliding
  // when pulled (an enlarged Europe reaches further into the ocean than the real one).
  const near = inset(pb, -extent * 0.4);
  const platePts = new Map<string, Pt[]>();
  for (const p of pieces) {
    if (!overlaps(ringsBounds(p.rings), near)) continue;
    const r = regionOf.get(p);
    const ic = islandCentre.get(p);
    const grow: Transform = ic && r ? (q) => add(ic, mul(sub(q, p.centroid), r.scale)) : r ? scaleAbout(r.center, r.scale) : (q) => q;
    const pl = r?.plate ?? plateOf(p.lon, p.lat);
    const step = Math.max(1, Math.floor(p.rings[0].length / 40));
    const pts = platePts.get(pl) ?? [];
    for (const ring of p.rings) for (let i = 0; i < ring.length; i += step) pts.push(grow(ring[i]));
    platePts.set(pl, pts);
  }
  const minGap = extent * 0.06;
  const platesClear = (pullNow: number) => {
    if (platePts.size < 2) return true;
    const shift = shiftFor(pullNow);
    const moved = [...platePts].map(([pl, pts]) => pts.map((q) => add(q, shift(pl))));
    // A grid of cells the size of the gap: points closer than that are in the same or adjacent cells.
    const cell = (p: Pt) => [Math.floor(p[0] / minGap), Math.floor(p[1] / minGap)];
    const grids = moved.map((pts) => new Set(pts.map((p) => cell(p).join(','))));
    for (let a = 0; a < moved.length; a++)
      for (let b = 0; b < moved.length; b++) {
        if (a === b) continue;
        for (const p of moved[a]) {
          const [cx, cy] = cell(p);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grids[b].has(`${cx + dx},${cy + dy}`)) return false;
        }
      }
    return true;
  };
  let pull = anchors.size > 1 ? spec.pull : 0;
  // Narrow the ocean only as far as the coasts stay apart.
  while (pull > 0.02 && !platesClear(pull)) pull *= 0.8;
  if (pull <= 0.02) pull = 0;
  const shift = shiftFor(pull);

  // Enlarged regions are pushed apart where they'd cover each other.
  const circles = regs.map((r) => ({ c: add(r.center, shift(r.plate)), r: r.size * r.scale, w: (r.size * r.scale) ** 2 }));
  const pos = relaxCircles(circles, { gap: extent * 0.02, overlap: spec.overlap, iterations: 120 });
  const offset = new Map(regs.map((r, i) => [r, sub(pos[i], circles[i].c)] as const));
  const T = (p: Piece): Transform => {
    const r = regionOf.get(p);
    if (!r) {
      const sh = shift(plateOf(p.lon, p.lat));
      return (q) => add(q, sh);
    }
    const move = add(shift(r.plate), offset.get(r)!);
    const c = islandCentre.get(p);
    // An island keeps its own shape enlarged, around its new centre.
    if (c) return (q) => add(add(c, mul(sub(q, p.centroid), r.scale)), move);
    return scaleAbout(r.center, r.scale, move);
  };

  // Fit the enlarged regions and the places into the frame.
  const tPiece = new Map(pieces.map((p) => [p, T(p)] as const));
  const placeT = new Map<string, Pt>();
  const key = (p: GeoPlace) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const content: Pt[] = [];
  for (const { p, pt } of placed) {
    const piece = pieceOf(p, pt);
    const q = piece ? tPiece.get(piece)!(pt) : add(pt, shift(plateOf(p.lon, p.lat)));
    placeT.set(key(p), q);
    content.push(q);
  }
  for (const f of featured) for (const q of f.rings[0]) content.push(tPiece.get(f)!(q));
  const pad = Math.min(frame.w, frame.h) * spec.padding;
  const G = fitBox(ringsBounds([content]), inset(frame, pad));
  for (const [kk, q] of placeT) placeT.set(kk, G(q));

  // ---------- Drawing ----------
  const clip = inset(frame, -2 * k);
  const tRings = new Map(pieces.map((p) => [p, p.rings.map((r) => r.map((q) => G(tPiece.get(p)!(q))))] as const));
  const visible = pieces.filter((p) => overlaps(ringsBounds(tRings.get(p)!), clip));
  const pathOf = (p: Piece) => ringsPath(tRings.get(p)!, undefined, clip);
  const isFeatured = new Set(featured);
  const defs = [
    el('path', { id: 'land', d: visible.map(pathOf).join('') }),
    el(
      'filter',
      { id: 'lift', x: '-10%', y: '-10%', width: '120%', height: '120%' },
      el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 1.8 * k }) +
        el('feOffset', { dx: 1 * k, dy: 1.5 * k, result: 'b' }) +
        el('feFlood', { 'flood-color': S.paper.ageColor, 'flood-opacity': spec.shadow }) +
        el('feComposite', { in2: 'b', operator: 'in' }) +
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>',
    ),
  ];
  let base = waterLines(S, k, frame);
  // The rest of the world, faded.
  const background = visible.filter((p) => !regionOf.has(p));
  base += `<g opacity="${n(spec.background)}">${el('path', { d: background.map(pathOf).join(''), fill: S.map.land, stroke: S.map.borders.color, 'stroke-width': S.map.borders.width * k, 'stroke-linejoin': 'round' })}</g>`;
  // Each enlarged region lifted off the page: its neighbours muted, the family's countries clear.
  regs
    .sort((a, b) => b.size * b.scale - a.size * a.scale)
    .forEach((r, i) => {
      const members = visible.filter((p) => regionOf.get(p) === r);
      const all = members.map(pathOf).join('');
      const others = members.filter((p) => !isFeatured.has(p)).map(pathOf).join('');
      const own = members.filter((p) => isFeatured.has(p)).map(pathOf).join('');
      base += el('path', { d: all, fill: S.map.land, filter: spec.shadow > 0 ? 'url(#lift)' : undefined });
      base += el('path', { d: others, fill: S.map.sea, opacity: 0.35, stroke: S.map.borders.color, 'stroke-width': S.map.borders.width * k, 'stroke-dasharray': S.map.borders.dash.length ? S.map.borders.dash.map((d) => n(d * k)).join(' ') : undefined });
      if (S.map.landShade.opacity > 0 && S.map.landShade.width > 0) {
        base += `<clipPath id="region-${i}">${el('path', { d: own })}</clipPath>`;
        base += `<g clip-path="url(#region-${i})">${el('path', { d: own, fill: 'none', stroke: S.map.landShade.color, 'stroke-width': S.map.landShade.width * 2.4 * k, opacity: S.map.landShade.opacity })}</g>`;
      }
      base += el('path', { d: own, fill: 'none', stroke: S.map.borders.color, 'stroke-width': S.map.borders.width * 1.6 * k, 'stroke-linejoin': 'round' });
      base += el('path', { d: all, fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * 1.5 * k, 'stroke-linejoin': 'round' });
    });

  const land = visible.map((p) => tRings.get(p)!);
  return {
    place: (p) => placeT.get(key(p)) ?? null,
    base,
    defs,
    isLand: (pt) => land.some((r) => pointInRings(pt, r)),
    countryLabel: (code) => {
      const own = featured.filter((p) => p.code === code);
      if (!own.length) return null;
      const main = own.reduce((a, b) => (a.area > b.area ? a : b));
      const rings = tRings.get(main)!;
      return { at: G(tPiece.get(main)!(main.centroid)), inside: (pt) => pointInRings(pt, rings) };
    },
    water: (lon, lat) => {
      const q = projection([lon, lat]);
      return q ? G(add([q[0], q[1]], shift(plateOf(lon, lat)))) : null;
    },
    medallions: [],
  };
}

/**
 * Groups pieces whose centres are within `maxDist` of each other (directly or through others)
 * on the same land mass, so neighbouring countries are enlarged as one region.
 */
export function clusterRegions<P extends { centroid: Pt; lon: number; lat: number }>(pieces: P[], maxDist: number): P[][] {
  const groups: P[][] = [];
  for (const p of pieces) {
    const plate = plateOf(p.lon, p.lat);
    const joins = groups.filter((g) => plateOf(g[0].lon, g[0].lat) === plate && g.some((q) => len(sub(q.centroid, p.centroid)) <= maxDist));
    if (!joins.length) groups.push([p]);
    else {
      joins[0].push(p, ...joins.slice(1).flat());
      for (const g of joins.slice(1)) groups.splice(groups.indexOf(g), 1);
    }
  }
  return groups;
}

/** Engraved lines out to sea around the coasts (masked from #land, as on the geographic map). */
function waterLines(S: PrintStyle, k: number, frame: Box, land = '#land', id = 'art-water', scale = 1): string {
  const wl = S.map.waterLines;
  if (!(wl.count > 0 && wl.spacing > 0)) return '';
  let rings = '';
  for (let i = wl.count; i >= 1; i--) {
    const grey = Math.round(255 * (1 - ((i - 1) / wl.count) * 0.65));
    rings += el('use', { href: land, fill: 'none', stroke: `rgb(${grey},${grey},${grey})`, 'stroke-width': (2 * i * wl.spacing + wl.width) * k * scale });
    rings += el('use', { href: land, fill: 'none', stroke: '#000', 'stroke-width': Math.max(0, (2 * i * wl.spacing - wl.width) * k * scale) });
  }
  return (
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.w)}" height="${n(frame.h)}">${rings}</mask>` +
    el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: wl.color, opacity: wl.opacity, mask: `url(#${id})` })
  );
}

// ---------- Medallions ----------

interface Cluster {
  code: string;
  places: GeoPlace[];
  people: number;
  name: string;
  /** Mean position (degrees). */
  lat: number;
  lon: number;
}

/**
 * Groups the family's places into medallions: by country, then by distance, so an island group
 * far from the mainland (Madeira, the Azores) gets a medallion of its own.
 */
export function clusterPlaces(
  people: GeoPlace[],
  codeOf: (p: GeoPlace) => string,
  maxKm: number,
  lang: Lang,
  maxGroups = Infinity,
  maxPerCountry = Infinity,
): Cluster[] {
  const byPlace = new Map<string, { p: GeoPlace; n: number; code: string }>();
  for (const p of people) {
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const e = byPlace.get(key) ?? { p, n: 0, code: codeOf(p) };
    e.n++;
    byPlace.set(key, e);
  }
  const groups: { code: string; items: { p: GeoPlace; n: number }[] }[] = [];
  for (const e of [...byPlace.values()].sort((a, b) => b.n - a.n)) {
    const g = groups.find((g) => g.code === e.code && g.items.some((x) => distanceKm(x.p, e.p) <= maxKm));
    if (g) g.items.push(e);
    else groups.push({ code: e.code, items: [e] });
  }
  // Groups that ended up close after joining (A near B, C near B) are merged.
  for (let i = 0; i < groups.length; i++)
    for (let j = groups.length - 1; j > i; j--)
      if (groups[i].code === groups[j].code && groups[i].items.some((a) => groups[j].items.some((b) => distanceKm(a.p, b.p) <= maxKm))) {
        groups[i].items.push(...groups[j].items);
        groups.splice(j, 1);
      }
  // Too many medallions (in all, or for one country): merge the two closest groups in the same
  // country, again and again.
  const centre = (g: (typeof groups)[number]) => {
    const w = g.items.reduce((s, x) => s + x.n, 0);
    return { lat: g.items.reduce((s, x) => s + x.p.lat * x.n, 0) / w, lon: g.items.reduce((s, x) => s + x.p.lon * x.n, 0) / w };
  };
  const perCountry = () => {
    const c = new Map<string, number>();
    for (const g of groups) c.set(g.code, (c.get(g.code) ?? 0) + 1);
    return c;
  };
  for (;;) {
    const counts = perCountry();
    const crowded = [...counts].filter(([, n]) => n > maxPerCountry).map(([code]) => code);
    if (groups.length <= maxGroups && !crowded.length) break;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].code !== groups[j].code) continue;
        if (crowded.length && !crowded.includes(groups[i].code)) continue;
        const d = distanceKm(centre(groups[i]), centre(groups[j]));
        if (!best || d < best[2]) best = [i, j, d];
      }
    if (!best) break; // every group is in a different country
    groups[best[0]].items.push(...groups[best[1]].items);
    groups.splice(best[1], 1);
  }
  const out = groups.map((g) => {
    const people = g.items.reduce((s, x) => s + x.n, 0);
    const lat = g.items.reduce((s, x) => s + x.p.lat * x.n, 0) / people;
    const lon = g.items.reduce((s, x) => s + x.p.lon * x.n, 0) / people;
    return { code: g.code, places: g.items.map((x) => x.p), people, lat, lon, name: '' };
  });
  // Name: the country, or for a second group in the same country, its region ("Madeira").
  for (const c of out) {
    const siblings = out.filter((o) => o.code === c.code);
    const biggest = siblings.reduce((a, b) => (a.people >= b.people ? a : b));
    const parts = (c.places[0].place ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const region = parts.length >= 3 ? parts[parts.length - 2] : parts[0] ?? '';
    c.name = c === biggest || !region ? countryName(c.code, lang, region) : region;
  }
  return out.sort((a, b) => b.people - a.people);
}

export interface VignettePlan {
  clusters: Cluster[];
  /** Medallion circles at their first, geographic positions (for placing the panels around). */
  circles: { c: Pt; r: number }[];
  settle(keepOut: Box[]): ArtMap;
}

export function planVignette(
  people: GeoPlace[],
  locator: CountryLocator,
  spec: NonNullable<LayoutSpec['vignette']> & { padding: number },
  ctx: DrawCtx,
): VignettePlan {
  const { style: S, k, frame, lang } = ctx;
  const room = inset(frame, Math.min(frame.w, frame.h) * 0.12);
  const projection = makeProjection('family', people, room, 'auto').clipExtent(null);
  const proj = (p: { lat: number; lon: number }): Pt => {
    const q = projection([p.lon, p.lat]);
    return q ? [q[0], q[1]] : [frame.x + frame.w / 2, frame.y + frame.h / 2];
  };
  const clusters = clusterPlaces(people, (p) => locator.locate(p), spec.clusterKm, lang, spec.maxMedallions ?? 9, spec.maxPerCountry ?? 2);
  const maxPeople = Math.max(1, ...clusters.map((c) => c.people));
  let radii = clusters.map((c) => (spec.minRadius + (spec.maxRadius - spec.minRadius) * Math.sqrt(c.people / maxPeople)) * k);
  // Never cover more than ~38% of the map with medallions.
  const cover = radii.reduce((s, r) => s + Math.PI * r * r, 0) / (frame.w * frame.h);
  if (cover > 0.38) radii = radii.map((r) => r * Math.sqrt(0.38 / cover));
  const homes = clusters.map((c) => proj(c));
  const banner = 9 * k;

  return {
    clusters,
    circles: homes.map((c, i) => ({ c, r: radii[i] })),
    settle(keepOut) {
      const within = inset(frame, 3 * k);
      const gap = spec.gap * k;
      // Leave room below each medallion for its name banner by treating it as a little taller.
      // Settle near home first, then let them drift apart freely; if they still touch, shrink them.
      let pos = homes;
      for (let attempt = 0; attempt < 16; attempt++) {
        const circles = homes.map((h, i) => ({ c: pos[i], r: radii[i] + banner * 0.5, w: radii[i] ** 2, home: h }));
        const box = { ...within, h: within.h - banner * 0.5 };
        pos = relaxCircles(circles, { gap, within: box, keepOut, spring: 0.03, iterations: 200 });
        pos = relaxCircles(circles.map((c, i) => ({ ...c, c: pos[i] })), { gap, within: box, keepOut, iterations: 200 });
        const clash = circles.some((a, i) => circles.some((b, j) => j > i && len(sub(pos[i], pos[j])) < a.r + b.r + gap * 0.5));
        const blocked = circles.some((a, i) => keepOut.some((b) => overlaps({ x: pos[i][0] - a.r, y: pos[i][1] - a.r, w: 2 * a.r, h: 2 * a.r }, inset(b, a.r * 0.3))));
        if (!clash && !blocked) break;
        radii = radii.map((r) => r * 0.9);
      }
      const pieces = piecesFor(locator, projection);
      const bounds = pieces.map((p) => ringsBounds(p.rings));
      const medallions: Medallion[] = [];
      const placeT = new Map<string, Pt>();
      const key = (p: GeoPlace) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      let base = '';
      const discs: { center: Pt; r: number; rings: Ring[][] }[] = [];
      // A faint world behind, roughly where the medallions came from.
      if (spec.ghost > 0) {
        const ghost = pieces.map((p) => ringsPath(p.rings, undefined, inset(frame, -2 * k), 0.5 * k)).join('');
        base += `<g opacity="${n(spec.ghost)}">${el('path', { d: ghost, fill: S.map.land, stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * 0.6 * k })}</g>`;
      }
      const ghostLand = pieces.map((p) => p.rings);
      clusters.forEach((c, i) => {
        const r = radii[i];
        const center = pos[i];
        const home = proj(c);
        // Scale so the family's places fill the medallion, but always show some of the region.
        const kpm = kmPerMm(projection, home) || 1;
        const spread = Math.max(spec.minKm / kpm, ...c.places.map((p) => len(sub(proj(p), home))));
        const s = (spec.fill * r) / spread;
        const t = scaleAbout(home, s, sub(center, home));
        for (const p of c.places) placeT.set(key(p), t(proj(p)));
        const box: Box = { x: center[0] - r, y: center[1] - r, w: 2 * r, h: 2 * r };
        // The bit of the map the medallion shows, before enlarging.
        const window: Box = { x: home[0] - r / s, y: home[1] - r / s, w: (2 * r) / s, h: (2 * r) / s };
        const near = pieces.filter((_, j) => overlaps(bounds[j], window));
        const own = near.filter((p) => p.code === c.code);
        const others = near.filter((p) => p.code !== c.code);
        const id = `medal-${i}`;
        const tr = (p: Piece) => ringsPath(p.rings, t, inset(box, -1));
        base += `<g class="medallion">`;
        base += el('circle', { cx: center[0], cy: center[1], r, fill: S.paper.ageColor, opacity: 0.25, transform: `translate(${n(0.8 * k)} ${n(1.2 * k)})` });
        base += `<clipPath id="${id}">${el('circle', { cx: center[0], cy: center[1], r })}</clipPath>`;
        base += `<g clip-path="url(#${id})">`;
        base += el('circle', { cx: center[0], cy: center[1], r, fill: S.map.sea });
        // Engraved water lines round every coast in the medallion, a little wider than on the map.
        const allD = near.map(tr).join('');
        base += el('path', { id: `${id}-all`, d: allD, fill: 'none' });
        base += waterLines(S, k, box, `#${id}-all`, `${id}-water`, 1.25);
        base += el('path', { d: others.map(tr).join(''), fill: S.map.land, stroke: S.map.borders.color, 'stroke-width': S.map.borders.width * k });
        base += el('path', { d: others.map(tr).join(''), fill: S.map.sea, opacity: 0.35 });
        const ownD = own.map(tr).join('');
        base += el('path', { d: ownD, fill: S.map.land });
        if (S.map.landShade.opacity > 0 && S.map.landShade.width > 0) {
          base += `<clipPath id="${id}-land">${el('path', { d: ownD })}</clipPath>`;
          base += `<g clip-path="url(#${id}-land)">${el('path', { d: ownD, fill: 'none', stroke: S.map.landShade.color, 'stroke-width': S.map.landShade.width * 2.4 * k, opacity: S.map.landShade.opacity })}</g>`;
        }
        base += el('path', { d: allD, fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * 1.2 * k, 'stroke-linejoin': 'round' });
        base += el('path', { d: ownD, fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * 1.8 * k, 'stroke-linejoin': 'round' });
        base += '</g>';
        // Engraved double ring.
        base += el('circle', { cx: center[0], cy: center[1], r, fill: 'none', stroke: S.frame.color, 'stroke-width': 0.9 * k });
        base += el('circle', { cx: center[0], cy: center[1], r: r + 1.3 * k, fill: 'none', stroke: S.frame.color, 'stroke-width': 0.3 * k });
        base += '</g>';
        medallions.push({ center, r, code: c.code, name: c.name, people: c.people });
        discs.push({ center, r, rings: near.map((p) => p.rings.map((ring) => ring.map(t))) });
      });
      return {
        place: (p) => placeT.get(key(p)) ?? null,
        base,
        defs: [],
        isLand: (pt) => {
          const d = discs.find((x) => len(sub(pt, x.center)) <= x.r);
          return d ? d.rings.some((r) => pointInRings(pt, r)) : ghostLand.some((r) => pointInRings(pt, r));
        },
        countryLabel: () => null,
        water: (lon, lat) => proj({ lon, lat }),
        medallions,
      };
    },
  };
}

/** Banner with a medallion's name, hung under it. */
export function medallionBanner(m: Medallion, text: string, width: number, S: PrintStyle, k: number, font: { family: string; weight?: number; style?: string }, size: number): string {
  const h = size * 1.7;
  const w = width + size * 2.4;
  const x = m.center[0] - w / 2;
  const y = m.center[1] + m.r - h * 0.35;
  const notch = h * 0.35;
  const d = `M${n(x - notch)},${n(y)}H${n(x + w + notch)}L${n(x + w)},${n(y + h / 2)}L${n(x + w + notch)},${n(y + h)}H${n(x - notch)}L${n(x)},${n(y + h / 2)}Z`;
  return (
    el('path', { d, fill: S.cartouche.fill, stroke: S.cartouche.stroke, 'stroke-width': 0.4 * k, 'stroke-linejoin': 'round' }) +
    el(
      'text',
      { x: m.center[0], y: y + h * 0.68, 'text-anchor': 'middle', fill: S.cartouche.stroke, 'font-family': `'${font.family}', serif`, 'font-weight': font.weight ?? 400, 'font-style': font.style ?? 'normal', 'font-size': size },
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    )
  );
}
