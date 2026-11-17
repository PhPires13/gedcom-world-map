// "Family countries" layout: only the countries the family was born in, each drawn large in its own
// true shape, brought close together while keeping where each lies in relation to the others
// (Ireland stays north of Portugal, Brazil south-west, Angola south-east).
//
// 1. Each country is projected on its own (azimuthal equal-area around its middle), so its shape is
//    right however far it is from the others; far-flung territories are dropped, and far islands
//    with family on them (Madeira, the Azores) are brought in just off the coast and enlarged.
// 2. Sizes are compressed: Portugal next to Brazil is drawn about a third of Brazil's width instead
//    of a tenth (`sizeExponent`), so every homeland reads clearly.
// 3. The countries start far apart along their real directions and are drawn in towards the middle
//    until they nearly touch (each stops when it would overlap another), more along the paper's
//    short side so the group fills a landscape or portrait sheet.
// 4. Everything is fitted to the frame; places and routes move with their country.

import { geoAzimuthalEqualArea, geoCentroid } from 'd3-geo';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import type { CountryLocator } from './countries';
import { inset, makeProjection } from './geo';
import { fitBox, waterLines, type ArtMap, type GeoPlace, type LayoutSpec } from './layouts';
import { pointInRings, projectRings, ringArea, ringCentroid, ringsBounds, ringsPath, type Ring } from './planar';
import type { PrintStyle } from './style';
import { el } from './svg';
import type { Box, Lang, Pt } from './types';

export type HomelandsSpec = NonNullable<LayoutSpec['homelands']>;

interface DrawCtx {
  style: PrintStyle;
  k: number;
  lang: Lang;
  frame: Box;
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const len = (a: Pt) => Math.hypot(a[0], a[1]);

const polygonsOf = (g: Geometry): Polygon[] =>
  g.type === 'Polygon' ? [g] : g.type === 'MultiPolygon' ? (g as MultiPolygon).coordinates.map((c) => ({ type: 'Polygon', coordinates: c }) as Polygon) : [];

/** A part of a country in its own projection (unit: the projection's, about km/1000). */
interface Part {
  rings: Ring[];
  area: number;
  centroid: Pt;
  /** Far island brought in: where its centre goes and how much more it is enlarged. */
  moved?: { to: Pt; grow: number };
}

interface Home {
  code: string;
  /** The country's own projection to local coordinates. */
  local: (lon: number, lat: number) => Pt | null;
  parts: Part[];
  /** Where its middle is on a world map of the family (mm), for directions. */
  world: Pt;
  /** Size (square root of its land area, in local units). */
  size: number;
  /** Local → arranged-sheet scale. */
  scale: number;
  /** Arranged position of its local origin. */
  pos: Pt;
  /** A few points of its outline (local), and its outline simplified, for overlap tests. */
  sample: Pt[];
  hull: Ring[];
}

/** Where a local point of a part goes in the country's own (unarranged) frame. */
function partPoint(part: Part, q: Pt): Pt {
  return part.moved ? add(part.moved.to, mul(sub(q, part.centroid), part.moved.grow)) : q;
}

const simplify = (ring: Ring, max: number): Ring => {
  if (ring.length <= max) return ring;
  const step = ring.length / max;
  const out: Ring = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[Math.floor(i)]);
  return out;
};

/** The parts of a country worth drawing, in its own projection. */
function homelandParts(feature: Feature<Geometry>, places: Pt[], spec: HomelandsSpec, projection: ReturnType<typeof geoAzimuthalEqualArea>): Part[] {
  const parts: Part[] = [];
  for (const poly of polygonsOf(feature.geometry)) {
    const rings = projectRings(poly, projection);
    if (!rings.length) continue;
    const outer = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
    parts.push({ rings, area: Math.abs(ringArea(outer)), centroid: ringCentroid(outer) });
  }
  if (!parts.length) return [];
  const main = parts.reduce((a, b) => (a.area > b.area ? a : b));
  const mainBox = ringsBounds(main.rings);
  const reach = Math.hypot(mainBox.w, mainBox.h) * 0.75;
  const hasFamily = (p: Part) => places.some((q) => pointInRings(q, p.rings));
  const kept: Part[] = [];
  for (const p of parts) {
    const near = len(sub(p.centroid, main.centroid)) <= reach;
    // Overseas territories with no family on them (French Guiana, Alaska…) are left out, and so
    // are specks too small to see.
    if (p === main || (near && p.area >= main.area * 0.002) || hasFamily(p)) kept.push(p);
  }
  // Far islands with family: brought in along their real direction until just clear of the coast,
  // and enlarged enough to be seen and to hold their towns.
  const mainSize = Math.sqrt(main.area);
  for (const p of kept) {
    if (p === main || len(sub(p.centroid, main.centroid)) <= reach) continue;
    const grow = Math.max(1, (spec.islandMin * mainSize) / Math.max(1e-9, Math.sqrt(p.area)));
    const box = ringsBounds(p.rings);
    const half = (Math.max(box.w, box.h) * grow) / 2;
    const dir = mul(sub(p.centroid, main.centroid), 1 / len(sub(p.centroid, main.centroid)));
    const gap = mainSize * 0.04;
    const clear = (c: Pt) => {
      for (let a = 0; a < 8; a++) {
        const q = add(c, [Math.cos((a * Math.PI) / 4) * (half + gap), Math.sin((a * Math.PI) / 4) * (half + gap)]);
        if (pointInRings(q, main.rings)) return false;
      }
      return !pointInRings(c, main.rings);
    };
    let at = main.centroid;
    for (let d = 0; d <= len(sub(p.centroid, main.centroid)); d += mainSize * 0.02) {
      at = add(main.centroid, mul(dir, d));
      if (clear(at)) break;
    }
    p.moved = { to: at, grow };
  }
  return kept;
}

