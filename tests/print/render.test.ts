import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrintData, defaultRoot } from '../../src/print/data';
import { contains, distToPolyline, overlaps } from '../../src/print/layout';
import { makeProjection } from '../../src/print/geo';
import { projectRoutes } from '../../src/print/routes';
import { routeCap } from '../../src/print/simplify';
import { defaultTexts, renderHeritageMap } from '../../src/print/render';
import { BORDERS, FINISHES, LAYOUTS } from '../../src/print/catalog';
import { MIN_SIZES } from '../../src/print/style';
import { STYLES } from '../../src/print/styles';
import { parseGedcom } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import type { AreaId, PrintOptions } from '../../src/print/types';
import { fakeFlag, sampleTree, topology } from './fixtures';

const { tree, gens, located } = sampleTree();
const root = defaultRoot(tree, gens);
const data = buildPrintData(tree, located, gens, { rootId: root, branch: 'all' });
const flags = Object.fromEntries(['pt', 'br', 'ie', 'us', 'gb', 'fr', 'es', 'ao'].map((c) => [c, fakeFlag(c)]));

const options = (over: Partial<PrintOptions> = {}): PrintOptions => ({
  style: STYLES[0],
  paper: 'A2',
  orientation: 'landscape',
  area: 'family',
  lang: 'pt',
  ...defaultTexts(data, 'pt', root),
  dedication: 'Para os meus avós, que atravessaram o mar.',
  show: { dates: true, placeNames: true, flags: 'origins', countryNames: true, oceanNames: true, compass: true, scaleBar: true, legend: true, graticule: true },
  ...over,
});

