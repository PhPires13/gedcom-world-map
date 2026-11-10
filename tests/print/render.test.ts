import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrintData, defaultRoot } from '../../src/print/data';
import { contains, overlaps } from '../../src/print/layout';
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
});