/** Whether two arranged countries overlap (with a margin), on their simplified outlines. */
function collide(a: Home, b: Home, margin: number): boolean {
  const ta = (q: Pt): Pt => add(a.pos, mul(q, a.scale));
  const tb = (q: Pt): Pt => add(b.pos, mul(q, b.scale));
  const ba = ringsBounds(a.hull.map((r) => r.map(ta)));
  const bb = ringsBounds(b.hull.map((r) => r.map(tb)));
  if (ba.x - margin > bb.x + bb.w || bb.x - margin > ba.x + ba.w || ba.y - margin > bb.y + bb.h || bb.y - margin > ba.y + ba.h) return false;
  // Outlines pushed out by the margin (from each country's middle) mustn't reach into the other.
  const grown = (h: Home, t: (q: Pt) => Pt, q: Pt): Pt => {
    const p = t(q);
    const c = h.pos;
    const d = len(sub(p, c));
    return d < 1e-9 ? p : add(c, mul(sub(p, c), (d + margin) / d));
  };
  const ringsA = a.hull.map((r) => r.map(ta));
  const ringsB = b.hull.map((r) => r.map(tb));
  for (const q of a.sample) if (pointInRings(grown(a, ta, q), ringsB)) return true;
  for (const q of b.sample) if (pointInRings(grown(b, tb, q), ringsA)) return true;
  return false;
}