describe('renderHeritageMap', () => {
  it('renders the sample family as a well-formed SVG of the paper size', () => {
    const res = renderHeritageMap(data, options(), { topology, flags, fontCss: '' });
    expect(res.width).toBe(594);
    expect(res.height).toBe(420);
    expect(res.svg.startsWith('<svg')).toBe(true);
    expect(res.svg).toContain('viewBox="0 0 594 420"');
    expect(res.svg).toContain('Família Costa');
    expect(res.layout.routes.length).toBeGreaterThan(5);
    expect(res.layout.flags.map((f) => f.code).sort()).toEqual(expect.arrayContaining(['pt', 'ie']));
    // Tags balance (a cheap well-formedness check without a DOM).
    const opens = (res.svg.match(/<[a-zA-Z][^>]*[^/]>/g) ?? []).length;
    const closes = (res.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
    expect(opens).toBe(closes);
    if (process.env.PRINT_OUT) writeFileSync(process.env.PRINT_OUT, res.svg);
  });

  for (const style of STYLES) {
    for (const area of ['family', 'world', 'atlantic', 'europe'] as AreaId[]) {
      it(`keeps panels, flags and labels inside the map and apart (${style.id}, ${area})`, () => {
        const { layout } = renderHeritageMap(data, options({ style, area }), { topology, flags, fontCss: '' });
        const panels = [layout.cartouche, layout.legend, layout.compass, layout.scaleBar].filter((b) => !!b);
        for (const p of panels) expect(contains(layout.map, p)).toBe(true);
        for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) expect(overlaps(panels[i], panels[j])).toBe(false);
        for (const f of layout.flags) {
          const box = { x: f.center[0] - f.r, y: f.center[1] - f.r, w: 2 * f.r, h: 2 * f.r };
          expect(contains(layout.map, box)).toBe(true);
          for (const p of panels) expect(overlaps(p, box)).toBe(false);
        }
        for (const l of layout.labels) {
          expect(contains(layout.map, l.box)).toBe(true);
          for (const p of panels) expect(overlaps(p, l.box)).toBe(false);
        }
        // Every cartouche line fits inside the cartouche.
        const c = layout.cartouche!;
        for (const line of c.lines) expect(line.width).toBeLessThanOrEqual(c.w);
      });
    }
  }

  it('scales the same design with the paper size', () => {
    const a2 = renderHeritageMap(data, options(), { topology, flags, fontCss: '' });
    const a1 = renderHeritageMap(data, options({ paper: 'A1' }), { topology, flags, fontCss: '' });
    expect(a1.width / a2.width).toBeCloseTo(841 / 594, 3);
    expect(a1.layout.cartouche!.x / a2.layout.cartouche!.x).toBeCloseTo(594 / 420, 1);
    expect(a1.layout.flags.length).toBe(a2.layout.flags.length);
  });

  it('sets the pixel size for rasterising without changing the drawing', () => {
    const res = renderHeritageMap(data, options({ pixelSize: { width: 7016, height: 4961 } }), { topology, flags, fontCss: '' });
    expect(res.svg).toMatch(/^<svg[^>]*width="7016" height="4961" viewBox="0 0 594 420"/);
  });

  for (const layout of LAYOUTS) {
    for (const paper of ['A3', 'A2', 'A1'] as const) {
      it(`never prints anything too small to read (${layout.id}, ${paper})`, () => {
        const k = paper === 'A3' ? 297 / 420 : paper === 'A1' ? 594 / 420 : 1;
        const res = renderHeritageMap(data, options({ layout, paper, style: STYLES[0] }), { topology, flags, fontCss: '' });
        const sizes = [...res.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
        expect(sizes.length).toBeGreaterThan(10);
        // Nothing under ~7 pt on an A2 (2.5 mm), scaled gently for other sizes.
        for (const s of sizes) expect(s).toBeGreaterThanOrEqual(2.5 * Math.sqrt(k) - 0.01);
        for (const l of res.layout.routeLabels) expect(l.size).toBeGreaterThanOrEqual(MIN_SIZES.date * Math.sqrt(k) * 0.82 - 0.01);
        for (const s of res.layout.routes) expect(s.width).toBeGreaterThanOrEqual(MIN_SIZES.route * Math.sqrt(k) - 0.01);
        for (const f of res.layout.flags) expect(f.r).toBeGreaterThanOrEqual(MIN_SIZES.flag * Math.sqrt(k) * 0.85 - 0.01);
      });
    }
  }

  it('letters the family surname along the routes, and can leave it off', () => {
    const on = renderHeritageMap(data, options(), { topology, flags, fontCss: '' });
    expect(on.layout.routeLabels.length).toBeGreaterThan(3);
    expect(on.layout.routeLabels.some((l) => /^(COSTA|Costa|ALMEIDA|Almeida|SANTOS|Santos)/.test(l.text))).toBe(true);
    expect(on.svg).toContain('<textPath href="#route-label-');
    const off = renderHeritageMap(data, options({ show: { ...options().show, surnames: false } }), { topology, flags, fontCss: '' });
    expect(off.layout.routeLabels.every((l) => /^\d{4}(–\d{4})?$/.test(l.text))).toBe(true);
  });

  it('prints in Spanish', () => {
    const texts = defaultTexts(data, 'es', root);
    expect(texts.title).toBe('Familia Costa');
    expect(texts.subtitle).toBe(defaultTexts(data, 'pt', root).subtitle);
    const es = renderHeritageMap(data, options({ lang: 'es', ...texts, show: { ...options().show, flags: 'both' } }), { topology, flags, fontCss: '' });
    expect(es.svg).toContain('Familia Costa');
    expect(es.svg).toMatch(/Leyenda|LEYENDA/);
    expect(es.svg).toMatch(/Lugar de nacimiento|LUGAR DE NACIMIENTO/);
    expect(es.svg).not.toMatch(/Legenda|LEGENDA|Local de nascimento/);
    expect(es.layout.labels.map((l) => l.text).join(' ')).toMatch(/OCÉANO ATLÁNTICO|ATLÁNTICO SUR/);
    const pt = renderHeritageMap(data, options({ show: { ...options().show, flags: 'both' } }), { topology, flags, fontCss: '' });
    expect(pt.svg).toMatch(/Legenda|LEGENDA/);
  });

  it('reports what it left out as data, alongside the English warnings', () => {
    const res = renderHeritageMap(data, options({ area: 'iberia', show: { ...options().show, flags: 'all' } }), { topology, flags: { pt: flags.pt }, fontCss: '' });
    expect(res.notices.outsideArea).toBeGreaterThan(0);
    expect(res.notices.missingFlags).toContain('br');
    expect(res.warnings).toContain(`${res.notices.outsideArea} people are born outside the chosen area and not shown.`);
  });

  it('draws flags at both ends of the moves when asked, scaled by the flag size', () => {
    const origins = renderHeritageMap(data, options({ show: { ...options().show, flags: 'origins' } }), { topology, flags, fontCss: '' });
    const both = renderHeritageMap(data, options({ show: { ...options().show, flags: 'both' }, flagScale: 1.5 }), { topology, flags, fontCss: '' });
    expect(both.layout.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['br', 'pt']));
    expect(both.layout.flags.length).toBeGreaterThan(origins.layout.flags.length);
    expect(both.layout.flags[0].r).toBeCloseTo(origins.layout.flags[0].r * 1.5, 5);
  });

  for (const layout of LAYOUTS) {
    for (const border of [undefined, ...BORDERS]) {
      it(`keeps panels and labels inside the map with ${layout.id} and ${border?.id ?? 'the style frame'}`, () => {
        const res = renderHeritageMap(data, options({ layout, border, finish: FINISHES[FINISHES.length - 1] }), { topology, flags, fontCss: '' });
        const { layout: l } = res;
        const panels = [l.cartouche, l.legend, l.compass, l.scaleBar].filter((b) => !!b);
        for (const p of panels) expect(contains(l.map, p)).toBe(true);
        for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) expect(overlaps(panels[i], panels[j])).toBe(false);
        for (const lb of l.labels) expect(contains(l.map, lb.box)).toBe(true);
        for (const rl of l.routeLabels) for (const b of rl.boxes) for (const p of panels) expect(overlaps(p, b)).toBe(false);
        // A gallery border writes the title under the map instead of in a cartouche.
        if (border?.caption) {
          expect(l.cartouche).toBeUndefined();
          expect(res.svg).toContain('class="caption"');
        }
        expect(res.svg).not.toContain('NaN');
      });
    }
  }

  it('handles a dense tree (many families from Portugal to Brazil) in every layout', () => {
    const t = parseGedcom(readFileSync(resolve(__dirname, 'fixtures/dense-portugal-brazil.ged'), 'utf8'));
    const g = computeGenerations(t);
    const loc = new Map([...t.people.values()].map((p) => [p.id, { lat: p.birth!.lat!, lon: p.birth!.lon!, place: p.birth!.place! }]));
    const dense = buildPrintData(t, loc, g, { branch: 'all' });
    expect(dense.people.length).toBe(279);
    for (const layout of LAYOUTS) {
      const res = renderHeritageMap(dense, options({ layout }), { topology, flags, fontCss: '' });
      expect(res.layout.marks.length).toBeGreaterThan(15);
      expect(res.layout.routeLabels.length).toBeLessThanOrEqual(14);
      if (layout.kind === 'vignette') {
        expect(res.layout.medallions.length).toBeLessThanOrEqual(9);
        const perCountry = new Map<string, number>();
        for (const m of res.layout.medallions) perCountry.set(m.code, (perCountry.get(m.code) ?? 0) + 1);
        for (const n of perCountry.values()) expect(n).toBeLessThanOrEqual(2);
      }
    }
  });

  describe('essential routes', () => {
    const denseTree = () => {
      const t = parseGedcom(readFileSync(resolve(__dirname, 'fixtures/dense-portugal-brazil.ged'), 'utf8'));
      const g = computeGenerations(t);
      const loc = new Map([...t.people.values()].map((p) => [p.id, { lat: p.birth!.lat!, lon: p.birth!.lon!, place: p.birth!.place! }]));
      return buildPrintData(t, loc, g, { branch: 'all' });
    };
    const dense = denseTree();

    for (const [name, d] of [['sample', data], ['dense tree', dense]] as const) {
      for (const layout of LAYOUTS) {
        it(`draws a few labelled routes that never collide (${name}, ${layout.id})`, () => {
          const res = renderHeritageMap(d, options({ layout }), { topology, flags, fontCss: '' });
          const l = res.layout;
          const arrows = l.routes.filter((s) => s.arrow);
          const cap = routeCap('A2');
          expect(arrows.length).toBeLessThanOrEqual(cap + Math.ceil(cap / 3));
          expect(arrows.length).toBeGreaterThan(2);
          // One label per arrow at most, and labels never overlap each other, a flag, a panel or another route.
          expect(l.routeLabels.length).toBeLessThanOrEqual(arrows.length);
          const panels = [l.cartouche, l.legend, l.compass, l.scaleBar].filter((b) => !!b);
          const flagBoxes = l.flags.map((f) => ({ x: f.center[0] - f.r, y: f.center[1] - f.r, w: 2 * f.r, h: 2 * f.r }));
          l.routeLabels.forEach((a, i) => {
            for (const b of a.boxes) {
              for (const p of [...panels, ...flagBoxes]) expect(overlaps(b, p)).toBe(false);
              for (const other of l.routeLabels.slice(i + 1)) for (const c of other.boxes) expect(overlaps(b, c)).toBe(false);
              const c: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
              const near = l.routes.filter((s) => distToPolyline(c, s.pts) < b.w / 2 + s.width / 2);
              // Only its own route may be that close.
              expect(new Set(near.map((s) => s.pts)).size).toBeLessThanOrEqual(1);
            }
          });
          if (layout.kind === 'vignette') {
            const ms = l.medallions;
            for (const [i, a] of ms.entries())
              for (const b of ms.slice(i + 1)) expect(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1])).toBeGreaterThan(a.r + b.r);
            // One medallion per country.
            expect(new Set(ms.map((m) => m.code)).size).toBe(ms.length);
          }
        });
      }
    }

    it('fits fewer routes on A3 than on A1', () => {
      const count = (paper: 'A3' | 'A1') => renderHeritageMap(dense, options({ paper }), { topology, flags, fontCss: '' }).layout.routes.filter((s) => s.arrow).length;
      expect(count('A3')).toBeLessThanOrEqual(routeCap('A3'));
      expect(count('A3')).toBeLessThan(count('A1'));
    });

    it('names a route after the family of the direct line when it made the move', () => {
      const res = renderHeritageMap(dense, options(), { topology, flags, fontCss: '' });
      const root = dense.directLine![0];
      const surname = dense.people.find((p) => p.id === root)!.surname.split(' ').pop()!.toUpperCase();
      expect(res.layout.routeLabels.some((r) => r.text.toUpperCase().startsWith(surname))).toBe(true);
    });

    it('keeps the old behaviour when asked for detailed routes', () => {
      const res = renderHeritageMap(dense, options({ routes: 'detailed' }), { topology, flags, fontCss: '' });
      // The same strokes as drawing every move with the map's own projection.
      const projection = makeProjection('family', dense.people, res.layout.map, STYLES[0].map.projection, 0.11);
      const old = projectRoutes(dense.flows, (p) => projection([p.lon, p.lat]) as [number, number], { radius: 5, minWidth: 1.5, maxWidth: 4.6, endGap: 2, arrowSize: 7.5, wobble: 0, dateOffset: 2 }, () => undefined);
      expect(res.layout.routes.length).toBe(old.strokes.length);
      expect(res.layout.routes.length).toBeGreaterThan(renderHeritageMap(dense, options(), { topology, flags, fontCss: '' }).layout.routes.length * 3);
      // Detailed medallions may still split a country in two.
      const med = renderHeritageMap(dense, options({ routes: 'detailed', layout: LAYOUTS.find((l) => l.kind === 'vignette') }), { topology, flags, fontCss: '' });
      expect(med.layout.medallions.length).toBeGreaterThan(new Set(med.layout.medallions.map((m) => m.code)).size);
    });
  });
});
