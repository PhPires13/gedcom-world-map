// Small helpers for writing SVG as text.

import type { Pt } from './types';

/** A number for SVG: two decimals (0.01 mm is far below what a printer resolves). */
export const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const pointsAttr = (pts: Pt[]) => pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');

export const linePath = (pts: Pt[]) => (pts.length ? `M${pts.map((p) => `${n(p[0])},${n(p[1])}`).join('L')}` : '');

export const polygonPath = (pts: Pt[]) => (pts.length ? `${linePath(pts)}Z` : '');

/** Attributes from an object, skipping empty values. */
export function attrs(a: Record<string, string | number | undefined | null | false>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? n(v) : esc(String(v))}"`)
    .join('');
}

export const el = (tag: string, a: Record<string, string | number | undefined | null | false>, inner?: string) =>
  inner === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`;

/** CSS-style font attributes for a text element. */
export function fontAttrs(font: { family: string; weight?: number; style?: string }, size: number) {
  return {
    'font-family': `'${font.family}', serif`,
    'font-weight': font.weight ?? 400,
    'font-style': font.style ?? 'normal',
    'font-size': size,
  };
}

/**
 * Turns a flag-icons SVG file into a <symbol> that can be placed with <use>. Its internal ids are
 * already unique per country in flag-icons (e.g. "pt-a"), so each country's symbol is defined once.
 */
export function flagSymbol(code: string, svg: string): string {
  const open = /<svg\b([^>]*)>/i.exec(svg);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < 0) return '';
  const inner = svg.slice(open.index + open[0].length, close);
  const viewBox = /viewBox="([^"]*)"/.exec(open[1])?.[1] ?? '0 0 512 512';
  // Keep presentation attributes set on the root (a few flags set fill there).
  const keep = open[1]
    .replace(/\s(xmlns(:\w+)?|id|viewBox|version|xml:space|width|height)="[^"]*"/g, '')
    .trim();
  return `<symbol id="flag-${code}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice"><g ${keep}>${inner}</g></symbol>`;
}

export const roman = (num: number): string => {
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) while (num >= v) { out += s; num -= v; }
  return out;
};
