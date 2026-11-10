// The print file, made on the server: the same `renderHeritageMap` as the designer's preview, fed
// from the tree's PUBLIC view (presumed-living people are redacted to "Private" with no places, so
// they never reach paper) and the design stored on the order.
//
// Output: the SVG (fonts embedded), a 300 dpi PNG (resvg, with the pHYs chunk) and a PDF of the
// exact paper size (see pdf.ts).

import { Resvg } from '@resvg/resvg-js';
import type { DesignSpec } from '../../src/commerce/design';
import { originEvent, type Tree } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import { redactPerson, toGedcomTree, type TreeDetail } from '../../src/model';
import { CountryLocator } from '../../src/print/countries';
import { buildPrintData, defaultRoot, type Located } from '../../src/print/data';
import { mmToPx, pageSize } from '../../src/print/geo';
import { setPngDpi } from '../../src/print/png';
import { defaultTexts, renderHeritageMap, topologyDetailFor } from '../../src/print/render';
import type { PaperSize, PrintAssets, PrintData, PrintOptions } from '../../src/print/types';
import { embeddedFontCss, fontMeasure, loadFlags, loadPrintOptions, loadStyleFonts, loadTopology, type LoadedFont } from './assets';
import { buildPdf, hideTextFill } from './pdf';

export const PRINT_DPI = 300;

/** People on the map: coordinates from the tree itself, else from the design's place lookup. */
export function locate(tree: Tree, places: DesignSpec['places']): Map<string, Located> {
  const located = new Map<string, Located>();
  for (const p of tree.people.values()) {
    const ev = originEvent(p)?.event;
    if (!ev) continue;
    if (ev.lat !== undefined && ev.lon !== undefined) located.set(p.id, { lat: ev.lat, lon: ev.lon, place: ev.place ?? '' });
    else if (ev.place && places[ev.place]) located.set(p.id, { ...places[ev.place], place: ev.place });
  }
  return located;
}

export interface PreparedPrint {
  data: PrintData;
  options: PrintOptions;
  assets: PrintAssets;
  fonts: LoadedFont[];
  /** People in the tree who are private in the public view (and so are not on the print). */
  privateCount: number;
}

/**
 * Everything needed to draw the print. The tree is always reduced to its public view here
 * (`redactPerson` on everyone), whatever the caller passed, so private people can't be printed.
 */
export function preparePrint(detail: Pick<TreeDetail, 'people' | 'relationships'>, design: DesignSpec, paper: PaperSize): PreparedPrint {
  const people = detail.people.map(redactPerson);
  const tree = toGedcomTree({ people, relationships: detail.relationships });
  const gens = computeGenerations(tree);
  const located = locate(tree, design.places);
  const rootId = design.selection.rootId && tree.people.has(design.selection.rootId) ? design.selection.rootId : defaultRoot(tree, gens);
  const data = buildPrintData(tree, located, gens, { ...design.selection, rootId });
  const all = loadPrintOptions();
  const style = all.styles.find((s) => s.id === design.styleId) ?? all.styles[0];
  const defaults = defaultTexts(data, design.lang, rootId);
  // Every choice the designer offers, read from the same JSON files the designer uses.
  const options: PrintOptions = {
    style,
    paper,
    orientation: design.orientation,
    area: design.area,
    lang: design.lang,
    title: design.title || defaults.title,
    subtitle: design.subtitle || defaults.subtitle,
    dedication: design.dedication,
    show: design.show,
    layout: all.layouts.find((l) => l.id === design.layoutId) ?? all.layouts[0],
    border: design.borderId ? all.borders.find((b) => b.id === design.borderId) : undefined,
    finish: design.finishId ? all.finishes.find((f) => f.id === design.finishId) : undefined,
    flagScale: design.flagScale,
    // Orders from before the routes choice were previewed with every move.
    routes: design.routes ?? 'detailed',
    maxRoutes: design.maxRoutes,
  };

  // Same map detail as the designer (medallions need the 1:10m coastlines).
  const topology = loadTopology(topologyDetailFor(data, options));
  const locator = new CountryLocator(topology);
  const codes = new Set(data.people.map((p) => locator.locate(p)).filter(Boolean));
  const fonts = loadStyleFonts(style);
  return {
    data,
    options,
    assets: { topology, flags: loadFlags(codes), fontCss: '', measure: fontMeasure(fonts) },
    fonts,
    privateCount: people.filter((p) => p.isPrivate && !p.mergedInto).length,
  };
}

export interface PrintFiles {
  svg: string;
  png: Uint8Array;
  pdf: Uint8Array;
  widthPx: number;
  heightPx: number;
  warnings: string[];
  peopleOnMap: number;
}

/** Pixel size of the print at `dpi`. */
export function printPixels(paper: PaperSize, orientation: PrintOptions['orientation'], dpi = PRINT_DPI) {
  const { w, h } = pageSize(paper, orientation);
  return { width: mmToPx(w, dpi), height: mmToPx(h, dpi), wMm: w, hMm: h };
}

/**
 * Rasterises an SVG whose width/height are already in pixels (renderHeritageMap's `pixelSize`).
 * resvg matches font families exactly as named inside the font files, which can differ from the
 * CSS name (IM Fell's files say "IM FELL English SC"), so families are renamed to match first.
 */
export function rasterize(svg: string, fonts: LoadedFont[], defaultFamily: string) {
  let named = svg;
  let fallback = defaultFamily;
  for (const f of fonts) {
    const internal = f.face.familyName;
    if (f.font.family === defaultFamily) fallback = internal;
    if (internal !== f.font.family) named = named.split(`font-family="'${f.font.family}',`).join(`font-family="'${internal}',`);
  }
  const resvg = new Resvg(named, {
    fitTo: { mode: 'original' },
    font: { fontFiles: fonts.map((f) => f.path), loadSystemFonts: false, defaultFontFamily: fallback },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
  });
  return resvg.render();
}

export async function renderPrintFiles(prepared: PreparedPrint, dpi = PRINT_DPI): Promise<PrintFiles> {
  const { data, options, assets, fonts } = prepared;
  const px = printPixels(options.paper, options.orientation, dpi);
  // For the raster, fonts come from resvg's font list; the downloadable SVG embeds them.
  const res = renderHeritageMap(data, { ...options, pixelSize: { width: px.width, height: px.height } }, assets);
  const image = rasterize(res.svg, fonts, options.style.fonts.body.family);
  if (image.width !== px.width || image.height !== px.height) {
    throw new Error(`Rendered ${image.width}×${image.height} px, expected ${px.width}×${px.height}`);
  }
  const png = setPngDpi(new Uint8Array(image.asPng()), dpi);
  // The PDF's artwork is the same drawing without the text fills (text halos stay in the image);
  // the text goes on top as real text in the embedded fonts.
  const background = rasterize(hideTextFill(res.svg), fonts, options.style.fonts.body.family);
  const pdf = await buildPdf({
    svg: res.svg,
    fonts,
    widthMm: px.wMm,
    heightMm: px.hMm,
    title: options.title || 'Heritage map',
    raster: { width: background.width, height: background.height, rgba: background.pixels },
  });
  const svg = renderHeritageMap(data, options, { ...assets, fontCss: embeddedFontCss(fonts) }).svg;
  return { svg, png, pdf, widthPx: image.width, heightPx: image.height, warnings: res.warnings, peopleOnMap: data.people.length };
}
