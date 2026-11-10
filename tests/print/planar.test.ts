import { geoEquirectangular } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import { clipRing, pointInRings, projectRings, ringArea, ringCentroid, ringsBounds, ringsPath, scaleAbout } from '../../src/print/planar';
import type { Pt } from '../../src/print/types';

const square = (x: number, y: number, s: number): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

describe('planar geometry', () => {
  it('measures area and centre of a ring', () => {
    expect(Math.abs(ringArea(square(0, 0, 10)))).toBe(100);
    expect(ringCentroid(square(0, 0, 10))).toEqual([5, 5]);
    expect(ringsBounds([square(2, 3, 4)])).toEqual({ x: 2, y: 3, w: 4, h: 4 });
  });

  it('tells inside from outside, holes included', () => {
    const outer = square(0, 0, 10);
    const hole = square(4, 4, 2);
    expect(pointInRings([1, 1], [outer, hole])).toBe(true);
    expect(pointInRings([5, 5], [outer, hole])).toBe(false);
    expect(pointInRings([11, 5], [outer, hole])).toBe(false);
  });

  it('clips rings to a box', () => {
    const clipped = clipRing(square(0, 0, 10), { x: 5, y: 5, w: 10, h: 10 });
    const b = ringsBounds([clipped]);
    expect(b).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(clipRing(square(0, 0, 1), { x: 5, y: 5, w: 1, h: 1 })).toEqual([]);
  });

  it('writes path data, skipping rings outside the clip box', () => {
    const d = ringsPath([square(0, 0, 10), square(100, 100, 5)], scaleAbout([0, 0], 2), { x: -1, y: -1, w: 50, h: 50 });
    expect(d).toBe('M0,0L20,0L20,20L0,20Z');
  });

  it('projects geometry through d3 into rings', () => {
    const p = geoEquirectangular().scale(1).translate([0, 0]);
    const rings = projectRings({ type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] }, p);
    expect(rings).toHaveLength(1);
    const b = ringsBounds(rings);
    expect(b.w).toBeCloseTo((10 * Math.PI) / 180, 3);
  });
});
