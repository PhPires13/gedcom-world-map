// Renders a print file from a GEDCOM on the server, the way an order's file is made (public view,
// 300 dpi PNG + PDF + SVG), without the API. Useful to check the output and timing.
//
//   npx tsx server/scripts/render-sample.ts [A3|A2|A1] [style] [out-dir] [file.ged] [places.json]
//
// Defaults: A2, antique, ./print-out, public/sample.ged, server/test/fixtures/sample-places.json.
// LAYOUT, BORDER, FINISH and FLAG_SCALE environment variables pick the other design options.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDesign } from '../../src/commerce/design';
import { parseGedcom } from '../../src/gedcom';
import { localTreeDetail } from '../../src/model';
import type { PaperSize } from '../../src/print/types';
import { designOptionIds } from '../print/assets';
import { preparePrint, renderPrintFiles } from '../print/render';

const [paper = 'A2', style = 'antique', out = 'print-out', ged = 'public/sample.ged', placesFile = 'server/test/fixtures/sample-places.json'] = process.argv.slice(2);
const places = JSON.parse(readFileSync(placesFile, 'utf8'));
delete places._comment;
const detail = localTreeDetail(parseGedcom(readFileSync(ged, 'utf8')), 'sample', new Date().getUTCFullYear());
const design = parseDesign(
  { styleId: style, lang: 'pt', places, layoutId: process.env.LAYOUT, borderId: process.env.BORDER, finishId: process.env.FINISH, flagScale: process.env.FLAG_SCALE ? Number(process.env.FLAG_SCALE) : undefined },
  designOptionIds(),
);
const t0 = Date.now();
const prepared = preparePrint(detail, design, paper as PaperSize);
const files = await renderPrintFiles(prepared);
mkdirSync(out, { recursive: true });
const base = `${out}/heritage-map-${[style, design.layoutId, design.borderId, design.finishId, paper].filter(Boolean).join('-')}`;
writeFileSync(`${base}.png`, files.png);
writeFileSync(`${base}.pdf`, files.pdf);
writeFileSync(`${base}.svg`, files.svg);
console.log(
  `${paper} ${style}: ${files.widthPx}×${files.heightPx} px, ${files.peopleOnMap} people on the map, ${prepared.privateCount} private left off; ` +
    `PNG ${(files.png.length / 1e6).toFixed(1)} MB, PDF ${(files.pdf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
for (const w of files.warnings) console.log(`warning: ${w}`);
