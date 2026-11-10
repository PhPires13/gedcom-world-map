// Layout of the text panels (cartouche, legend) and placement of things that mustn't overlap:
// panels in the emptiest corners, flag roundels beside their country, labels next to their marks.
// All sizes in mm.

import type { Box, FontRef, MeasureText, Pt } from './types';

/** Width estimate from the font's average character width; used when the real font can't be measured. */
export const estimateText: MeasureText = (text, font, size, spacing = 0) =>
  text.length * size * (font.widthFactor ?? 0.5) + Math.max(0, text.length - 1) * spacing;

export const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Splits text into lines no wider than `maxW`. A single word wider than that gets a line of its own. */
export function wrapText(text: string, maxW: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface TextLine {
  text: string;
  font: FontRef;
  size: number;
  /** Baseline, from the top of the panel. */
  y: number;
  width: number;
  /** Extra space between letters, in mm. */
  spacing?: number;
  role?: 'title' | 'subtitle' | 'dedication';
}

export interface PanelLayout {
  w: number;
  h: number;
  lines: TextLine[];
  /** Space reserved for ornaments around the text (scrolls), included in w/h. */
  padX: number;
  padY: number;
}

/**
 * The cartouche: title (shrunk, then wrapped, until it fits), the span of years and the dedication
 * (wrapped, at most four lines). Every line fits inside `maxW` minus the padding.
 */
export function layoutCartouche(
  input: { title: string; subtitle: string; dedication: string },
  fonts: { title: FontRef; subtitle: FontRef; dedication: FontRef },
  sizes: { title: number; subtitle: number; dedication: number },
  maxW: number,
  measure: MeasureText,
  ornamentPad: number,
): PanelLayout {
  const padX = ornamentPad + sizes.subtitle * 1.6;
  const padY = ornamentPad + sizes.subtitle * 1.2;
  const inner = maxW - 2 * padX;
  const lines: TextLine[] = [];
  let y = padY;

  // Title: as large as possible, down to 60% of the style's size; then wrapped.
  let tSize = sizes.title;
  const title = input.title.trim();
  const tw = (s: string, size: number) => measure(s, fonts.title, size);
  if (title) {
    while (tSize > sizes.title * 0.6 && tw(title, tSize) > inner) tSize *= 0.95;
    let tLines = tw(title, tSize) > inner ? wrapText(title, inner, (s) => tw(s, tSize)) : [title];
    // A single word too long even when wrapped: shrink it to fit.
    const widest = Math.max(...tLines.map((l) => tw(l, tSize)));
    if (widest > inner) tSize *= inner / widest;
    tLines = tLines.slice(0, 3);
    for (const t of tLines) {
      y += tSize * 0.9;
      lines.push({ text: t, font: fonts.title, size: tSize, y, width: tw(t, tSize), role: 'title' });
      y += tSize * 0.25;
    }
    // Room for the rule under the title.
    if (input.subtitle.trim() || input.dedication.trim()) y += tSize * 0.3;
  }
  if (input.subtitle.trim()) {
    const s = input.subtitle.trim();
    let size = sizes.subtitle;
    const w = measure(s, fonts.subtitle, size);
    if (w > inner) size *= inner / w;
    y += size * 1.1;
    lines.push({ text: s, font: fonts.subtitle, size, y, width: measure(s, fonts.subtitle, size), role: 'subtitle' });
    y += size * 0.35;
  }
  if (input.dedication.trim()) {
    const size = sizes.dedication;
    const dw = (s: string) => measure(s, fonts.dedication, size);
    // Short lines read better than one long one: about 70 characters at most.
    const dedW = Math.min(inner, size * 30);
    let dl = wrapText(input.dedication.trim(), dedW, dw);
    if (dl.length > 4) {
      dl = dl.slice(0, 4);
      let last = dl[3];
      while (last.length > 1 && dw(`${last}…`) > dedW) last = last.slice(0, -1).trimEnd();
      dl[3] = `${last}…`;
    }
    y += size * 0.9; // gap before the dedication (room for a rule)
    for (const t of dl) {
      // A word longer than the whole line: shrink that line.
      const w = dw(t);
      const s = w > inner ? (size * inner) / w : size;
      y += size * 1.3;
      lines.push({ text: t, font: fonts.dedication, size: s, y, width: measure(t, fonts.dedication, s), role: 'dedication' });
    }
  }
  const textW = Math.max(0, ...lines.map((l) => l.width));
  const w = Math.min(maxW, Math.max(textW + 2 * padX, maxW * 0.55));
  return { w, h: y + padY, lines, padX, padY };
}

export interface LegendRow {
  label: string;
  /** What to draw in the swatch. */
  kind: 'route' | 'mark' | 'flag';
  color?: string;
}

export interface LegendLayout {
  w: number;
  h: number;
  title: TextLine;
  rows: { row: LegendRow; y: number; textX: number; size: number }[];
  swatchW: number;
  pad: number;
}

export function layoutLegend(
  title: string,
  rows: LegendRow[],
  fonts: { title: FontRef; row: FontRef },
  sizes: { title: number; row: number },
  maxW: number,
  measure: MeasureText,
): LegendLayout {
  const pad = sizes.row * 1.6;
  const swatchW = sizes.row * 4;
  const gap = sizes.row * 0.9;
  const rowH = sizes.row * 1.75;
  let titleSize = sizes.title;
  const tW = measure(title, fonts.title, titleSize);
  if (tW > maxW - 2 * pad) titleSize *= (maxW - 2 * pad) / tW;
  let y = pad + titleSize * 0.85;
  const titleLine: TextLine = { text: title, font: fonts.title, size: titleSize, y, width: measure(title, fonts.title, titleSize) };
  y += titleSize * 0.6;
  const textX = pad + swatchW + gap;
  const out: LegendLayout['rows'] = [];
  let widest = titleLine.width;
  for (const row of rows) {
    let size = sizes.row;
    const w = measure(row.label, fonts.row, size);
    if (textX + w + pad > maxW) size *= (maxW - textX - pad) / w;
    y += rowH;
    out.push({ row, y, textX, size });
    widest = Math.max(widest, textX - pad + measure(row.label, fonts.row, size));
  }
  return { w: Math.min(maxW, widest + 2 * pad), h: y + pad * 0.9, title: titleLine, rows: out, swatchW, pad };
}

// ---------- Placement ----------

/** Things already on the map that a panel should avoid: marks, route points, and so on. */
export interface Obstacles {
  points: Pt[];
  boxes: Box[];
}

/** How much of the map's content a box would cover (points inside, boxes overlapped). */
export function coverage(b: Box, obs: Obstacles, pad = 0): number {
  let n = 0;
  for (const [x, y] of obs.points) if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) n++;
  for (const o of obs.boxes) if (overlaps(b, o, pad)) n += 50;
  return n;
}

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom';

