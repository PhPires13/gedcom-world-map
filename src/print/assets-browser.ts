// Loads what the renderer needs in the browser: Natural Earth topology, flag SVGs and fonts, all
// bundled from npm packages (nothing is fetched from third-party servers). A server would load the
// same files from node_modules with fs instead.

import type { Topology } from 'topojson-specification';
import { fontFaceCss, fontKey, fontPackagePath, styleFonts, type PrintStyle } from './style';
import type { FontRef, MeasureText } from './types';

const flagFiles = import.meta.glob<string>('/node_modules/flag-icons/flags/1x1/*.svg', { query: '?raw', import: 'default' });
const fontFiles = import.meta.glob<string>('/node_modules/@fontsource/*/files/*-latin-*.woff2', { query: '?url', import: 'default' });

const topologies = new Map<string, Promise<Topology>>();
export function loadTopology(detail: '50m' | '10m'): Promise<Topology> {
  let t = topologies.get(detail);
  if (!t) {
    t = (detail === '10m' ? import('world-atlas/countries-10m.json') : import('world-atlas/countries-50m.json')).then(
      (m) => m.default as unknown as Topology,
    );
    topologies.set(detail, t);
  }
  return t;
}

const flagCache = new Map<string, string>();
/** Flag SVGs for the given country codes (codes without a flag are left out). */
export async function loadFlags(codes: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...codes].map(async (code) => {
      if (!flagCache.has(code)) {
        const load = flagFiles[`/node_modules/flag-icons/flags/1x1/${code}.svg`];
        if (!load) return;
        flagCache.set(code, await load());
      }
      out[code] = flagCache.get(code)!;
    }),
  );
  return out;
}

/** Every country code there's a flag for. */
export const availableFlags = () =>
  Object.keys(flagFiles).map((p) => p.split('/').pop()!.replace('.svg', ''));

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

const fontData = new Map<string, Promise<{ dataUrl: string; buffer: ArrayBuffer }>>();
function loadFont(f: FontRef) {
  const key = fontKey(f);
  let p = fontData.get(key);
  if (!p) {
    const load = fontFiles[`/node_modules/${fontPackagePath(f)}`];
    if (!load) return Promise.reject(new Error(`Font not installed: ${fontPackagePath(f)} (add the @fontsource package)`));
    p = load()
      .then((url) => fetch(url))
      .then(async (res) => {
        const buffer = await res.arrayBuffer();
        return { buffer, dataUrl: await blobToDataUrl(new Blob([buffer], { type: 'font/woff2' })) };
      });
    fontData.set(key, p);
  }
  return p;
}

const registered = new Set<string>();

/**
 * Loads a style's fonts: registers them with the page (for the preview and for measuring text)
 * and returns @font-face rules with the fonts embedded, for exported files.
 */
export async function loadStyleFonts(style: PrintStyle): Promise<{ css: string; measure: MeasureText }> {
  const fonts = styleFonts(style);
  const loaded = await Promise.all(fonts.map(async (font) => ({ font, ...(await loadFont(font)) })));
  for (const { font, buffer } of loaded) {
    const key = fontKey(font);
    if (registered.has(key)) continue;
    const face = new FontFace(font.family, buffer, { weight: String(font.weight ?? 400), style: font.style ?? 'normal' });
    await face.load();
    document.fonts.add(face);
    registered.add(key);
  }
  return { css: fontFaceCss(loaded.map(({ font, dataUrl }) => ({ font, url: dataUrl }))), measure: canvasMeasure };
}

const ctx = document.createElement('canvas').getContext('2d')!;
/** Text width in mm with the real font, measured at 10 px per mm. */
export const canvasMeasure: MeasureText = (text, font, size, spacing = 0) => {
  ctx.font = `${font.style ?? 'normal'} ${font.weight ?? 400} ${size * 10}px '${font.family}'`;
  return ctx.measureText(text).width / 10 + Math.max(0, text.length - 1) * spacing;
};
