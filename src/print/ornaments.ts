// Drawn ornaments: compass rose, scale bar, the map's frame and the panel borders. Each returns SVG.

import { degreeLabel, type FrameTick } from './geo';
import { sized, type PrintStyle } from './style';
import { el, fontAttrs, n, polygonPath } from './svg';
import type { Box, Lang, Pt } from './types';

const DIRS: Record<Lang, [string, string, string, string]> = { pt: ['N', 'L', 'S', 'O'], en: ['N', 'E', 'S', 'W'], es: ['N', 'E', 'S', 'O'] };

/** One point of a compass star: two halves, one dark and one light, like an engraved rose. */
function starPoint(cx: number, cy: number, angle: number, len: number, half: number, dark: string, light: string, line: string, lw: number) {
  const a = angle - Math.PI / 2; // 0 = north
  const tip: Pt = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
  const l: Pt = [cx + Math.cos(a - Math.PI / 2) * half, cy + Math.sin(a - Math.PI / 2) * half];
  const r: Pt = [cx + Math.cos(a + Math.PI / 2) * half, cy + Math.sin(a + Math.PI / 2) * half];
  const c: Pt = [cx, cy];
  return (
    el('path', { d: polygonPath([c, l, tip]), fill: light, stroke: line, 'stroke-width': lw, 'stroke-linejoin': 'round' }) +
    el('path', { d: polygonPath([c, r, tip]), fill: dark, stroke: line, 'stroke-width': lw, 'stroke-linejoin': 'round' })
  );
}

/** Size of the box a compass rose needs (its letters stick out of the circle). */
export const compassBox = (size: number) => size * 1.3;

export function compassRose(style: PrintStyle, cx: number, cy: number, size: number, lang: Lang, k: number): string {
  const c = style.compass;
  const R = size / 2;
  const lw = 0.25 * k;
  const font = style.fonts.heading;
  const [N, E, S, W] = DIRS[lang];
  const letter = (t: string, angle: number, dist: number, fs: number, fill: string) => {
    const a = angle - Math.PI / 2;
    return el(
      'text',
      { x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist + fs * 0.35, 'text-anchor': 'middle', fill, ...fontAttrs(font, fs) },
      t,
    );
  };
  let out = '';
  if (c.kind === 'simple') {
    out += el('circle', { cx, cy, r: R * 0.55, fill: 'none', stroke: c.dark, 'stroke-width': lw });
    out += el('path', { d: polygonPath([[cx, cy - R * 0.85], [cx + R * 0.16, cy + R * 0.3], [cx, cy + R * 0.12], [cx - R * 0.16, cy + R * 0.3]]), fill: c.dark });
    out += letter(N, 0, R * 1.15, R * 0.42, c.dark);
    return `<g class="compass">${out}</g>`;
  }
  const ring = R * 0.9;
  // Rings with a tick for every point of the 32-wind rose.
  out += el('circle', { cx, cy, r: ring, fill: c.fill, 'fill-opacity': 0.85, stroke: c.dark, 'stroke-width': lw * 1.6 });
  out += el('circle', { cx, cy, r: ring * 0.9, fill: 'none', stroke: c.dark, 'stroke-width': lw });
  let ticks = '';
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const inner = ring * (i % 4 === 0 ? 0.9 : 0.95);
    ticks += `M${n(cx + Math.cos(a) * inner)},${n(cy + Math.sin(a) * inner)}L${n(cx + Math.cos(a) * ring)},${n(cy + Math.sin(a) * ring)}`;
  }
  out += el('path', { d: ticks, stroke: c.dark, 'stroke-width': lw * 0.6, fill: 'none' });
  const nautical = c.kind === 'nautical';
  // Quarter winds, half winds, then the eight principal winds on top.
  for (let i = 0; i < 16; i++) {
    const a = ((i * 2 + 1) * Math.PI) / 16;
    out += starPoint(cx, cy, a, ring * 0.62, R * 0.05, c.dark, c.fill, c.dark, lw * 0.6);
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i * 2 + 1) * Math.PI) / 8;
    out += starPoint(cx, cy, a, ring * 0.72, R * 0.075, nautical ? c.accent : c.dark, c.fill, c.dark, lw * 0.7);
  }
  for (let i = 0; i < 4; i++) {
    const a = ((i * 2 + 1) * Math.PI) / 4;
    out += starPoint(cx, cy, a, ring * 0.78, R * 0.1, c.dark, c.fill, c.dark, lw);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const dark = i === 0 ? c.accent : c.dark;
    out += starPoint(cx, cy, a, R * 1.02, R * 0.14, dark, c.fill, c.dark, lw);
  }
  out += el('circle', { cx, cy, r: R * 0.07, fill: c.fill, stroke: c.dark, 'stroke-width': lw });
  out += el('circle', { cx, cy, r: R * 0.025, fill: c.dark });
  const fs = R * 0.24;
  out += letter(N, 0, R * 1.18, fs * 1.2, c.accent);
  out += letter(E, Math.PI / 2, R * 1.15, fs, c.dark);
  out += letter(S, Math.PI, R * 1.17, fs, c.dark);
  out += letter(W, (3 * Math.PI) / 2, R * 1.15, fs, c.dark);
  return `<g class="compass">${out}</g>`;
}

