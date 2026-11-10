import { describe, expect, it } from 'vitest';
import { arcPoints } from '../../src/flows';
import { offsetLine, pathLength, placeAlongCurve, pointAt, routeSurnames, smoothPath } from '../../src/print/curvelabel';
import { distToPolyline } from '../../src/print/layout';
import type { Pt } from '../../src/print/types';

const never = () => false;

describe('lettering along routes', () => {
  it('offsets a line to its left', () => {
    expect(offsetLine([[0, 0], [10, 0]], 2)).toEqual([[0, -2], [10, -2]]);
    expect(pathLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(pointAt([[0, 0], [10, 0]], 4).p).toEqual([4, 0]);
  });

  for (const [name, from, to] of [
    ['eastwards', [0, 100], [200, 100]],
    ['westwards', [200, 100], [0, 100]],
    ['north-east', [0, 200], [150, 20]],
    ['south-west', [150, 20], [0, 200]],
  ] as [string, Pt, Pt][]) {
    it(`reads left to right on the outside of the curve, clear of the stroke (${name})`, () => {
      const route = arcPoints(from, to, 0.15);
      const half = 1.5;
      const h = 5;
      const spot = placeAlongCurve(route, 60, h, half, 1, never)!;
      expect(spot).not.toBeNull();
      // Reading direction: the baseline runs left to right.
      expect(spot.baseline[spot.baseline.length - 1][0]).toBeGreaterThan(spot.baseline[0][0]);
      // The lettering stays off the route itself.
      for (const b of spot.boxes) expect(distToPolyline([b.x + b.w / 2, b.y + b.h / 2], route)).toBeGreaterThan(half);
      // And it's on the outside of the bend: away from the straight line between the ends.
      const mid = route[Math.floor(route.length / 2)];
      const chordMid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const out: Pt = [mid[0] - chordMid[0], mid[1] - chordMid[1]];
      const box = spot.boxes[Math.floor(spot.boxes.length / 2)];
      const c: Pt = [box.x + box.w / 2 - mid[0], box.y + box.h / 2 - mid[1]];
      expect(c[0] * out[0] + c[1] * out[1]).toBeGreaterThan(0);
    });
  }

  it('gives up when the text is longer than the route, or every spot is taken', () => {
    const route = arcPoints([0, 0], [50, 0], 0.1);
    expect(placeAlongCurve(route, 80, 5, 1, 1, never)).toBeNull();
    expect(placeAlongCurve(route, 20, 5, 1, 1, () => true)).toBeNull();
  });

  it('slides along the route to get clear of something in the middle', () => {
    const route = arcPoints([0, 100], [300, 100], 0.1);
    const middle = { x: 140, y: 0, w: 20, h: 200 };
    const spot = placeAlongCurve(route, 40, 5, 1, 1, (b) => b.x < middle.x + middle.w && middle.x < b.x + b.w)!;
    expect(spot.at).not.toBe(0.5);
  });

  it('writes a smooth path through the points', () => {
    expect(smoothPath([[0, 0], [10, 0], [20, 5]])).toMatch(/^M0,0C.*C.* 20,5$/);
  });

  it('names a route by the surnames of those who moved, the family name of compound ones', () => {
    expect(routeSurnames(['Almeida Costa', 'Costa', 'Ferreira'])).toEqual(['Costa']);
    expect(routeSurnames(['Silva', 'Santos', 'Silva', 'Santos', 'Gomes'])).toEqual(['Silva', 'Santos']);
    // A tie goes to the first listed (the caller lists fathers first).
    expect(routeSurnames(['Costa', 'Ferreira'])).toEqual(['Costa']);
    expect(routeSurnames(['Silva', 'Silva', 'Silva', 'Gomes'])).toEqual(['Silva']);
    expect(routeSurnames(['', ' '])).toEqual([]);
  });
});
