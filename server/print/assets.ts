// What `renderHeritageMap` needs, loaded from node_modules with fs: the same Natural Earth
// topology, flags, styles and fonts the browser designer bundles, so the server's print matches
// the preview. Everything is cached in memory after the first load.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import type { Topology } from 'topojson-specification';
import type { DesignOptionIds } from '../../src/commerce/design';
import { validateBorder, validateFinish, type BorderSpec, type FinishSpec } from '../../src/print/borders';
import { validateLayout, type LayoutSpec } from '../../src/print/layouts';
import { fontFaceCss, fontKey, styleFonts, validateStyle, type PrintStyle } from '../../src/print/style';
import type { FontRef, MeasureText } from '../../src/print/types';
import { woffToSfnt } from './woff';

const require = createRequire(import.meta.url);
const PRINT_DIR = fileURLToPath(new URL('../../src/print/', import.meta.url));

/** Every JSON file in src/print/<dir>/, validated like the designer does, `first` first. */
function loadJsonDir<T extends { id: string; name: string }>(dir: string, validate: (x: unknown) => string[], first: string): T[] {
  return readdirSync(`${PRINT_DIR}${dir}`)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ f, s: JSON.parse(readFileSync(`${PRINT_DIR}${dir}/${f}`, 'utf8')) as T }))
    .filter(({ f, s }) => {
      const errors = validate(s);
      if (errors.length) console.error(`Print ${dir} ${f} is invalid:\n  ${errors.join('\n  ')}`);
      return !errors.length;
    })
    .map(({ s }) => s)
    .sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
}

let cache: { styles: PrintStyle[]; layouts: LayoutSpec[]; borders: BorderSpec[]; finishes: FinishSpec[] } | undefined;
/** The designer's options, read from the same JSON files (src/print/{styles,layouts,borders,finishes}). */
export function loadPrintOptions() {
  if (!cache) {
    const layoutOrder = ['accurate', 'closeup', 'homelands', 'storybook', 'vignette'];
    cache = {
      styles: loadJsonDir<PrintStyle>('styles', validateStyle, 'antique'),
      layouts: loadJsonDir<LayoutSpec>('layouts', validateLayout, 'accurate').sort(
        (a, b) => (layoutOrder.indexOf(a.id) + 1 || 99) - (layoutOrder.indexOf(b.id) + 1 || 99),
      ),
      borders: loadJsonDir<BorderSpec>('borders', validateBorder, 'engraved'),
      finishes: loadJsonDir<FinishSpec>('finishes', validateFinish, 'clean'),
    };
  }
  return cache;
}

export const loadStyles = () => loadPrintOptions().styles;

/** Ids a design may use, for `parseDesign`. */
export function designOptionIds(): DesignOptionIds {
  const o = loadPrintOptions();
  return { styles: o.styles.map((s) => s.id), layouts: o.layouts.map((l) => l.id), borders: o.borders.map((b) => b.id), finishes: o.finishes.map((f) => f.id) };
}

const topologies = new Map<string, Topology>();
export function loadTopology(detail: '50m' | '10m'): Topology {
  let t = topologies.get(detail);
  if (!t) {
    t = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${detail}.json`), 'utf8')) as Topology;
    topologies.set(detail, t);
  }
  return t;
}

const flagDir = () => fileURLToPath(new URL('./flags/1x1/', `file://${require.resolve('flag-icons/package.json')}`));
const flagCache = new Map<string, string | null>();
export function loadFlags(codes: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of codes) {
    if (!/^[a-z]{2}(-[a-z]+)?$/.test(code)) continue;
    if (!flagCache.has(code)) {
      try {
        flagCache.set(code, readFileSync(`${flagDir()}/${code}.svg`, 'utf8'));
      } catch {
        flagCache.set(code, null);
      }
    }
    const svg = flagCache.get(code);
    if (svg) out[code] = svg;
  }
  return out;
}

export interface LoadedFont {
  font: FontRef;
  /** Plain TrueType bytes (for PDF embedding). */
  sfnt: Uint8Array;
  /** The same bytes as a file: resvg's native build only loads fonts from files. */
  path: string;
  /** The WOFF2 file as a data: URL (for SVG files people download). */
  woff2DataUrl: string;
  face: fontkit.Font;
}

const slug = (family: string) => family.toLowerCase().replace(/\s+/g, '-');
const fontCache = new Map<string, LoadedFont>();

export function loadFont(font: FontRef): LoadedFont {
  const key = fontKey(font);
  let f = fontCache.get(key);
  if (!f) {
    const s = slug(font.family);
    const base = `@fontsource/${s}/files/${s}-latin-${font.weight ?? 400}-${font.style ?? 'normal'}`;
    let woff: Buffer;
    let woff2: Buffer;
    try {
      woff = readFileSync(require.resolve(`${base}.woff`));
      woff2 = readFileSync(require.resolve(`${base}.woff2`));
    } catch {
      throw new Error(`Font not installed: ${base}.woff (npm install @fontsource/${s})`);
    }
    const sfnt = woffToSfnt(woff);
    const face = fontkit.create(Buffer.from(sfnt)) as fontkit.Font;
    const dir = `${tmpdir()}/heritage-print-fonts`;
    const path = `${dir}/${s}-${font.weight ?? 400}-${font.style ?? 'normal'}-${sfnt.length}.ttf`;
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, sfnt);
    }
    f = { font, sfnt, path, woff2DataUrl: `data:font/woff2;base64,${woff2.toString('base64')}`, face };
    fontCache.set(key, f);
  }
  return f;
}

export function loadStyleFonts(style: PrintStyle): LoadedFont[] {
  return styleFonts(style).map(loadFont);
}

/** @font-face rules with the fonts embedded, for SVG files. */
export const embeddedFontCss = (fonts: LoadedFont[]) => fontFaceCss(fonts.map((f) => ({ font: f.font, url: f.woff2DataUrl })));

/** Text width in mm measured with the real font's advances and kerning (what the browser's canvas does). */
export function fontMeasure(fonts: LoadedFont[]): MeasureText {
  const byKey = new Map(fonts.map((f) => [fontKey(f.font), f.face]));
  return (text, font, size, spacing = 0) => {
    const face = byKey.get(fontKey(font)) ?? loadFont(font).face;
    const width = (face.layout(text).advanceWidth / face.unitsPerEm) * size;
    return width + Math.max(0, text.length - 1) * spacing;
  };
}
