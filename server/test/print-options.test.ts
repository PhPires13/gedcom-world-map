/// <reference types="vite/client" />
// (The designer's option lists load with import.meta.glob; vitest runs them, the server never does.)
// An order prints exactly what the designer showed: the server, given the design stored on an
// order, draws the same SVG as the designer's preview for the same choices — including the
// layouts, borders, finishes, flag size and surnames on the routes. The designer side here is
// built the way src/print/designer.ts builds it, from the designer's own option lists
// (src/print/catalog.ts, src/print/styles), so a choice the server dropped would show up as a
// different drawing.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesign, type DesignSpec } from '../../src/commerce/design';
import { originEvent, parseGedcom } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import { localTreeDetail } from '../../src/model';
import { BORDERS, FINISHES, LAYOUTS, borderById, finishById, layoutById } from '../../src/print/catalog';
import { buildPrintData, defaultRoot, type Located } from '../../src/print/data';
import { renderHeritageMap, topologyDetailFor } from '../../src/print/render';
import { STYLES, styleById } from '../../src/print/styles';
import type { PrintOptions } from '../../src/print/types';
import { designOptionIds } from '../print/assets';
import { preparePrint, printPixels, rasterize } from '../print/render';

const places: Record<string, { lat: number; lon: number }> = JSON.parse(readFileSync(new URL('./fixtures/sample-places.json', import.meta.url), 'utf8'));
delete (places as Record<string, unknown>)._comment;
const ged = readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8');
const sample = { tree: parseGedcom(ged), name: 'sample' };
const dense = { tree: parseGedcom(readFileSync(new URL('../../tests/print/fixtures/dense-portugal-brazil.ged', import.meta.url), 'utf8')), name: 'dense' };
const tree = sample.tree;
const detail = localTreeDetail(tree, 'sample', 2026);
const ids = designOptionIds();

/** The preview as the designer draws it: its tree with private people left off, its option lists. */
function designerPreview(design: DesignSpec, paper: 'A2', t: { tree: typeof tree; name: string } = sample) {
  const tree = t.tree;
  const detail = localTreeDetail(tree, t.name, 2026);
  const hidden = new Set(detail.people.filter((p) => p.isPrivate).map((p) => p.id));
  const located = new Map<string, Located>();
  for (const p of tree.people.values()) {
    const ev = !hidden.has(p.id) ? originEvent(p)?.event : undefined;
    if (ev && ev.lat !== undefined && ev.lon !== undefined) located.set(p.id, { lat: ev.lat, lon: ev.lon, place: ev.place ?? '' });
    else if (ev?.place && places[ev.place]) located.set(p.id, { ...places[ev.place], place: ev.place });
  }
  const gens = computeGenerations(tree);
  const data = buildPrintData(tree, located, gens, design.selection);
  const o: PrintOptions = {
    style: styleById(design.styleId),
    paper,
    orientation: design.orientation,
    area: design.area,
    lang: design.lang,
    title: design.title,
    subtitle: design.subtitle,
    dedication: design.dedication,
    show: design.show,
    layout: layoutById(design.layoutId),
    border: design.borderId ? borderById(design.borderId) : undefined,
    finish: design.finishId ? finishById(design.finishId) : undefined,
    flagScale: design.flagScale,
    routes: design.routes,
    maxRoutes: design.maxRoutes,
  };
  return { data, o };
}

const COMBOS = [
  { layoutId: 'storybook', borderId: 'laurel', finishId: 'aged', flagScale: 1.3, routes: 'essential' },
  { layoutId: 'vignette', borderId: 'rope', finishId: 'deckled', flagScale: 0.75, routes: 'essential' },
  { layoutId: 'accurate', borderId: 'engraved', finishId: 'clean', flagScale: 1, routes: 'detailed' },
  { layoutId: 'homelands', borderId: 'engraved', finishId: 'aged', flagScale: 1.2, routes: 'essential' },
] as const;

