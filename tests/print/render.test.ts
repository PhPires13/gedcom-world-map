import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPrintData, defaultRoot } from '../../src/print/data';
import { contains, overlaps } from '../../src/print/layout';
import { defaultTexts, renderHeritageMap } from '../../src/print/render';
import { STYLES } from '../../src/print/styles';
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
});
