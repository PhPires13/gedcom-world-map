// Decorative borders around the print, and finishing touches on the paper, both chosen apart
// from the style (borders/*.json, finishes/*.json). Colours come from the style, so any border
// suits any style. Sizes are mm on A2, scaled with the paper like everything else.

import type { PrintStyle } from './style';
import { el, n, polygonPath } from './svg';
import type { Box, Pt } from './types';

export const BORDER_KINDS = ['engraved', 'rope', 'laurel', 'deco', 'mat'] as const;

export interface BorderSpec {
  id: string;
  name: string;
  description?: string;
  kind: (typeof BORDER_KINDS)[number];
  /** Paper between the edge of the sheet and the border. */
  margin: number;
  /** Width of the decorated band. */
  band: number;
  /** Extra paper below the map for a caption (the title written under the map, as on a gallery print). */
  caption?: boolean;
}

export interface FinishSpec {
  id: string;
  name: string;
  description?: string;
  /** Leave out the style's own stains and vignette (a clean sheet). */
  clean?: boolean;
  /** Darken towards the edges (0..1). */
  vignette?: number;
  /** Browned, uneven edges, as on old paper. */
  burn?: { width: number; strength: number };
  /** Small age spots ("foxing"): how many per square decimetre. */
  foxing?: number;
  /** A torn, deckled paper edge, the sheet sitting on a mount of this colour. */
  deckle?: { inset: number; amplitude: number; mount: string; shadow: number };
}

export function validateBorder(s: unknown): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['border must be an object'];
  const o = s as Record<string, any>;
  if (typeof o.id !== 'string' || !o.id) e.push('id must be a non-empty string');
  if (typeof o.name !== 'string' || !o.name) e.push('name must be a non-empty string');
  if (!BORDER_KINDS.includes(o.kind)) e.push(`kind must be one of ${BORDER_KINDS.join(', ')}`);
  if (typeof o.margin !== 'number' || o.margin < 0 || o.margin > 80) e.push('margin must be a number between 0 and 80');
  if (typeof o.band !== 'number' || o.band < 0 || o.band > 40) e.push('band must be a number between 0 and 40');
  if (o.caption !== undefined && typeof o.caption !== 'boolean') e.push('caption must be true or false');
  return e;
}

export function validateFinish(s: unknown): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['finish must be an object'];
  const o = s as Record<string, any>;
  if (typeof o.id !== 'string' || !o.id) e.push('id must be a non-empty string');
  if (typeof o.name !== 'string' || !o.name) e.push('name must be a non-empty string');
  const num = (path: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) e.push(`${path} must be a number between ${min} and ${max}`);
  };
  if (o.vignette !== undefined) num('vignette', o.vignette, 0, 1);
  if (o.foxing !== undefined) num('foxing', o.foxing, 0, 20);
  if (o.burn !== undefined) {
    num('burn.width', o.burn?.width, 0, 80);
    num('burn.strength', o.burn?.strength, 0, 1);
  }
  if (o.deckle !== undefined) {
    num('deckle.inset', o.deckle?.inset, 0, 40);
    num('deckle.amplitude', o.deckle?.amplitude, 0, 10);
    num('deckle.shadow', o.deckle?.shadow, 0, 1);
    if (typeof o.deckle?.mount !== 'string') e.push('deckle.mount must be a colour');
  }
  return e;
}

// ---------- Drawing borders ----------

/** Positions every `step` mm along a side, centred, with the direction of that side. */
function along(a: Pt, b: Pt, step: number): { p: Pt; angle: number }[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = Math.max(1, Math.floor(L / step));
  const real = L / count;
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) * real;
    return { p: [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L] as Pt, angle };
  });
}

const rectOf = (b: Box, sw: number, stroke: string, fill = 'none') => el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill, stroke, 'stroke-width': sw });

/** The middle line of the band, as four sides (clockwise from the top). */
function midSides(outer: Box, inner: Box): [Pt, Pt][] {
  const x0 = (outer.x + inner.x) / 2;
  const y0 = (outer.y + inner.y) / 2;
  const x1 = (outer.x + outer.w + inner.x + inner.w) / 2;
  const y1 = (outer.y + outer.h + inner.y + inner.h) / 2;
  return [
    [[x0, y0], [x1, y0]],
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
  ];
}

/** A spiral curl, for corner flourishes. */
function curl(c: Pt, r: number, rot: number): string {
  let d = '';
  const turns = 1.6;
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * turns * Math.PI * 2;
    const rr = r * (1 - i / 48);
    const a = t + rot;
    d += `${i ? 'L' : 'M'}${n(c[0] + Math.cos(a) * rr)},${n(c[1] + Math.sin(a) * rr)}`;
  }
  return d;
}

