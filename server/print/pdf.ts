// The print as a PDF of the exact paper size, made of two layers:
//
//   1. the artwork as a lossless 300 dpi image (Flate, RGB): paper grain, stains, ink wobble and
//      masks are SVG filters that no SVG→PDF converter reproduces, so resvg draws them;
//   2. every piece of text on top as real PDF text in the style's fonts, embedded (subset) in the
//      file, so the lettering is sharp at any zoom and searchable.
//
// Text halos (the paper-coloured outline behind labels) stay in the image layer; only the text
// fills are vector. A pure vector PDF without the paper effects would be `textOnlySvg` without the
// stripping of shapes; it is not offered because it would not match the preview.

import { deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { fontKey } from '../../src/print/style';
import type { LoadedFont } from './assets';

const PT_PER_MM = 72 / 25.4;

/** Hides text fills (halo strokes stay): the PDF's image layer, under the vector text. */
export const hideTextFill = (svg: string) => svg.replace(/<text\b/g, '<text fill-opacity="0"');

const GRAPHICS = '(?:path|rect|use|circle|ellipse|line|polyline|polygon|image)';

/**
 * Only the text of a drawing (with the groups, transforms and clip paths around it), with each
 * text's font written as "Family|weight|style" so the PDF can pick the matching embedded font.
 */
export function textOnlySvg(svg: string): string {
  const cut = svg.indexOf('</defs>');
  if (cut < 0) throw new Error('Expected <defs> in the print SVG');
  const head = svg
    .slice(0, cut)
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<(filter|symbol|mask|radialGradient|linearGradient)\b[\s\S]*?<\/\1>/g, '');
  const body = svg
    .slice(cut)
    .replace(new RegExp(`<${GRAPHICS}\\b[^>]*/>`, 'g'), '')
    .replace(new RegExp(`<(${GRAPHICS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g'), '')
    .replace(/\s(filter|mask)="[^"]*"/g, '')
    // Fonts can sit on the <text> or on its <tspan>s (labels along a route's <textPath>).
    .replace(/<(?:text|tspan)\b[^>]*>/g, (tag) => {
      const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
      const family = (attr('font-family') ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      const key = fontKey({ family, weight: Number(attr('font-weight') ?? 400), style: attr('font-style') === 'italic' ? 'italic' : 'normal' });
      return tag
        .replace(/\s(stroke|stroke-width|stroke-linejoin|paint-order|font-weight|font-style)="[^"]*"/g, '')
        .replace(/\sfont-family="[^"]*"/, ` font-family="${key}"`);
    });
  return head + body;
}

export interface PdfInput {
  /** The drawing from renderHeritageMap (mm user units). */
  svg: string;
  fonts: LoadedFont[];
  widthMm: number;
  heightMm: number;
  title: string;
  /** The artwork with text fills hidden, as RGBA pixels (resvg's output). */
  raster: { width: number; height: number; rgba: Uint8Array };
}

/** RGBA (premultiplied or opaque) → RGB on white. */
function toRgb(rgba: Uint8Array): Buffer {
  const rgb = Buffer.allocUnsafe((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const back = 255 - rgba[i + 3];
    rgb[j] = Math.min(255, rgba[i] + back);
    rgb[j + 1] = Math.min(255, rgba[i + 1] + back);
    rgb[j + 2] = Math.min(255, rgba[i + 2] + back);
  }
  return rgb;
}

export function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const W = input.widthMm * PT_PER_MM;
  const H = input.heightMm * PT_PER_MM;
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    compress: true,
    pdfVersion: '1.7',
    info: { Title: input.title, Creator: 'Heritage map print', Producer: 'PDFKit + resvg' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
  });

  // 1. The artwork, stretched to the page (it is exactly the page's size at 300 dpi).
  const { width, height, rgba } = input.raster;
  const data = deflateSync(toRgb(rgba), { level: 6 });
  const image = doc.ref({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
  image.end(data);
  (doc.page as unknown as { xobjects: Record<string, unknown> }).xobjects.Art = image;
  doc.save();
  // PDFKit's user space has y pointing down; an image XObject fills the unit square upwards.
  doc.transform(W, 0, 0, -H, 0, H);
  doc.addContent('/Art Do');
  doc.restore();

  // 2. The text, in the embedded fonts.
  for (const f of input.fonts) doc.registerFont(fontKey(f.font), Buffer.from(f.sfnt));
  const known = new Set(input.fonts.map((f) => fontKey(f.font)));
  const fallback = fontKey(input.fonts[0].font);
  SVGtoPDF(doc, textOnlySvg(input.svg), 0, 0, {
    width: W,
    height: H,
    preserveAspectRatio: 'none',
    fontCallback: (family: string) => {
      const key = family.replace(/^['"]|['"]$/g, '');
      return known.has(key) ? key : fallback;
    },
  });

  doc.end();
  return done;
}