/** Rhumb lines: straight lines radiating from the compass across the whole chart, as on a portolan. */
export function rhumbLines(style: PrintStyle, cx: number, cy: number, reach: number, k: number): string {
  const r = style.map.rhumbLines;
  if (!r.count) return '';
  const byColor = new Map<string, string>();
  for (let i = 0; i < r.count; i++) {
    const a = (i / r.count) * Math.PI * 2 - Math.PI / 2;
    // Principal winds in the first colour, half winds the second, quarter winds the third.
    const level = i % 4 === 0 ? 0 : i % 2 === 0 ? 1 : 2;
    const color = r.colors[Math.min(level, r.colors.length - 1)];
    byColor.set(color, (byColor.get(color) ?? '') + `M${n(cx)},${n(cy)}L${n(cx + Math.cos(a) * reach)},${n(cy + Math.sin(a) * reach)}`);
  }
  return [...byColor].map(([color, d]) => el('path', { d, stroke: color, 'stroke-width': r.width * k, fill: 'none', opacity: r.opacity })).join('');
}

/** Scale bar; returns the SVG and its size. `km` is the length the bar stands for. */
export function scaleBar(
  style: PrintStyle,
  x: number,
  y: number,
  barMm: number,
  km: number,
  caption: string,
  k: number,
  fs = 3 * k,
): string {
  const ink = style.ink.main;
  const font = style.fonts.italic;
  const h = 1.6 * k;
  const label = (v: number) => (v >= 1000 ? v.toLocaleString('en-US').replace(/,/g, ' ') : String(v));
  let out = el('text', { x: x + barMm / 2, y: y + fs * 0.8, 'text-anchor': 'middle', fill: ink, ...fontAttrs(font, fs) }, caption);
  const by = y + fs * 1.5;
  if (style.scaleBar.kind === 'checkered') {
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      out += el('rect', { x: x + (i * barMm) / segs, y: by, width: barMm / segs, height: h, fill: i % 2 ? style.compass.fill : ink, stroke: ink, 'stroke-width': 0.2 * k });
    }
    for (const [i, v] of [0, km / 2, km].entries()) {
      out += el('text', { x: x + (i * barMm) / 2, y: by + h + fs * 1.05, 'text-anchor': 'middle', fill: ink, ...fontAttrs(font, fs * 0.9) }, label(v));
    }
    out += el('text', { x: x + barMm + fs * 0.5, y: by + h * 0.9, fill: ink, ...fontAttrs(font, fs * 0.9) }, 'km');
  } else {
    out += el('path', { d: `M${n(x)},${n(by)}v${n(h)}h${n(barMm)}v${n(-h)}M${n(x + barMm / 2)},${n(by + h * 0.4)}v${n(h * 0.6)}`, stroke: ink, 'stroke-width': 0.25 * k, fill: 'none' });
    out += el('text', { x: x + barMm / 2, y: by + h + fs * 1.05, 'text-anchor': 'middle', fill: ink, ...fontAttrs(style.fonts.body, fs * 0.9) }, `${label(km)} km`);
  }
  return `<g class="scale-bar">${out}</g>`;
}

export const scaleBarHeight = (k: number, fs = 3 * k) => fs * 1.5 + 1.6 * k + fs * 1.3;

/**
 * The frame around the map: outer and inner lines, and the band between them with degree marks
 * where the graticule meets the edge (or plain alternating blocks if it doesn't).
 */