/** An almond leaf of length l pointing along `angle` (degrees) from p. */
function leaf(p: Pt, l: number, angle: number): string {
  const a = (angle * Math.PI) / 180;
  const tip: Pt = [p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l];
  const nx = -Math.sin(a) * l * 0.32;
  const ny = Math.cos(a) * l * 0.32;
  const m: Pt = [(p[0] + tip[0]) / 2, (p[1] + tip[1]) / 2];
  return `M${n(p[0])},${n(p[1])}Q${n(m[0] + nx)},${n(m[1] + ny)} ${n(tip[0])},${n(tip[1])}Q${n(m[0] - nx)},${n(m[1] - ny)} ${n(p[0])},${n(p[1])}Z`;
}

/**
 * Draws a border between `outer` (its outside edge) and `inner` (the edge of the map).
 * Returns SVG drawn over the paper, under the panels.
 */
export function drawBorder(b: BorderSpec, S: PrintStyle, outer: Box, inner: Box, k: number): string {
  const ink = S.frame.color;
  const accent = S.flags.outerRing || S.ink.accent;
  const band = inner.x - outer.x;
  const corners: Pt[] = [
    [outer.x, outer.y],
    [inner.x + inner.w, outer.y],
    [inner.x + inner.w, inner.y + inner.h],
    [outer.x, inner.y + inner.h],
  ];
  let out = '';
  switch (b.kind) {
    case 'mat':
      // A clean, wide margin and a hairline round the map, like a print in a gallery mount.
      out += rectOf(inner, 0.25 * k, ink);
      break;

    case 'engraved': {
      out += rectOf(outer, 1.3 * k, ink) + rectOf(inset(outer, 0.9 * k), 0.25 * k, ink);
      out += rectOf(inner, 0.35 * k, ink) + rectOf(inset(inner, -0.9 * k), 0.2 * k, ink);
      // Corner flourishes: a pair of curls and a leaf in each corner of the band.
      let d = '';
      corners.forEach(([x, y], i) => {
        const c: Pt = [x + band / 2, y + band / 2];
        const rot = (i * Math.PI) / 2;
        d += curl([c[0] + Math.cos(rot) * band * 0.18, c[1] + Math.sin(rot) * band * 0.18], band * 0.26, rot);
        d += curl([c[0] - Math.sin(rot) * band * 0.18, c[1] + Math.cos(rot) * band * 0.18], band * 0.26, rot + Math.PI);
      });
      out += el('path', { d, fill: 'none', stroke: ink, 'stroke-width': 0.35 * k, 'stroke-linecap': 'round' });
      // A diamond and short rules in the middle of each side.
      for (const [a, c] of midSides(outer, inner)) {
        const m: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        const s = band * 0.22;
        out += el('path', { d: polygonPath([[m[0], m[1] - s], [m[0] + s, m[1]], [m[0], m[1] + s], [m[0] - s, m[1]]]), fill: accent, stroke: ink, 'stroke-width': 0.2 * k });
        const horiz = Math.abs(a[1] - c[1]) < 1e-6;
        const r = band * 3;
        out += el('path', {
          d: horiz ? `M${n(m[0] - r)},${n(m[1])}H${n(m[0] - s * 1.6)}M${n(m[0] + s * 1.6)},${n(m[1])}H${n(m[0] + r)}` : `M${n(m[0])},${n(m[1] - r)}V${n(m[1] - s * 1.6)}M${n(m[0])},${n(m[1] + s * 1.6)}V${n(m[1] + r)}`,
          stroke: ink,
          'stroke-width': 0.25 * k,
        });
      }
      break;
    }

    case 'rope': {
      out += rectOf(outer, 0.5 * k, ink) + rectOf(inner, 0.5 * k, ink);
      // Twisted strands: slanted lenses one after another along the middle of the band.
      const step = band * 0.5;
      let strands = '';
      let shade = '';
      for (const [a, c] of midSides(outer, inner)) {
        for (const { p, angle } of along(a, c, step)) {
          const t = `rotate(${n(angle + 55)} ${n(p[0])} ${n(p[1])})`;
          strands += el('ellipse', { cx: p[0], cy: p[1], rx: band * 0.42, ry: band * 0.17, transform: t });
          shade += el('ellipse', { cx: p[0], cy: p[1] + band * 0.05, rx: band * 0.3, ry: band * 0.06, transform: t });
        }
      }
      out += `<g fill="${S.compass.fill}" stroke="${ink}" stroke-width="${n(0.3 * k)}">${strands}</g>`;
      out += `<g fill="${ink}" opacity="0.35">${shade}</g>`;
      // A ring at each corner where the rope turns.
      for (const [x, y] of corners) {
        const c: Pt = [x + band / 2, y + band / 2];
        out += el('circle', { cx: c[0], cy: c[1], r: band * 0.42, fill: S.compass.fill, stroke: ink, 'stroke-width': 0.5 * k });
        out += el('circle', { cx: c[0], cy: c[1], r: band * 0.22, fill: 'none', stroke: ink, 'stroke-width': 0.6 * k });
      }
      break;
    }

    case 'laurel': {
      out += rectOf(outer, 0.8 * k, ink) + rectOf(inner, 0.4 * k, ink);
      let stem = '';
      let leaves = '';
      const step = band * 0.85;
      for (const [a, c] of midSides(outer, inner)) {
        stem += `M${n(a[0])},${n(a[1])}L${n(c[0])},${n(c[1])}`;
        along(a, c, step).forEach(({ p, angle }, i) => {
          // Leaves in pairs, angled forward, alternating slightly in length.
          const l = band * (i % 2 ? 0.46 : 0.52);
          leaves += leaf(p, l, angle - 38) + leaf(p, l, angle + 38);
        });
      }
      out += el('path', { d: stem, fill: 'none', stroke: ink, 'stroke-width': 0.3 * k });
      out += el('path', { d: leaves, fill: S.ink.faint, 'fill-opacity': 0.55, stroke: ink, 'stroke-width': 0.22 * k });
      // Rosettes at the corners.
      for (const [x, y] of corners) {
        const c: Pt = [x + band / 2, y + band / 2];
        let petals = '';
        for (let i = 0; i < 8; i++) petals += leaf(c, band * 0.42, i * 45);
        out += el('rect', { x, y, width: band, height: band, fill: S.paper.color, stroke: ink, 'stroke-width': 0.4 * k });
        out += el('path', { d: petals, fill: accent, 'fill-opacity': 0.7, stroke: ink, 'stroke-width': 0.2 * k });
        out += el('circle', { cx: c[0], cy: c[1], r: band * 0.1, fill: ink });
      }
      break;
    }

    case 'deco': {
      // Art deco: triple rules, stepped corners and a fan of rays in each corner.
      const lines = [0, 0.18, 0.3].map((t) => inset(outer, band * t));
      out += lines.map((r, i) => rectOf(r, (i ? 0.25 : 1) * k, i === 1 ? accent : ink)).join('');
      out += rectOf(inner, 0.5 * k, ink) + rectOf(inset(inner, -band * 0.12), 0.2 * k, accent);
      corners.forEach(([x, y], i) => {
        const sx = i === 1 || i === 2 ? -1 : 1;
        const sy = i >= 2 ? -1 : 1;
        const ox = sx > 0 ? x : x + band;
        const oy = sy > 0 ? y : y + band;
        const c: Pt = [ox + sx * band * 0.3, oy + sy * band * 0.3];
        // Fan: rays from the corner of the inner band.
        let rays = '';
        for (let j = 0; j <= 6; j++) {
          const a = (j / 6) * (Math.PI / 2);
          rays += `M${n(c[0])},${n(c[1])}L${n(c[0] + sx * Math.cos(a) * band * 1.6)},${n(c[1] + sy * Math.sin(a) * band * 1.6)}`;
        }
        out += el('path', { d: rays, stroke: accent, 'stroke-width': 0.3 * k });
        // Steps.
        const st = band * 0.22;
        const steps: Pt[] = [c, [c[0] + sx * 3 * st, c[1]], [c[0] + sx * 3 * st, c[1] + sy * st], [c[0] + sx * 2 * st, c[1] + sy * st], [c[0] + sx * 2 * st, c[1] + sy * 2 * st], [c[0] + sx * st, c[1] + sy * 2 * st], [c[0] + sx * st, c[1] + sy * 3 * st], [c[0], c[1] + sy * 3 * st]];
        out += el('path', { d: polygonPath(steps), fill: ink });
      });
      // Chevrons at the middle of each side.
      for (const [a, c] of midSides(outer, inner)) {
        const m: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        const angle = (Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI;
        const s = band * 0.3;
        let d = '';
        for (const off of [-1.2, 0, 1.2]) d += `M${n(m[0] + off * s - s)},${n(m[1] + s * 0.5)}L${n(m[0] + off * s)},${n(m[1] - s * 0.5)}L${n(m[0] + off * s + s)},${n(m[1] + s * 0.5)}`;
        out += el('path', { d, fill: 'none', stroke: ink, 'stroke-width': 0.35 * k, transform: `rotate(${n(angle)} ${n(m[0])} ${n(m[1])})` });
      }
      break;
    }
  }
  return `<g class="border">${out}</g>`;
}

const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });

