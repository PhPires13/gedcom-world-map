import { describe, expect, it } from 'vitest';
import { BORDERS, FINISHES, LAYOUTS, layoutById } from '../../src/print/catalog';
import { CountryLocator } from '../../src/print/countries';
import { buildPrintData } from '../../src/print/data';
import { buildStorybook, clusterPlaces, fitBox, planVignette, plateOf, relaxCircles, validateLayout } from '../../src/print/layouts';
import { STYLES } from '../../src/print/styles';
import type { Box, Pt } from '../../src/print/types';
import { sampleTree, topology } from './fixtures';

const locator = new CountryLocator(topology);
const { tree, gens, located } = sampleTree();
const data = buildPrintData(tree, located, gens, { branch: 'all' });
const frame: Box = { x: 18, y: 18, w: 558, h: 384 };
const ctx = { style: STYLES[0], k: 1, lang: 'pt' as const, frame };
const inBox = (p: Pt, b: Box) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;

describe('layout specs', () => {
  it('ships the four layouts, all valid', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(['accurate', 'closeup', 'storybook', 'vignette']);
    for (const l of LAYOUTS) expect(validateLayout(l), l.id).toEqual([]);
    expect(BORDERS.length).toBeGreaterThanOrEqual(5);
    expect(FINISHES.length).toBeGreaterThanOrEqual(4);
  });

  it('reports a broken layout', () => {
    expect(validateLayout({ id: 'x', name: 'X', kind: 'storybook', storybook: { targetShare: 2 } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^storybook.targetShare/), expect.stringMatching(/^storybook.maxScale/)]),
    );
    expect(validateLayout({ id: 'x', name: 'X', kind: 'globe' })[0]).toMatch(/^kind/);
  });
});

describe('helpers', () => {
  it('tells the land masses apart', () => {
    expect(plateOf(-46, -23)).toBe('americas');
    expect(plateOf(-8, 41)).toBe('afroeurasia');
    expect(plateOf(-17, 32.6)).toBe('afroeurasia'); // Madeira stays with Portugal
    expect(plateOf(-28, 38.6)).toBe('afroeurasia'); // so do the Azores
    expect(plateOf(150, -30)).toBe('oceania');
    expect(plateOf(0, -75)).toBe('antarctica');
  });

  it('fits a box into another, centred', () => {
    const t = fitBox({ x: 0, y: 0, w: 10, h: 5 }, { x: 100, y: 100, w: 40, h: 40 });
    expect(t([0, 0])).toEqual([100, 110]);
    expect(t([10, 5])).toEqual([140, 130]);
  });

  it('pushes circles apart, inside a box and out of keep-out areas', () => {
    const within: Box = { x: 0, y: 0, w: 200, h: 200 };
    const keepOut: Box[] = [{ x: 0, y: 0, w: 60, h: 60 }];
    const circles = [
      { c: [100, 100] as Pt, r: 30, w: 1 },
      { c: [110, 100] as Pt, r: 30, w: 1 },
      { c: [20, 20] as Pt, r: 20, w: 1 },
    ];
    const pos = relaxCircles(circles, { gap: 5, within, keepOut });
    expect(Math.hypot(pos[0][0] - pos[1][0], pos[0][1] - pos[1][1])).toBeGreaterThanOrEqual(64.9);
    for (const [i, p] of pos.entries()) {
      expect(inBox(p, { x: circles[i].r, y: circles[i].r, w: 200 - 2 * circles[i].r, h: 200 - 2 * circles[i].r })).toBe(true);
    }
    // The third one left the keep-out square.
    const q = pos[2];
    const dx = Math.max(0, q[0] - 60);
    const dy = Math.max(0, q[1] - 60);
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(20);
  });
});

describe('storybook layout', () => {
  const spec = { ...layoutById('storybook')!.storybook!, padding: 0.05 };
  const art = buildStorybook(data.people, locator, spec, ctx);

  it('puts every place inside the frame', () => {
    for (const p of data.people) expect(inBox(art.place(p)!, frame), p.place).toBe(true);
  });

  it('keeps places inside their (enlarged) country', () => {
    let checked = 0;
    for (const p of data.people) {
      const code = locator.locate(p);
      // Places inside their country's main landmass on the real map (not coastal towns or islands).
      if (locator.codeAt(p.lon, p.lat) !== code || p.place.includes('Madeira')) continue;
      const label = art.countryLabel(code);
      if (!label) continue;
      expect(label.inside(art.place(p)!), p.place).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('enlarges small homelands: Portugal is drawn bigger than on the true map', () => {
    const lisbon = data.people.find((p) => p.place.startsWith('Lisboa'))!;
    const braga = data.people.find((p) => p.place.startsWith('Braga'))!;
    const saoPaulo = data.people.find((p) => p.place.startsWith('São Paulo'))!;
    const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Relative to the distance to Brazil, Lisbon–Braga is longer than in reality.
    const ratio = d(art.place(lisbon)!, art.place(braga)!) / d(art.place(lisbon)!, art.place(saoPaulo)!);
    expect(ratio).toBeGreaterThan(330 / 7900);
  });

  it('keeps an island near its mainland rather than out at sea', () => {
    const funchal = data.people.find((p) => p.place.startsWith('Funchal'))!;
    const lisbon = data.people.find((p) => p.place.startsWith('Lisboa'))!;
    const saoPaulo = data.people.find((p) => p.place.startsWith('São Paulo'))!;
    const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(art.place(funchal)!, art.place(lisbon)!)).toBeLessThan(d(art.place(funchal)!, art.place(saoPaulo)!) / 2);
  });
});

describe('medallion layout', () => {
  const spec = { ...layoutById('vignette')!.vignette!, padding: 0.04 };
  const keepOut: Box[] = [{ x: 18, y: 300, w: 150, h: 102 }];
  const plan = planVignette(data.people, locator, spec, ctx);
  const art = plan.settle(keepOut);

  it('groups places by country, an island group on its own', () => {
    const names = plan.clusters.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Portugal', 'Madeira', 'Brasil', 'Irlanda']));
  });

  it('merges groups so there are never too many medallions', () => {
    const many = clusterPlaces(data.people, (p) => locator.locate(p), 50, 'pt', 6, 1);
    expect(many.length).toBeLessThanOrEqual(8); // one per country at most, 8 countries
    const codes = many.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('lays medallions out apart, inside the frame and clear of the panels', () => {
    const ms = art.medallions;
    expect(ms.length).toBe(plan.clusters.length);
    for (const [i, a] of ms.entries()) {
      expect(a.center[0] - a.r).toBeGreaterThanOrEqual(frame.x);
      expect(a.center[0] + a.r).toBeLessThanOrEqual(frame.x + frame.w);
      for (const b of ms.slice(i + 1)) expect(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1])).toBeGreaterThan(a.r + b.r);
      for (const k of keepOut) {
        const q: Pt = [Math.max(k.x, Math.min(a.center[0], k.x + k.w)), Math.max(k.y, Math.min(a.center[1], k.y + k.h))];
        expect(Math.hypot(a.center[0] - q[0], a.center[1] - q[1])).toBeGreaterThanOrEqual(a.r);
      }
    }
  });

  it('puts each place inside its medallion', () => {
    for (const c of plan.clusters) {
      const m = art.medallions.find((x) => x.name === c.name)!;
      for (const p of c.places) {
        const q = art.place(p)!;
        expect(Math.hypot(q[0] - m.center[0], q[1] - m.center[1]), p.place).toBeLessThanOrEqual(m.r * spec.fill + 1e-6);
      }
    }
  });
});