export function mapFrame(style: PrintStyle, outer: Box, inner: Box, ticks: FrameTick[], lang: Lang, k: number): string {
  const f = style.frame;
  let out = '';
  out += el('rect', { x: outer.x, y: outer.y, width: outer.w, height: outer.h, fill: 'none', stroke: f.color, 'stroke-width': f.outerWidth * k });
  const band = (inner.x - outer.x);
  if (band <= 0) return `<g class="frame">${out}</g>`;
  out += el('rect', { x: inner.x, y: inner.y, width: inner.w, height: inner.h, fill: 'none', stroke: f.color, 'stroke-width': f.innerWidth * k });

  if (f.kind === 'nautical') {
    // A chequered strip along the inside of the band, switching at every degree mark.
    const mid = band * 0.42;
    const strip = (side: FrameTick['side']) => {
      const along = side === 'top' || side === 'bottom';
      const start = along ? inner.x : inner.y;
      const end = along ? inner.x + inner.w : inner.y + inner.h;
      let cuts = ticks.filter((t) => t.side === side).map((t) => t.pos);
      if (cuts.length < 3) cuts = Array.from({ length: Math.floor((end - start) / (10 * k)) }, (_, i) => start + (i + 1) * 10 * k);
      const edges = [start, ...cuts, end];
      let d = '';
      for (let i = 0; i < edges.length - 1; i += 2) {
        const a = edges[i];
        const b = edges[i + 1];
        if (side === 'top') d += `M${n(a)},${n(inner.y - mid)}H${n(b)}V${n(inner.y)}H${n(a)}Z`;
        if (side === 'bottom') d += `M${n(a)},${n(inner.y + inner.h)}H${n(b)}V${n(inner.y + inner.h + mid)}H${n(a)}Z`;
        if (side === 'left') d += `M${n(inner.x - mid)},${n(a)}V${n(b)}H${n(inner.x)}V${n(a)}Z`;
        if (side === 'right') d += `M${n(inner.x + inner.w)},${n(a)}V${n(b)}H${n(inner.x + inner.w + mid)}V${n(a)}Z`;
      }
      return d;
    };
    out += el('path', { d: (['top', 'bottom', 'left', 'right'] as const).map(strip).join(''), fill: f.color, opacity: 0.85 });
    out += el('rect', { x: inner.x - mid, y: inner.y - mid, width: inner.w + 2 * mid, height: inner.h + 2 * mid, fill: 'none', stroke: f.color, 'stroke-width': f.innerWidth * k });
  }

  // Degree marks and labels in the band.
  if (f.degreeLabels) {
    const fs = Math.min(band * 0.55, sized('degree', 2.6, k));
    const tick = band * (f.kind === 'nautical' ? 0.42 : 0.3);
    let d = '';
    let labels = '';
    const font = style.fonts.body;
    const labelAt = f.kind === 'nautical' ? band * 0.72 : band * 0.62;
    for (const t of ticks) {
      const text = degreeLabel(t.deg, t.side === 'top' || t.side === 'bottom' ? 'lon' : 'lat', lang);
      if (t.side === 'top') {
        d += `M${n(t.pos)},${n(inner.y)}v${n(-tick)}`;
        labels += el('text', { x: t.pos, y: inner.y - labelAt + fs * 0.35, 'text-anchor': 'middle', fill: f.color, ...fontAttrs(font, fs) }, text);
      } else if (t.side === 'bottom') {
        d += `M${n(t.pos)},${n(inner.y + inner.h)}v${n(tick)}`;
        labels += el('text', { x: t.pos, y: inner.y + inner.h + labelAt + fs * 0.35, 'text-anchor': 'middle', fill: f.color, ...fontAttrs(font, fs) }, text);
      } else {
        const x = t.side === 'left' ? inner.x - labelAt : inner.x + inner.w + labelAt;
        d += t.side === 'left' ? `M${n(inner.x)},${n(t.pos)}h${n(-tick)}` : `M${n(inner.x + inner.w)},${n(t.pos)}h${n(tick)}`;
        labels += el(
          'text',
          { x, y: t.pos, transform: `rotate(-90 ${n(x)} ${n(t.pos)})`, 'text-anchor': 'middle', dy: fs * 0.35, fill: f.color, ...fontAttrs(font, fs) },
          text,
        );
      }
    }
    if (f.kind !== 'nautical') out += el('path', { d, stroke: f.color, 'stroke-width': f.innerWidth * k, fill: 'none' });
    out += labels;
  }

  if (f.kind === 'antique') {
    // Corner squares with a small rosette.
    for (const [x, y] of [
      [outer.x, outer.y],
      [inner.x + inner.w, outer.y],
      [outer.x, inner.y + inner.h],
      [inner.x + inner.w, inner.y + inner.h],
    ]) {
      const cx = x + band / 2;
      const cy = y + band / 2;
      out += el('rect', { x, y, width: band, height: band, fill: style.cartouche.fill, stroke: f.color, 'stroke-width': f.innerWidth * k });
      out += el('circle', { cx, cy, r: band * 0.28, fill: 'none', stroke: f.color, 'stroke-width': f.innerWidth * k });
      out += starPoint(cx, cy, 0, band * 0.4, band * 0.07, f.color, style.cartouche.fill, f.color, 0.1 * k);
      out += starPoint(cx, cy, Math.PI / 2, band * 0.4, band * 0.07, f.color, style.cartouche.fill, f.color, 0.1 * k);
      out += starPoint(cx, cy, Math.PI, band * 0.4, band * 0.07, f.color, style.cartouche.fill, f.color, 0.1 * k);
      out += starPoint(cx, cy, (3 * Math.PI) / 2, band * 0.4, band * 0.07, f.color, style.cartouche.fill, f.color, 0.1 * k);
    }
  }
  return `<g class="frame">${out}</g>`;
}

