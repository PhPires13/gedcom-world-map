import { describe, expect, it } from 'vitest';
import { CountryLocator } from '../../src/print/countries';
import { buildHomelands } from '../../src/print/homelands';
import { LAYOUTS } from '../../src/print/catalog';
import { STYLES } from '../../src/print/styles';
import type { GeoPlace } from '../../src/print/layouts';
import type { Box } from '../../src/print/types';
import { topology } from './fixtures';

const locator = new CountryLocator(topology);
const frame: Box = { x: 20, y: 20, w: 554, h: 380 };
const spec = { ...LAYOUTS.find((l) => l.id === 'homelands')!.homelands!, padding: 0.04 };
const ctx = { style: STYLES[0], k: 1, lang: 'pt' as const, frame };

const cork: GeoPlace = { lat: 51.8985, lon: -8.4756 };
const braga: GeoPlace = { lat: 41.5454, lon: -8.4265 };
const funchal: GeoPlace = { lat: 32.6669, lon: -16.9241 };
const rio: GeoPlace = { lat: -22.9068, lon: -43.1729 };
const benguela: GeoPlace = { lat: -12.5763, lon: 13.4055 };
const people = [cork, braga, funchal, rio, benguela];

describe('family countries layout', () => {
  const art = buildHomelands(people, locator, spec, ctx);
  const at = (p: GeoPlace) => art.place(p)!;

  it('puts every place on the sheet, inside the frame', () => {
    for (const p of people) {
      const q = at(p);
      expect(q).toBeTruthy();
      expect(q[0]).toBeGreaterThanOrEqual(frame.x);
      expect(q[0]).toBeLessThanOrEqual(frame.x + frame.w);
      expect(q[1]).toBeGreaterThanOrEqual(frame.y);
      expect(q[1]).toBeLessThanOrEqual(frame.y + frame.h);
    }
  });

  it('keeps the countries where they lie in relation to each other', () => {
    expect(at(cork)[1]).toBeLessThan(at(braga)[1]); // Ireland north of Portugal
    expect(at(braga)[1]).toBeLessThan(at(rio)[1]); // Portugal north of Brazil
    expect(at(rio)[0]).toBeLessThan(at(benguela)[0]); // Brazil west of Angola
    expect(at(braga)[1]).toBeLessThan(at(benguela)[1]); // Portugal north of Angola
  });

  it('draws the countries large: Portugal far larger than its true size next to Brazil', () => {
    const pt = art.countryLabel('pt')!;
    const br = art.countryLabel('br')!;
    expect(pt && br).toBeTruthy();
    // Brazil is about 90 times Portugal's area; drawn sizes are compressed far more than that.
    let ptArea = 0;
    let brArea = 0;
    for (let x = frame.x; x < frame.x + frame.w; x += 2)
      for (let y = frame.y; y < frame.y + frame.h; y += 2) {
        if (pt.inside([x, y])) ptArea++;
        if (br.inside([x, y])) brArea++;
      }
    expect(ptArea).toBeGreaterThan(0);
    expect(ptArea / brArea).toBeGreaterThan(1 / 16);
    // And the countries fill the sheet rather than sitting in a corner.
    expect(brArea * 4).toBeGreaterThan((frame.w * frame.h) / 10);
  });

  it('never draws one country on top of another', () => {
    for (const p of people) {
      const own = locator.locate(p);
      for (const code of ['ie', 'pt', 'br', 'ao']) {
        if (code === own) continue;
        expect(art.countryLabel(code)!.inside(at(p)), `${own} place inside ${code}`).toBe(false);
      }
    }
  });

  it('brings Madeira in next to Portugal with its towns on it', () => {
    const pt = art.countryLabel('pt')!;
    expect(pt.inside(at(funchal)) || art.isLand(at(funchal))).toBe(true);
    // Nearer Portugal's middle than Brazil's (not out in the ocean where it really is).
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(at(funchal), pt.at)).toBeLessThan(d(at(funchal), art.countryLabel('br')!.at));
  });

  it('places each flag inside its own country', () => {
    const spot = art.flagSpot!('br', 8);
    expect(spot).toBeTruthy();
    expect(art.countryLabel('br')!.inside(spot!)).toBe(true);
  });
});
