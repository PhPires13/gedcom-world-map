// Renders a print file from a GEDCOM on the server, the way an order's file is made (public view,
// 300 dpi PNG + PDF + SVG), without the API. Useful to check the output and timing.
//
//   npx tsx server/scripts/render-sample.ts [A3|A2|A1] [style] [out-dir] [file.ged] [places.json]
//
// Defaults: A2, antique, ./print-out, public/sample.ged, server/test/fixtures/sample-places.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDesign } from '../../src/commerce/design';
import { parseGedcom } from '../../src/gedcom';
import { localTreeDetail } from '../../src/model';
import type { PaperSize } from '../../src/print/types';
import { loadStyles } from '../print/assets';
import { preparePrint, renderPrintFiles } from '../print/render';

const [paper = 'A2', style = 'antique', out = 'print-out', ged = 'public/sample.ged', placesFile = 'server/test/fixtures/sample-places.json'] = process.argv.slice(2);
const places = JSON.parse(readFileSync(placesFile, 'utf8'));
delete places._comment;
const detail = localTreeDetail(parseGedcom(readFileSync(ged, 'utf8')), 'sample', new Date().getUTCFullYear());
const design = parseDesign({ styleId: style, lang: 'pt', places }, loadStyles().map((s) => s.id));
const t0 = Date.now();
const prepared = preparePrint(detail, design, paper as PaperSize);
const files = await renderPrintFiles(prepared);
mkdirSync(out, { recursive: true });
const base = `${out}/heritage-map-${style}-${paper}`;
writeFileSync(`${base}.png`, files.png);
writeFileSync(`${base}.pdf`, files.pdf);
writeFileSync(`${base}.svg`, files.svg);
console.log(
  `${paper} ${style}: ${files.widthPx}×${files.heightPx} px, ${files.peopleOnMap} people on the map, ${prepared.privateCount} private left off; ` +
    `PNG ${(files.png.length / 1e6).toFixed(1)} MB, PDF ${(files.pdf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
for (const w of files.warnings) console.log(`warning: ${w}`);
