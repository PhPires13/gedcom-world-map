import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGedcom } from '../../src/gedcom';
import { localTreeDetail } from '../../src/model';
import { CARD_W, indexFamily, layoutChart } from '../../src/tree/layout';

const detail = localTreeDetail(
  parseGedcom(readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8')),
  'sample',
  2026,
);
const idx = indexFamily(detail.people, detail.relationships);
const MIGUEL = '@I3@';

describe('layoutChart', () => {
  it('puts ancestors above, descendants below and the spouse beside the focus', () => {
    const chart = layoutChart(idx, MIGUEL, 2, 1);
    const at = (id: string) => chart.nodes.filter((n) => n.personId === id);
    expect(at(MIGUEL)[0]).toMatchObject({ x: 0, y: 0, generation: 0 });
    for (const parent of ['@I5@', '@I6@']) expect(at(parent)[0].generation).toBe(-1);
    for (const child of ['@I1@', '@I2@']) expect(at(child)[0].generation).toBe(1);
    expect(at('@I4@')[0]).toMatchObject({ generation: 0, y: 0 });
    expect(at('@I4@')[0].x).toBeGreaterThan(0);
  });

  it('draws one line per relationship shown, each tied to its relationship id', () => {
    const chart = layoutChart(idx, MIGUEL, 2, 1);
    const relIds = new Set(detail.relationships.map((r) => r.id));
    expect(chart.edges.every((e) => relIds.has(e.relationshipId))).toBe(true);
    // Every non-focus node hangs from exactly one line.
    expect(chart.edges).toHaveLength(chart.nodes.length - 1);
  });

  it('does not overlap cards in the same row', () => {
    const chart = layoutChart(idx, '@I1@', 4, 0);
    const rows = Map.groupBy(chart.nodes, (n) => n.y);
    for (const row of rows.values()) {
      const xs = row.map((n) => n.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(CARD_W);
    }
  });

  it('flags people whose relatives lie beyond the chosen depth', () => {
    const chart = layoutChart(idx, MIGUEL, 1, 0);
    expect(chart.nodes.find((n) => n.personId === '@I5@')!.moreAbove).toBe(true);
    expect(chart.nodes.find((n) => n.personId === MIGUEL)!.moreBelow).toBe(true);
  });

  it('returns an empty chart for an unknown person', () => {
    expect(layoutChart(idx, 'nobody', 3, 3).nodes).toEqual([]);
  });
});
