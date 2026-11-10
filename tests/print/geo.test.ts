import { geoMercator } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import {
  AREAS,
  bboxOutline,
  degreeLabel,
  familyBBox,
  frameTicks,
  inset,
  kmPerMm,
  makeProjection,
  mmToPx,
  niceScaleKm,
  pageSize,
  sizeScale,
  topologyDetail,
} from '../../src/print/geo';
import type { AreaId, Box } from '../../src/print/types';

const frame: Box = { x: 18, y: 18, w: 558, h: 384 };
const inside = (p: [number, number] | null, b: Box, tol = 0.01) =>
  !!p && p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol;

const family = [
  { lat: 41.15, lon: -8.63 }, // Porto
  { lat: -23.55, lon: -46.63 }, // São Paulo
  { lat: 51.9, lon: -8.48 }, // Cork
  { lat: 42.36, lon: -71.06 }, // Boston
  { lat: -8.84, lon: 13.29 }, // Luanda
];

describe('paper', () => {
  it('gives A-series sizes in mm for both orientations', () => {
    expect(pageSize('A2', 'landscape')).toEqual({ w: 594, h: 420 });
    expect(pageSize('A2', 'portrait')).toEqual({ w: 420, h: 594 });
    expect(pageSize('A3', 'portrait')).toEqual({ w: 297, h: 420 });
    expect(pageSize('A1', 'landscape')).toEqual({ w: 841, h: 594 });
  });

  it('scales designs from A2', () => {
    expect(sizeScale('A2')).toBe(1);
    expect(sizeScale('A1')).toBeCloseTo(594 / 420);
    expect(sizeScale('A3')).toBeCloseTo(297 / 420);
  });

  it('converts mm to pixels at 300 dpi (A2 ≈ 7016 × 4961)', () => {
    expect(mmToPx(594, 300)).toBe(7016);
    expect(mmToPx(420, 300)).toBe(4961);
  });
});

describe('makeProjection', () => {
  it('fits every family place inside the frame, with room around them', () => {
    const p = makeProjection('family', family, frame);
    const fit = inset(frame, Math.min(frame.w, frame.h) * 0.11);
    for (const f of family) expect(inside(p([f.lon, f.lat]), fit)).toBe(true);
    // And it uses the space: the places reach close to the padded box in at least one direction.
    const xs = family.map((f) => p([f.lon, f.lat])![0]);
    const ys = family.map((f) => p([f.lon, f.lat])![1]);
    expect(Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * (fit.w / fit.h))).toBeGreaterThan(fit.w * 0.8);
  });

  it('keeps a single town from filling the map', () => {
    const p = makeProjection('family', [{ lat: 41.15, lon: -8.63 }], frame);
    // 6° of longitude around Porto takes no more than the frame's width.
    const a = p([-11.63, 41.15])!;
    const b = p([-5.63, 41.15])!;
    expect(b[0] - a[0]).toBeLessThanOrEqual(frame.w);
    expect(b[0] - a[0]).toBeGreaterThan(frame.w * 0.3);
  });

  for (const area of Object.keys(AREAS) as AreaId[]) {
    it(`shows the whole ${area} box inside the frame`, () => {
      const p = makeProjection(area, [], frame);
      for (const pt of bboxOutline(AREAS[area as keyof typeof AREAS], 5)) expect(inside(p(pt), frame, 0.5)).toBe(true);
    });
  }

  it('fits the whole globe for the world map and sets a clip extent', () => {
    const p = makeProjection('world', family, frame);
    for (const pt of [[-180, 0], [180, 0], [0, 90], [0, -90]] as [number, number][]) expect(inside(p(pt), frame, 0.5)).toBe(true);
    expect(p.clipExtent()).toEqual([[frame.x, frame.y], [frame.x + frame.w, frame.y + frame.h]]);
  });

  it('uses Mercator when the style asks for it', () => {
    const p = makeProjection('atlantic', [], frame, 'mercator');
    // On Mercator, meridians are vertical.
    expect(p([-30, -20])![0]).toBeCloseTo(p([-30, 50])![0], 6);
  });

  it('falls back to the world when the family has no places', () => {
    expect(familyBBox([])).toBeNull();
    const p = makeProjection('family', [], frame);
    expect(inside(p([179, 0]), frame, 0.5)).toBe(true);
  });
});

describe('measuring', () => {
  it('measures km per mm, smaller towards the poles on Mercator', () => {
    const p = geoMercator().scale(100).translate([0, 0]);
    const atEquator = kmPerMm(p, p([0, 0]) as [number, number]);
    const at60 = kmPerMm(p, p([0, 60]) as [number, number]);
    expect(at60 / atEquator).toBeCloseTo(0.5, 2);
  });

  it('rounds scale bars to 1, 2, 2.5 or 5 × 10ⁿ km', () => {
    expect(niceScaleKm(14, 70)).toBe(1000);
    expect(niceScaleKm(30, 70)).toBe(2000);
    expect(niceScaleKm(3.3, 70)).toBe(250);
    expect(niceScaleKm(0.5, 60)).toBe(25);
  });

  it('finds where meridians and parallels meet the frame', () => {
    const p = makeProjection('atlantic', [], frame, 'mercator');
    const ticks = frameTicks(p, frame, 10);
    const top = ticks.filter((t) => t.side === 'top');
    const left = ticks.filter((t) => t.side === 'left');
    expect(top.length).toBeGreaterThan(5);
    expect(left.length).toBeGreaterThan(3);
    for (const t of top) {
      expect(Math.abs(t.deg % 10)).toBe(0);
      expect(p([t.deg, 0])![0]).toBeCloseTo(t.pos, 1); // a vertical meridian meets the top where it is
    }
    // Evenly spaced on Mercator.
    const gaps = top.slice(1).map((t, i) => t.pos - top[i].pos);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 1);
  });

  it('labels degrees in each language', () => {
    expect(degreeLabel(-20, 'lon', 'pt')).toBe('20°O');
    expect(degreeLabel(-20, 'lon', 'en')).toBe('20°W');
    expect(degreeLabel(30, 'lon', 'pt')).toBe('30°L');
    expect(degreeLabel(-40, 'lat', 'en')).toBe('40°S');
    expect(degreeLabel(0, 'lat', 'en')).toBe('0°');
  });

  it('picks finer coastlines for zoomed-in maps', () => {
    expect(topologyDetail(30)).toBe('50m');
    expect(topologyDetail(3)).toBe('10m');
  });
});