export function anchoredBox(frame: Box, w: number, h: number, anchor: Anchor, margin: number): Box {
  const left = frame.x + margin;
  const right = frame.x + frame.w - margin - w;
  const top = frame.y + margin;
  const bottom = frame.y + frame.h - margin - h;
  const mid = frame.x + (frame.w - w) / 2;
  const pos: Record<Anchor, [number, number]> = {
    'top-left': [left, top],
    'top-right': [right, top],
    'bottom-left': [left, bottom],
    'bottom-right': [right, bottom],
    top: [mid, top],
    bottom: [mid, bottom],
  };
  const [x, y] = pos[anchor];
  return { x, y, w, h };
}

/**
 * Puts a panel in whichever corner (or top/bottom middle) covers the least of the map, never on
 * top of panels already placed. Ties go to the order of `anchors`.
 */
export function placePanel(
  frame: Box,
  w: number,
  h: number,
  obs: Obstacles,
  placed: Box[],
  margin: number,
  anchors: Anchor[] = ['bottom-left', 'top-left', 'bottom-right', 'top-right', 'bottom', 'top'],
): { box: Box; anchor: Anchor } {
  let best: { box: Box; anchor: Anchor; score: number } | null = null;
  for (const [i, anchor] of anchors.entries()) {
    const box = anchoredBox(frame, w, h, anchor, margin);
    if (placed.some((p) => overlaps(p, box, margin * 0.5))) continue;
    const score = coverage(box, obs, margin) + i * 0.01;
    if (!best || score < best.score) best = { box, anchor, score };
  }
  return best ?? { box: anchoredBox(frame, w, h, anchors[0], margin), anchor: anchors[0] };
}