export function buildHomelands(people: GeoPlace[], locator: CountryLocator, spec: HomelandsSpec & { padding: number }, ctx: DrawCtx): ArtMap {
  const { style: S, k, frame } = ctx;
  const world = makeProjection('family', people, frame, 'auto').clipExtent(null);

  // ---------- The family's countries, each in its own projection ----------
  const codeOf = new Map<GeoPlace, string>();
  for (const p of people) codeOf.set(p, locator.locate(p));
  const codes = [...new Set([...codeOf.values()].filter(Boolean))];
  const homes: Home[] = [];
  for (const code of codes) {
    const country = locator.countries.find((c) => c.code === code);
    if (!country?.feature.geometry) continue;
    const [lon0, lat0] = geoCentroid(country.feature);
    const projection = geoAzimuthalEqualArea().rotate([-lon0, -lat0]).scale(1000).translate([0, 0]);
    const local = (lon: number, lat: number): Pt | null => {
      const q = projection([lon, lat]);
      return q && Number.isFinite(q[0]) ? [q[0], q[1]] : null;
    };
    const places = people.filter((p) => codeOf.get(p) === code).map((p) => local(p.lon, p.lat)).filter((q): q is Pt => !!q);
    const parts = homelandParts(country.feature, places, spec, projection);
    if (!parts.length) continue;
    const wpt = world([lon0, lat0]);
    if (!wpt || !Number.isFinite(wpt[0])) continue;
    const size = Math.sqrt(parts.filter((p) => !p.moved).reduce((s, p) => s + p.area, 0));
    const outline = parts.flatMap((p) => p.rings.map((r) => r.map((q) => partPoint(p, q))));
    const main = outline.reduce((a, b) => (a.length > b.length ? a : b));
    const hull = outline.filter((r) => r === main || Math.abs(ringArea(r)) > size * size * 0.01).map((r) => simplify(r, 160));
    const sample = hull.flatMap((r) => simplify(r, Math.max(12, Math.round((60 * r.length) / main.length))));
    homes.push({ code, local, parts, world: [wpt[0], wpt[1]], size, scale: 1, pos: [0, 0], sample, hull });
  }
  if (!homes.length) return emptyMap();

  // ---------- Sizes: the largest country is 1 unit across; the others shrink less than in reality ----------
  const largest = Math.max(...homes.map((h) => h.size));
  for (const h of homes) h.scale = (h.size / largest) ** spec.sizeExponent / h.size;

  // ---------- Arrangement ----------
  const centre = mul(homes.map((h) => h.world).reduce(add, [0, 0] as Pt), 1 / homes.length);
  const spread = Math.max(1e-6, ...homes.map((h) => len(sub(h.world, centre))));
  // Start well apart, in the same order as on the world map (north stays north, west stays west),
  // but stretched to the paper's shape: a family that moved north to south still fills a
  // landscape sheet. Then everyone is drawn in.
  const aspect = frame.w / frame.h;
  const wb = ringsBounds([homes.map((h) => h.world)]);
  const sx = Math.max(1 / 3, Math.min(3, (aspect * Math.max(wb.h, 1e-6)) / Math.max(wb.w, 1e-6)));
  for (const h of homes) h.pos = mul([(h.world[0] - centre[0]) * sx, h.world[1] - centre[1]], (homes.length * 1.5) / (spread * Math.max(1, sx)));
  const margin = spec.gap;
  const extentOf = () => ringsBounds(homes.flatMap((h) => h.hull.map((r) => r.map((q) => add(h.pos, mul(q, h.scale))))));
  const blocked = (h: Home) => homes.some((o) => o !== h && collide(h, o, margin));
  // Neighbours (Portugal and Spain) can start on top of each other: push each overlapping pair
  // apart along the line between them (their real direction) until every country is clear.
  for (let round = 0; round < 400; round++) {
    let clear = true;
    for (let i = 0; i < homes.length; i++)
      for (let j = i + 1; j < homes.length; j++) {
        const a = homes[i];
        const b = homes[j];
        if (!collide(a, b, margin)) continue;
        clear = false;
        let d = sub(b.pos, a.pos);
        if (len(d) < 1e-6) d = sub(b.world, a.world);
        if (len(d) < 1e-6) d = [1, 0];
        const u = mul(d, 0.04 / len(d));
        // The smaller country moves more.
        const wa = b.size / (a.size + b.size);
        a.pos = sub(a.pos, mul(u, wa));
        b.pos = add(b.pos, mul(u, 1 - wa));
      }
    if (clear) break;
  }
  // One axis at a time: the one that is too long for the paper's shape, else the other.
  const contract = (axis: 0 | 1, f: number) => {
    let moved = false;
    for (const h of [...homes].sort((a, b2) => len(a.pos) - len(b2.pos))) {
      const before = h.pos;
      const next: Pt = axis === 0 ? [h.pos[0] * (1 - f), h.pos[1]] : [h.pos[0], h.pos[1] * (1 - f)];
      if (Math.abs(next[axis] - before[axis]) < 1e-4) continue;
      h.pos = next;
      if (blocked(h)) h.pos = before;
      else moved = true;
    }
    return moved;
  };
  for (let step = 0; step < 300; step++) {
    const b = extentOf();
    const first: 0 | 1 = b.w / Math.max(1e-6, b.h) > aspect ? 0 : 1;
    if (contract(first, 0.05)) continue;
    if (!contract(first === 0 ? 1 : 0, 0.05)) break;
  }

  // ---------- Onto the sheet ----------
  const arranged = (h: Home, part: Part, q: Pt): Pt => add(h.pos, mul(partPoint(part, q), h.scale));
  const content: Pt[] = [];
  for (const h of homes) for (const part of h.parts) for (const r of part.rings) for (const q of r) content.push(arranged(h, part, q));
  const pad = Math.min(frame.w, frame.h) * spec.padding;
  const G = fitBox(ringsBounds([content]), inset(frame, pad));
  const sheetRings = new Map(homes.map((h) => [h, h.parts.flatMap((part) => part.rings.map((r) => r.map((q) => G(arranged(h, part, q)))))] as const));

  // Places move with their country (and with their island, if it was brought in).
  const key = (p: GeoPlace) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const placeAt = new Map<string, Pt>();
  for (const p of people) {
    const h = homes.find((x) => x.code === codeOf.get(p));
    if (!h) continue;
    const q = h.local(p.lon, p.lat);
    if (!q) continue;
    const part = h.parts.find((x) => pointInRings(q, x.rings)) ?? h.parts.reduce((a, b) => (len(sub(a.centroid, q)) < len(sub(b.centroid, q)) ? a : b));
    placeAt.set(key(p), G(arranged(h, part, q)));
  }

  // Ocean names: the world map's positions, shrunk about the family's middle the way the
  // arrangement shrank the gaps between countries.
  const fitted = homes.map((h) => ({ from: h.world, to: G(h.pos) }));
  const c0 = mul(fitted.map((f) => f.from).reduce(add, [0, 0] as Pt), 1 / fitted.length);
  const c1 = mul(fitted.map((f) => f.to).reduce(add, [0, 0] as Pt), 1 / fitted.length);
  const d0 = fitted.reduce((m, f) => m + len(sub(f.from, c0)), 0);
  const d1 = fitted.reduce((m, f) => m + len(sub(f.to, c1)), 0);
  const ratio = d0 > 1e-6 ? d1 / d0 : 1;
  const oceanAt = (pt: Pt): Pt | null => (fitted.length < 2 ? null : add(c1, mul(sub(pt, c0), ratio)));

  // ---------- Drawing ----------
  const clip = inset(frame, -2 * k);
  const all = [...sheetRings.values()].flat();
  const defs = [
    el('path', { id: 'land', d: ringsPath(all, undefined, clip) }),
    el(
      'filter',
      { id: 'lift', x: '-10%', y: '-10%', width: '120%', height: '120%' },
      el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 2.2 * k }) +
        el('feOffset', { dx: 1.2 * k, dy: 1.8 * k, result: 'b' }) +
        el('feFlood', { 'flood-color': S.paper.ageColor, 'flood-opacity': spec.shadow }) +
        el('feComposite', { in2: 'b', operator: 'in' }) +
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>',
    ),
  ];
  let base = waterLines(S, k, frame, '#land', 'homelands-water', 1.3);
  homes.forEach((h, i) => {
    const d = ringsPath(sheetRings.get(h)!, undefined, clip);
    base += el('path', { d, fill: S.map.land, filter: spec.shadow > 0 ? 'url(#lift)' : undefined });
    if (S.map.landShade.opacity > 0 && S.map.landShade.width > 0) {
      base += `<clipPath id="homeland-${i}">${el('path', { d })}</clipPath>`;
      base += `<g clip-path="url(#homeland-${i})">${el('path', { d, fill: 'none', stroke: S.map.landShade.color, 'stroke-width': S.map.landShade.width * 3 * k, opacity: S.map.landShade.opacity })}</g>`;
    }
    base += el('path', { d, fill: 'none', stroke: S.map.coast.color, 'stroke-width': S.map.coast.width * 1.8 * k, 'stroke-linejoin': 'round' });
  });

  // Panels keep clear of the countries: their outlines count as obstacles.
  const obstacles = homes.flatMap((h) => h.hull.flatMap((r) => simplify(r, 60).map((q) => G(add(h.pos, mul(q, h.scale))))));

  return {
    place: (p) => placeAt.get(key(p)) ?? null,
    base,
    defs,
    isLand: (pt) => all.length > 0 && [...sheetRings.values()].some((r) => pointInRings(pt, r)),
    countryLabel: (code) => {
      const h = homes.find((x) => x.code === code);
      if (!h) return null;
      const rings = sheetRings.get(h)!;
      const main = h.parts.reduce((a, b) => (a.area > b.area ? a : b));
      return { at: G(arranged(h, main, main.centroid)), inside: (pt) => pointInRings(pt, rings) };
    },
    water: (lon, lat) => {
      const q = world([lon, lat]);
      return q && Number.isFinite(q[0]) ? oceanAt([q[0], q[1]]) : null;
    },
    medallions: [],
    obstacles,
    flagSpot: (code, r) => {
      const h = homes.find((x) => x.code === code);
      if (!h) return null;
      const rings = sheetRings.get(h)!;
      const label = (() => {
        const main = h.parts.reduce((a, b) => (a.area > b.area ? a : b));
        return G(arranged(h, main, main.centroid));
      })();
      const marks = [...placeAt.values()];
      const edge = rings.flatMap((ring) => simplify(ring, 200));
      const box = ringsBounds(rings);
      // The roomiest spot inside the country: far from its coast, its towns and its name.
      let best: Pt | null = null;
      let bestScore = r * 1.1;
      const steps = 24;
      for (let i = 1; i < steps; i++)
        for (let j = 1; j < steps; j++) {
          const q: Pt = [box.x + (box.w * i) / steps, box.y + (box.h * j) / steps];
          if (!pointInRings(q, rings)) continue;
          const toEdge = Math.min(...edge.map((e) => len(sub(e, q))));
          const toMark = Math.min(Infinity, ...marks.map((m) => len(sub(m, q)) - r * 0.4));
          const toLabel = Math.abs(q[1] - label[1]) < r * 1.6 && Math.abs(q[0] - label[0]) < r * 4 ? 0 : Infinity;
          const score = Math.min(toEdge, toMark, toLabel);
          if (score > bestScore) {
            bestScore = score;
            best = q;
          }
        }
      return best;
    },
  };
}

function emptyMap(): ArtMap {
  return { place: () => null, base: '', defs: [el('path', { id: 'land', d: '' })], isLand: () => false, countryLabel: () => null, water: () => null, medallions: [] };
}