// ---------- Finishes ----------

/** Small deterministic noise in [-1, 1] for a position along an edge. */
function edgeNoise(t: number, seed: number): number {
  return (
    Math.sin(t * 0.91 + seed) * 0.45 +
    Math.sin(t * 2.37 + seed * 1.3) * 0.3 +
    Math.sin(t * 5.71 + seed * 2.1) * 0.15 +
    Math.sin(t * 13.3 + seed * 0.7) * 0.1
  );
}

/**
 * Outline of a sheet with a deckled (torn) edge: the page inset by `inset` mm, with the edge
 * wandering in and out by up to `amplitude` mm. Always inside the sheet.
 */
export function deckleOutline(w: number, h: number, insetMm: number, amplitude: number, seed = 3): Pt[] {
  const pts: Pt[] = [];
  const step = Math.max(0.6, amplitude * 0.6);
  const side = (a: Pt, b: Pt, nrm: Pt, s: number) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(2, Math.round(L / step));
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const d = insetMm + amplitude * (0.5 + 0.5 * edgeNoise(t * L, seed + s));
      pts.push([a[0] + (b[0] - a[0]) * t + nrm[0] * d, a[1] + (b[1] - a[1]) * t + nrm[1] * d]);
    }
  };
  side([0, 0], [w, 0], [0, 1], 0);
  side([w, 0], [w, h], [-1, 0], 10);
  side([w, h], [0, h], [0, -1], 20);
  side([0, h], [0, 0], [1, 0], 30);
  return pts;
}

