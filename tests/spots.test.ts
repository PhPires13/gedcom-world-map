import { describe, expect, it } from 'vitest';
import { DOT, MAX_SPAN, SPREAD_FROM_ZOOM, layoutSpot, spreadBox, spreadScale } from '../src/spots';

const gens: Record<string, number> = { a: 0, b: 0, c: 2, d: 1 };
const years: Record<string, number> = { a: 1990, b: 1985, c: 1920, d: 1950 };
const layout = (ids: string[]) =>
  layoutSpot(
    ids,
    (id) => gens[id] ?? 0,
    (id) => years[id],
  );

describe('layoutSpot', () => {
  it('puts one generation per row, oldest at the top', () => {
    const { dots } = layout(['a', 'b', 'c', 'd']);
    const rowOf = (id: string) => dots.find((d) => d.id === id)!.dy;
    expect(rowOf('c')).toBeLessThan(rowOf('d'));
    expect(rowOf('d')).toBeLessThan(rowOf('a'));
    expect(rowOf('a')).toBe(rowOf('b'));
  });

  it('orders a row by birth year and centres it on the location', () => {
    const { dots } = layout(['a', 'b', 'c', 'd']);
    const a = dots.find((d) => d.id === 'a')!;
    const b = dots.find((d) => d.id === 'b')!;
    expect(b.dx).toBeLessThan(a.dx); // born earlier → further left
    expect(a.dx + b.dx).toBeCloseTo(0); // row centred horizontally
    const c = dots.find((d) => d.id === 'c')!;
    expect(c.dx).toBeCloseTo(0); // a lone row member sits on the centre line
    // Rows are centred vertically around the location too.
    const ys = dots.map((d) => d.dy);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0);
  });

  it('wraps long generations onto extra rows', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const { dots, height } = layout(ids);
    expect(new Set(dots.map((d) => d.dy)).size).toBe(2);
    expect(height).toBeGreaterThan(DOT);
  });

  it('keeps a minimum spread when zoomed out and grows with the map when zoomed in', () => {
    expect(spreadScale(3)).toBe(1);
    expect(spreadScale(SPREAD_FROM_ZOOM)).toBe(1);
    expect(spreadScale(SPREAD_FROM_ZOOM + 2)).toBe(4);
    const l = layout(['a', 'b', 'c', 'd']);
    expect(spreadBox(l, 1)).toEqual({ halfW: l.width / 2, halfH: l.height / 2 });
    // Spread grows, dots don't: the box grows by the scaled centre offsets only.
    expect(spreadBox(l, 2).halfH).toBeCloseTo(l.height - DOT / 2);
  });

  it('packs big groups tighter when zoomed out, then grows smoothly from there', () => {
    // Seven generations born in one town: one tall column of dots.
    const ids = Array.from({ length: 7 }, (_, i) => `g${i}`);
    const tall = layoutSpot(
      ids,
      (id) => Number(id.slice(1)),
      () => undefined,
    );
    expect(tall.minScale).toBeLessThan(1);

    const zoomedOut = spreadScale(4, tall.minScale);
    const { halfH } = spreadBox(tall, zoomedOut);
    const span = (halfH - DOT / 2) * 2;
    // Within MAX_SPAN, without dots overlapping.
    expect(span).toBeLessThanOrEqual(MAX_SPAN + 1e-9);
    const ys = tall.dots.map((d) => d.dy * zoomedOut).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(DOT - 1e-9);

    // Never shrinks while zooming in.
    let prev = 0;
    for (let z = 2; z <= 18; z++) {
      const sc = spreadScale(z, tall.minScale);
      expect(sc).toBeGreaterThanOrEqual(prev);
      prev = sc;
    }
    // Small groups are unaffected.
    expect(layout(['a', 'b', 'c', 'd']).minScale).toBe(1);
  });
});
