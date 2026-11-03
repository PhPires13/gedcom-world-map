import { describe, expect, it } from 'vitest';
import { NEIGHBOUR_WEIGHT, densityLevel, hexCorners, hexDensity, hexOf } from '../src/hexbin';

const R = 10;
const own = (hexes: ReturnType<typeof hexDensity>) => hexes.filter((h) => h.people.size);

describe('hexDensity', () => {
  it('puts a person in their own hexagon and spreads a little to the six around it', () => {
    const hexes = hexDensity([{ x: 0, y: 0, gen: 2 }], R);
    expect(hexes).toHaveLength(7);
    const [centre] = own(hexes);
    expect(centre.weight).toBe(1);
    expect(centre.people.get(2)).toBe(1);
    for (const h of hexes.filter((h) => h !== centre)) {
      expect(h.weight).toBeCloseTo(NEIGHBOUR_WEIGHT);
      expect(h.people.size).toBe(0);
      expect(h.mainGen).toBe(2);
    }
  });

  it('adds up nearby people and colours by the main generation', () => {
    const hexes = hexDensity(
      [
        { x: 0, y: 0, gen: 3 },
        { x: 1, y: 1, gen: 3 },
        { x: -1, y: 0, gen: 0 },
      ],
      R,
    );
    const [centre] = own(hexes);
    expect(centre.weight).toBe(3);
    expect(centre.mainGen).toBe(3);
    expect(centre.people.get(0)).toBe(1);
  });

  it('gives ties to the most recent generation', () => {
    const [centre] = own(hexDensity([{ x: 0, y: 0, gen: 4 }, { x: 0, y: 1, gen: 1 }], R));
    expect(centre.mainGen).toBe(1);
  });

  it('can turn the spreading off', () => {
    expect(hexDensity([{ x: 0, y: 0, gen: 0 }], R, 0)).toHaveLength(1);
  });
});

describe('hexOf', () => {
  it('assigns every point to the hexagon whose centre is nearest', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 200 - 100;
    for (let i = 0; i < 300; i++) {
      const x = rand();
      const y = rand();
      const [q, s] = hexOf(x, y, R);
      const d = Math.hypot(x - R * Math.sqrt(3) * (q + s / 2), y - R * 1.5 * s);
      expect(d).toBeLessThanOrEqual(R + 1e-9);
      for (let a = -12; a <= 12; a++)
        for (let b = -12; b <= 12; b++)
          expect(d).toBeLessThanOrEqual(Math.hypot(x - R * Math.sqrt(3) * (a + b / 2), y - R * 1.5 * b) + 1e-9);
    }
  });
});

describe('hexCorners', () => {
  it('returns six corners at radius r around the centre', () => {
    const corners = hexCorners(5, -5, R);
    expect(corners).toHaveLength(6);
    for (const [x, y] of corners) expect(Math.hypot(x - 5, y + 5)).toBeCloseTo(R);
  });
});

describe('densityLevel', () => {
  it('puts weights into four discrete levels', () => {
    expect(densityLevel(NEIGHBOUR_WEIGHT)).toBe(0);
    expect(densityLevel(1)).toBe(1);
    expect(densityLevel(1.4)).toBe(1);
    expect(densityLevel(3)).toBe(2);
    expect(densityLevel(40)).toBe(3);
  });
});