/** Deterministic pseudo-random numbers (mulberry32), so a print always looks the same. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Defs and overlays for a finish. `art` is everything drawn on the sheet. */
export function applyFinish(f: FinishSpec | undefined, S: PrintStyle, W: number, H: number, k: number, art: string): { defs: string; svg: string } {
  if (!f) return { defs: '', svg: art };
  let defs = '';
  let over = '';
  if (f.vignette) {
    defs +=
      `<radialGradient id="finish-vignette" cx="0.5" cy="0.5" r="0.72">` +
      `<stop offset="0.5" stop-color="${S.paper.ageColor}" stop-opacity="0"/>` +
      `<stop offset="0.88" stop-color="${S.paper.ageColor}" stop-opacity="${n(f.vignette * 0.32)}"/>` +
      `<stop offset="1" stop-color="${S.paper.ageColor}" stop-opacity="${n(f.vignette * 0.6)}"/></radialGradient>`;
    over += el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#finish-vignette)' });
  }
  if (f.foxing) {
    const rnd = random(17);
    const count = Math.round((f.foxing * W * H) / 10000);
    let spots = '';
    for (let i = 0; i < count; i++) {
      // More spots towards the edges, where paper ages first.
      let x = rnd() * W;
      let y = rnd() * H;
      if (rnd() < 0.6) (rnd() < 0.5 ? (x = rnd() < 0.5 ? rnd() * W * 0.12 : W - rnd() * W * 0.12) : (y = rnd() < 0.5 ? rnd() * H * 0.12 : H - rnd() * H * 0.12));
      spots += el('circle', { cx: x, cy: y, r: (0.25 + rnd() * 1.1) * k, opacity: n(0.06 + rnd() * 0.16) });
    }
    defs += `<filter id="foxing-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(0.35 * k)}"/></filter>`;
    over += `<g fill="${S.paper.ageColor}" filter="url(#foxing-blur)">${spots}</g>`;
  }
  if (f.burn && f.burn.width > 0) {
    const bw = f.burn.width * k;
    const full = `filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${n(W)}" height="${n(H)}"`;
    defs +=
      `<filter id="burn-edge" ${full}><feTurbulence type="fractalNoise" baseFrequency="${n(0.04 / k)}" numOctaves="3" seed="9" result="t"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="t" scale="${n(bw * 0.9)}" xChannelSelector="R" yChannelSelector="G"/>` +
      `<feGaussianBlur stdDeviation="${n(bw * 0.3)}"/></filter>` +
      `<mask id="burn-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(W)}" height="${n(H)}">` +
      el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }) +
      el('rect', { x: bw, y: bw, width: W - 2 * bw, height: H - 2 * bw, fill: '#000', filter: 'url(#burn-edge)' }) +
      `</mask>`;
    over += el('rect', { x: 0, y: 0, width: W, height: H, fill: S.paper.ageColor, opacity: f.burn.strength, mask: 'url(#burn-mask)' });
  }
  let svg = art + over;
  if (f.deckle) {
    const d = f.deckle;
    const outline = deckleOutline(W, H, d.inset * k, d.amplitude * k);
    defs += `<clipPath id="deckle">${el('path', { d: polygonPath(outline) })}</clipPath>`;
    defs += `<filter id="deckle-shadow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${n(1.4 * k)}"/></filter>`;
    svg =
      el('rect', { x: 0, y: 0, width: W, height: H, fill: d.mount }) +
      el('path', { d: polygonPath(outline), fill: '#000', opacity: d.shadow, filter: 'url(#deckle-shadow)', transform: `translate(${n(0.6 * k)} ${n(1 * k)})` }) +
      `<g clip-path="url(#deckle)">${svg}</g>`;
  }
  return { defs, svg };
}
