// What `renderHeritageMap` needs, loaded from node_modules with fs: the same Natural Earth
// topology, flags, styles and fonts the browser designer bundles, so the server's print matches
// the preview. Everything is cached in memory after the first load.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import type { Topology } from 'topojson-specification';
import { fontFaceCss, fontKey, styleFonts, validateStyle, type PrintStyle } from '../../src/print/style';
import type { FontRef, MeasureText } from '../../src/print/types';
import { woffToSfnt } from './woff';

const require = createRequire(import.meta.url);
const STYLES_DIR = fileURLToPath(new URL('../../src/print/styles/', import.meta.url));

let styles: PrintStyle[] | undefined;
/** The print styles (src/print/styles/*.json), validated; antique first as in the designer. */
export function loadStyles(): PrintStyle[] {
  if (!styles) {
    styles = readdirSync(STYLES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, s: JSON.parse(readFileSync(`${STYLES_DIR}/${f}`, 'utf8')) as PrintStyle }))
      .filter(({ f, s }) => {
        const errors = validateStyle(s);
        if (errors.length) console.error(`Print style ${f} is invalid:\n  ${errors.join('\n  ')}`);
        return !errors.length;
      })
      .map(({ s }) => s)
      .sort((a, b) => (a.id === 'antique' ? -1 : b.id === 'antique' ? 1 : a.name.localeCompare(b.name)));
  }
  return styles;
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