/** Rectangle with its corners cut in by quarter circles, as on engraved cartouches. */
function notchedRect(b: Box, r: number): string {
  const { x, y, w, h } = b;
  return (
    `M${n(x + r)},${n(y)}H${n(x + w - r)}A${n(r)},${n(r)} 0 0 0 ${n(x + w)},${n(y + r)}` +
    `V${n(y + h - r)}A${n(r)},${n(r)} 0 0 0 ${n(x + w - r)},${n(y + h)}` +
    `H${n(x + r)}A${n(r)},${n(r)} 0 0 0 ${n(x)},${n(y + h - r)}` +
    `V${n(y + r)}A${n(r)},${n(r)} 0 0 0 ${n(x + r)},${n(y)}Z`
  );
}

/** A scroll curl, as drawn at the sides of a cartouche. */
function curl(x: number, y: number, s: number, dir: 1 | -1): string {
  // A spiral made of arcs shrinking towards its centre.
  let d = `M${n(x)},${n(y - s)}`;
  let r = s;
  let cx = x;
  let cy = y;
  let up = true;
  for (let i = 0; i < 4; i++) {
    const ny = up ? cy + r : cy - r;
    d += `A${n(r)},${n(r)} 0 0 ${dir === 1 ? 1 : 0} ${n(cx)},${n(ny)}`;
    r *= 0.62;
    cy = up ? ny - r : ny + r;
    up = !up;
  }
  return d;
}

/** How much room a panel's ornaments take around its text. */
export const panelOrnamentPad = (style: PrintStyle, k: number) =>
  style.cartouche.kind === 'scroll' ? 3.2 * k : style.cartouche.kind === 'framed' ? 2.4 * k : 0.6 * k;

/** The border and background of a panel (cartouche or legend) in the style's manner. */
export function panelFrame(style: PrintStyle, b: Box, k: number, withCurls: boolean): string {
  const c = style.cartouche;
  const lw = 0.3 * k;
  if (c.kind === 'plain') {
    return el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: c.fill, 'fill-opacity': 0.94, stroke: c.stroke, 'stroke-width': lw * 0.6 });
  }
  if (c.kind === 'framed') {
    const g = 1.2 * k;
    return (
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: c.fill, stroke: c.stroke, 'stroke-width': lw * 2.6 }) +
      el('rect', { x: b.x + g, y: b.y + g, width: b.w - 2 * g, height: b.h - 2 * g, fill: 'none', stroke: c.stroke, 'stroke-width': lw * 0.8 }) +
      el('rect', { x: b.x + g / 2, y: b.y + g / 2, width: b.w - g, height: b.h - g, fill: 'none', stroke: c.stroke, 'stroke-width': lw * 0.7, 'stroke-dasharray': `${n(1.2 * k)} ${n(0.6 * k)}` })
    );
  }
  // Scroll: notched double frame, with curls at the sides.
  const r = 3 * k;
  const g = 1.1 * k;
  let out = el('path', { d: notchedRect(b, r), fill: c.fill, stroke: c.stroke, 'stroke-width': lw * 2.4 });
  out += el('path', { d: notchedRect({ x: b.x + g, y: b.y + g, w: b.w - 2 * g, h: b.h - 2 * g }, r - g * 0.6), fill: 'none', stroke: c.stroke, 'stroke-width': lw * 0.8 });
  if (withCurls) {
    const s = Math.min(4.5 * k, b.h * 0.18);
    const my = b.y + b.h / 2;
    out += el('path', { d: curl(b.x, my, s, 1) + curl(b.x + b.w, my, s, -1), fill: 'none', stroke: c.stroke, 'stroke-width': lw * 1.4, 'stroke-linecap': 'round' });
  }
  return out;
}

/** A short rule with a diamond in the middle, between parts of a panel. */
export function rule(style: PrintStyle, cx: number, y: number, w: number, k: number): string {
  const s = 0.9 * k;
  const ink = style.cartouche.stroke;
  if (style.cartouche.kind === 'plain') return el('path', { d: `M${n(cx - w / 2)},${n(y)}H${n(cx + w / 2)}`, stroke: ink, 'stroke-width': 0.2 * k });
  return (
    el('path', { d: `M${n(cx - w / 2)},${n(y)}H${n(cx - s * 1.6)}M${n(cx + s * 1.6)},${n(y)}H${n(cx + w / 2)}`, stroke: ink, 'stroke-width': 0.25 * k }) +
    el('path', { d: polygonPath([[cx, y - s], [cx + s, y], [cx, y + s], [cx - s, y]]), fill: style.ink.accent })
  );
}
