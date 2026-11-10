// The print file made on the server, with the real renderer (resvg + PDFKit): the right pixel
// size and dpi, a PDF of the exact paper size with the fonts embedded, and only the public view.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesign } from '../../src/commerce/design';
import { parseGedcom } from '../../src/gedcom';
import { localTreeDetail } from '../../src/model';
import { designOptionIds, loadFont } from '../print/assets';
import { textOnlySvg } from '../print/pdf';
import { preparePrint, printPixels, renderPrintFiles } from '../print/render';
import { woffToSfnt } from '../print/woff';

const places = JSON.parse(readFileSync(new URL('./fixtures/sample-places.json', import.meta.url), 'utf8'));
delete places._comment;
const detail = localTreeDetail(parseGedcom(readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8')), 'sample', 2026);
const ids = designOptionIds();

const pngInfo = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  const out: { width?: number; height?: number; pxPerMetre?: number } = {};
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IHDR') Object.assign(out, { width: v.getUint32(at + 8), height: v.getUint32(at + 12) });
    if (type === 'pHYs') out.pxPerMetre = v.getUint32(at + 8);
    if (type === 'IDAT') break;
    at += 12 + len;
  }
  return out;
};

describe('server print render', () => {
  it('knows the 300 dpi pixel sizes of every paper', () => {
    expect(printPixels('A3', 'landscape')).toMatchObject({ width: 4961, height: 3508 });
    expect(printPixels('A2', 'landscape')).toMatchObject({ width: 7016, height: 4961 });
    expect(printPixels('A2', 'portrait')).toMatchObject({ width: 4961, height: 7016 });
    expect(printPixels('A1', 'landscape')).toMatchObject({ width: 9933, height: 7016 });
  });

  it('only draws people from the public view', () => {
    const prepared = preparePrint(detail, parseDesign({ places }, ids), 'A3');
    expect(prepared.privateCount).toBeGreaterThan(0);
    const privateIds = new Set(detail.people.filter((p) => p.isPrivate).map((p) => p.id));
    expect(prepared.data.people.length).toBeGreaterThan(0);
    for (const p of prepared.data.people) expect(privateIds.has(p.id)).toBe(false);
    // Without the redaction, the private people with a birthplace would be on the map too.
    const placedPrivate = detail.people.filter((p) => p.isPrivate && (p.birth?.place || p.baptism?.place));
    expect(placedPrivate.length).toBeGreaterThan(0);
  });

  it(
    'renders an A3 at 300 dpi: PNG of the right size and resolution, PDF of the exact page size with fonts embedded',
    async () => {
      const prepared = preparePrint(detail, parseDesign({ styleId: 'antique', lang: 'pt', places }, ids), 'A3');
      const files = await renderPrintFiles(prepared);
      expect(files).toMatchObject({ widthPx: 4961, heightPx: 3508 });
      expect(pngInfo(files.png)).toEqual({ width: 4961, height: 3508, pxPerMetre: Math.round(300 / 0.0254) });

      const pdf = Buffer.from(files.pdf).toString('latin1');
      expect(pdf.startsWith('%PDF-1.7')).toBe(true);
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
      expect(Number(box[1])).toBeCloseTo((420 / 25.4) * 72, 2);
      expect(Number(box[2])).toBeCloseTo((297 / 25.4) * 72, 2);
      expect(pdf).toMatch(/\/Width 4961\s*\/Height 3508/);
      expect(pdf.match(/\/FontFile2/g)?.length).toBeGreaterThanOrEqual(3);
      expect(pdf).toContain('IM_FELL_English_SC');
      expect(files.svg).toContain('@font-face');
    },
    120_000,
  );
});

describe('print helpers', () => {
  it('turns WOFF fonts into TrueType that fontkit can read', () => {
    const f = loadFont({ family: 'Jost', weight: 400, style: 'normal' });
    expect(f.face.familyName).toBe('Jost');
    expect(new DataView(f.sfnt.buffer, f.sfnt.byteOffset).getUint32(0)).toBe(0x00010000);
    expect(() => woffToSfnt(new Uint8Array(64))).toThrow(/Not a WOFF/);
  });

  it('keeps only text (with groups and clips) for the PDF text layer', () => {
    const svg =
      `<svg><defs><style>@font-face{}</style><filter id="f"><feTurbulence/></filter><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>` +
      `<rect x="0" y="0" width="10" height="10" filter="url(#f)"/><g clip-path="url(#c)"><path d="M0 0"/>` +
      `<text x="1" y="2" fill="#000" stroke="#fff" stroke-width="0.9" paint-order="stroke" font-family="'IM Fell English', serif" font-weight="400" font-style="italic" font-size="3">Lisboa</text></g></svg>`;
    const out = textOnlySvg(svg);
    expect(out).not.toContain('<style>');
    expect(out).not.toContain('<filter');
    expect(out).toContain('<clipPath id="c"><rect width="1" height="1"/></clipPath>');
    expect(out).not.toMatch(/<path|<rect x="0"/);
    expect(out).toContain('<text x="1" y="2" fill="#000" font-family="IM Fell English|400|italic" font-size="3">Lisboa</text>');
    // Labels along a route carry their fonts on <tspan>s inside a <textPath>.
    const curved = textOnlySvg(
      `<svg><defs><path id="r" d="M0 0L10 0"/></defs><text fill="#5a4a1c" stroke="#fff" paint-order="stroke"><textPath href="#r"><tspan font-family="'IM Fell English SC', serif" font-weight="400" font-style="normal" font-size="6">Almeida</tspan></textPath></text></svg>`,
    );
    expect(curved).toContain('<path id="r" d="M0 0L10 0"/>');
    expect(curved).toContain('<text fill="#5a4a1c"><textPath href="#r"><tspan font-family="IM Fell English SC|400|normal" font-size="6">Almeida</tspan>');
  });
});