/** Distance from a point to a polyline. */
export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) : best;
}

/** Whether the segment a→b passes through the box (sampled; good enough at map scale). */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) return true;
  }
  return false;
}

/**
 * Where to put a flag roundel for a country: near the family's places there, but not on top of
 * them, the routes, other roundels or the panels. Tries rings of positions around the anchor and
 * takes the least crowded, preferring closer ones. `extraBelow` is room for a label under it.
 * Null if no position fits inside the frame.
 */
export function placeRoundel(
  anchor: Pt,
  r: number,
  extraBelow: number,
  frame: Box,
  marks: Pt[],
  routes: Pt[][],
  taken: Box[],
): { center: Pt; box: Box } | null {
  let best: { center: Pt; box: Box; score: number } | null = null;
  const boxAt = (c: Pt): Box => ({ x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r + extraBelow });
  for (const dist of [2.6, 3.6, 5, 7, 9.5]) {
    for (let k = 0; k < 16; k++) {
      // Start straight up and go round; upper positions read best with a label underneath.
      const a = -Math.PI / 2 + (k * Math.PI) / 8;
      const c: Pt = [anchor[0] + Math.cos(a) * dist * r, anchor[1] + Math.sin(a) * dist * r];
      const box = boxAt(c);
      if (!contains(frame, box)) continue;
      let score = dist * 2;
      for (const t of taken) {
        if (overlaps(box, t, r * 0.2)) score += 1000;
        // The dotted leader to the anchor shouldn't cross another roundel or a panel.
        else if (segmentHitsBox(anchor, c, t)) score += 150;
      }
      for (const m of marks) if (Math.hypot(m[0] - c[0], m[1] - c[1]) < r * 1.4) score += 60;
      for (const route of routes) {
        const d = distToPolyline(c, route);
        if (d < r * 1.15) score += 40;
        else if (d < r * 1.6) score += 8;
      }
      if (!best || score < best.score) best = { center: c, box, score };
    }
  }
  return best ? { center: best.center, box: best.box } : null;
}

/**
 * Places a label beside a mark: right, left, above or below, the first that doesn't collide.
 * Returns null if all of them do (the label is left out rather than drawn over something).
 */
export function placeLabel(
  at: Pt,
  w: number,
  h: number,
  gap: number,
  frame: Box,
  taken: Box[],
): { box: Box; anchor: 'start' | 'end' | 'middle'; baseline: Pt } | null {
  const candidates: { box: Box; anchor: 'start' | 'end' | 'middle'; baseline: Pt }[] = [
    { box: { x: at[0] + gap, y: at[1] - h / 2, w, h }, anchor: 'start', baseline: [at[0] + gap, at[1] + h * 0.32] },
    { box: { x: at[0] - gap - w, y: at[1] - h / 2, w, h }, anchor: 'end', baseline: [at[0] - gap, at[1] + h * 0.32] },
    { box: { x: at[0] - w / 2, y: at[1] - gap - h, w, h }, anchor: 'middle', baseline: [at[0], at[1] - gap - h * 0.18] },
    { box: { x: at[0] - w / 2, y: at[1] + gap, w, h }, anchor: 'middle', baseline: [at[0], at[1] + gap + h * 0.82] },
  ];
  for (const c of candidates) if (contains(frame, c.box) && !taken.some((t) => overlaps(t, c.box))) return c;
  return null;
}