describe('the server prints every option the designer offers', () => {
  it('knows the same option lists as the designer', () => {
    expect([...ids.styles].sort()).toEqual(STYLES.map((s) => s.id).sort());
    expect(ids.layouts).toEqual(LAYOUTS.map((l) => l.id));
    expect([...ids.borders].sort()).toEqual(BORDERS.map((b) => b.id).sort());
    expect([...ids.finishes].sort()).toEqual(FINISHES.map((f) => f.id).sort());
  });

  for (const combo of COMBOS) {
    it(`${combo.layoutId} + ${combo.borderId} + ${combo.finishId}, ${combo.routes} routes, at A2 draws the designer’s preview`, () => {
      const rootId = defaultRoot(tree, computeGenerations(tree));
      const design = parseDesign(
        { styleId: 'antique', lang: 'pt', title: 'Família Costa', subtitle: '1810–1998', ...combo, show: { surnames: true, flags: 'both' }, selection: { rootId, branch: 'all' }, places },
        ids,
      );
      const server = preparePrint(detail, design, 'A2');
      const preview = designerPreview(design, 'A2');

      // Same people, same moves, same direct line, same options, same map detail (medallions need 1:10m).
      expect(server.data).toEqual(preview.data);
      expect(server.data.directLine?.length).toBeGreaterThan(1);
      expect(server.options).toEqual(preview.o);
      expect(topologyDetailFor(server.data, server.options)).toBe(topologyDetailFor(preview.data, preview.o));
      if (combo.layoutId === 'vignette') expect(topologyDetailFor(server.data, server.options)).toBe('10m');

      // With the same fonts and measuring, the drawings are identical.
      const assets = server.assets;
      const a = renderHeritageMap(server.data, server.options, assets);
      const b = renderHeritageMap(preview.data, preview.o, assets);
      expect(a.svg).toBe(b.svg);
      if (combo.layoutId === 'vignette') expect(a.layout.medallions.length).toBeGreaterThan(1);
      else expect(a.layout.medallions).toEqual([]);
      // Same routes chosen on both sides.
      expect(a.layout.routes).toEqual(b.layout.routes);
      // Surnames along the routes, and gone when the customer turned them off.
      expect(a.layout.routeLabels.map((l) => l.text)).toContain('Almeida · 1940');
      const off = preparePrint(detail, { ...design, show: { ...design.show, surnames: false } }, 'A2');
      expect(renderHeritageMap(off.data, off.options, off.assets).layout.routeLabels.map((l) => l.text)).not.toContain('Almeida · 1940');
      // Full A2 renders on 1:10m coastlines take several seconds on a busy machine.
    }, 30_000);
  }

  it('picks the same few essential routes as the preview on a dense tree, and every move when detailed', () => {
    const denseDetail = localTreeDetail(dense.tree, 'dense', 2026);
    const rootId = defaultRoot(dense.tree, computeGenerations(dense.tree));
    const counts: Record<string, number> = {};
    for (const routes of ['essential', 'detailed'] as const) {
      const design = parseDesign({ styleId: 'antique', lang: 'pt', title: 'Família', subtitle: '1815–1920', routes, selection: { rootId, branch: 'all' } }, ids);
      const server = preparePrint(denseDetail, design, 'A2');
      const preview = designerPreview(design, 'A2', dense);
      expect(server.data.people.length).toBeGreaterThan(100);
      expect(server.data.directLine).toEqual(preview.data.directLine);
      expect(server.options).toEqual(preview.o);
      const a = renderHeritageMap(server.data, server.options, server.assets);
      const b = renderHeritageMap(preview.data, preview.o, server.assets);
      expect(a.layout.routes).toEqual(b.layout.routes);
      expect(a.svg).toBe(b.svg);
      counts[routes] = new Set(a.layout.routes.map((r) => JSON.stringify(r.pts[0]))).size;
    }
    // Essential keeps a few main routes; detailed draws many more.
    expect(counts.essential).toBeLessThan(counts.detailed);
    // A cap from the order is honoured too.
    const capped = parseDesign({ routes: 'essential', maxRoutes: 3, selection: { rootId, branch: 'all' } }, ids);
    const p = preparePrint(denseDetail, capped, 'A2');
    expect(p.options.maxRoutes).toBe(3);
  });

  it(
    'rasterises both at A2 proportions with resvg',
    () => {
      for (const combo of COMBOS.slice(0, 2)) {
        const design = parseDesign({ styleId: 'antique', ...combo, places }, ids);
        const p = preparePrint(detail, design, 'A2');
        // 60 dpi keeps the test quick; the 300 dpi path is the same call (print-render.test.ts).
        const px = printPixels('A2', 'landscape', 60);
        const svg = renderHeritageMap(p.data, { ...p.options, pixelSize: { width: px.width, height: px.height } }, p.assets).svg;
        const img = rasterize(svg, p.fonts, p.options.style.fonts.body.family);
        expect([img.width, img.height]).toEqual([px.width, px.height]);
      }
    },
    60_000,
  );
});
