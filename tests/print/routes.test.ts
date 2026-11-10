import { describe, expect, it } from 'vitest';
import { buildPrintData } from '../../src/print/data';
import { inset, makeProjection } from '../../src/print/geo';
import { arrowAtEnd, projectRoutes, ribbon, routeWidth, wobble, yearsLabel } from '../../src/print/routes';
import type { Box, Pt } from '../../src/print/types';
import { sampleTree } from './fixtures';

const { tree, gens, located } = sampleTree();
const data = buildPrintData(tree, located, gens, { branch: 'all' });
const frame: Box = { x: 18, y: 18, w: 558, h: 384 };
const opts = { radius: 5, minWidth: 0.5, maxWidth: 2.5, endGap: 1.6, arrowSize: 3, wobble: 0, dateOffset: 2 };
const years = new Map(data.people.map((p) => [p.id, p.birthYear]));

describe('projectRoutes', () => {
  const projection = makeProjection('family', data.people, frame);
  const project = (p: { lat: number; lon: number }): Pt => projection([p.lon, p.lat]) as Pt;
  const { strokes, dates, bundles } = projectRoutes(data.flows, project, opts, (id) => years.get(id));

  it('turns the sample moves into strokes inside the frame', () => {
    expect(data.flows.length).toBeGreaterThan(5);
    expect(strokes.length).toBeGreaterThanOrEqual(bundles.length);
    const loose = inset(frame, -1);
    for (const s of strokes)
      for (const [x, y] of s.pts) {
        expect(x).toBeGreaterThan(loose.x);
        expect(x).toBeLessThan(loose.x + loose.w);
        expect(y).toBeGreaterThan(loose.y);
        expect(y).toBeLessThan(loose.y + loose.h);
      }
  });

  it('starts each route at its origin and ends just short of the destination with an arrow', () => {
    const near = (a: Pt, b: Pt, d: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;
    let checked = 0;
    for (const b of bundles) {
      if (b.origins.length !== 1 || b.dests.length !== 1) continue;
      const [o, d] = [b.origins[0].pt, b.dests[0].pt];
      const s = strokes.find((x) => x.kind === 'out' && near(x.pts[0], o, 1e-6) && near(x.pts[x.pts.length - 1], d, opts.endGap * 1.5));
      expect(s, `route ${o} → ${d}`).toBeDefined();
      expect(s!.fromOrigin).toBe(true);
      const end = s!.pts[s!.pts.length - 1];
      expect(near(end, d, opts.endGap * 0.5)).toBe(false);
      expect(s!.arrow![0]).toEqual(end);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('keeps widths between the style limits', () => {
    for (const s of strokes) {
      expect(s.width).toBeGreaterThanOrEqual(opts.minWidth);
      expect(s.width).toBeLessThanOrEqual(opts.maxWidth);
    }
  });

  it('dates routes by the births of the children they lead to', () => {
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      expect(d.text).toMatch(/^\d{4}(–\d{4})?$/);
      expect(Math.abs(d.angle)).toBeLessThanOrEqual(90);
    }
  });

  it('drops moves whose ends are off the map', () => {
    const north = (p: { lat: number }) => p.lat > 0;
    const only = projectRoutes(data.flows, (p) => (north(p) ? project(p) : null), opts, () => undefined);
    const kept = only.bundles.flatMap((b) => b.origins.flatMap((e) => e.flows));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(data.flows.length);
    for (const f of kept) expect(north(f.from) && north(f.to)).toBe(true);
  });
});

describe('stroke geometry', () => {
  it('sizes routes by the number of people on them', () => {
    expect(routeWidth(1, 1, 0.5, 2)).toBe(0.5);
    expect(routeWidth(1, 10, 0.5, 2)).toBe(0.5);
    expect(routeWidth(10, 10, 0.5, 2)).toBe(2);
    expect(routeWidth(4, 10, 0.5, 2)).toBeGreaterThan(routeWidth(3, 10, 0.5, 2));
  });

  it('wobbles a line without moving its ends', () => {
    const line: Pt[] = Array.from({ length: 20 }, (_, i) => [i, 0]);
    const w = wobble(line, 0.3, 1);
    expect(w[0]).toEqual(line[0]);
    expect(w[19]).toEqual(line[19]);
    expect(w.some((p) => Math.abs(p[1]) > 0.05)).toBe(true);
    expect(w.every((p) => Math.abs(p[1]) <= 0.3)).toBe(true);
    expect(wobble(line, 0, 1)).toBe(line);
  });

  it('outlines a stroke with the requested width', () => {
    const poly = ribbon([[0, 0], [10, 0], [20, 0]], (t) => 1 + t);
    expect(poly).toHaveLength(6);
    expect(poly[0][1] - poly[5][1]).toBeCloseTo(1); // width 1 at the start
    expect(poly[2][1] - poly[3][1]).toBeCloseTo(2); // width 2 at the end
  });

  it('points arrowheads along the end of the line', () => {
    const [tip, a, b] = arrowAtEnd([[0, 0], [10, 0]], 2);
    expect(tip).toEqual([10, 0]);
    expect(a[0]).toBeLessThan(10);
    expect(b[0]).toBeLessThan(10);
    expect(a[1]).toBeCloseTo(-b[1]);
  });

  it('writes year spans', () => {
    expect(yearsLabel([])).toBe('');
    expect(yearsLabel([1901])).toBe('1901');
    expect(yearsLabel([1910, 1901, 1905])).toBe('1901–1910');
  });
});
