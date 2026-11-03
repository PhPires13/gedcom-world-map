import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGedcom } from '../src/gedcom';
import { computeGenerations } from '../src/generations';
import {
  arcPoints,
  arrowHead,
  bundleFlows,
  bundleGeometry,
  computeFlows,
  cutPath,
  distanceKm,
  laneBend,
  trimEnd,
  type Place,
} from '../src/flows';

const BRAGA = { lat: 41.5454, lon: -8.4265 };
const PORTO = { lat: 41.1579, lon: -8.6291 };
const LISBOA = { lat: 38.7223, lon: -9.1393 };

const tree = (rels: Record<string, string[]>) =>
  new Map(Object.entries(rels).map(([id, parents]) => [id, { parents }]));

describe('computeFlows', () => {
  it("draws each parent's move from their birthplace to where they had the child, skipping moves within a town", () => {
    const people = tree({ dad: [], mum: [], kid: ['dad', 'mum'], local: ['dad'] });
    const located = new Map<string, Place>([
      ['dad', BRAGA],
      ['mum', LISBOA],
      ['kid', PORTO],
      ['local', { lat: BRAGA.lat + 0.001, lon: BRAGA.lon }], // ~100 m away: same town
    ]);
    const gens = new Map([
      ['dad', 1],
      ['mum', 1],
      ['kid', 0],
      ['local', 0],
    ]);
    const flows = computeFlows(people, located, gens, () => true);
    expect(flows).toHaveLength(2);
    // The move belongs to the parent (their generation), dated by the child's generation.
    expect(flows.every((f) => f.to === PORTO && f.gen === 1 && f.step === 0)).toBe(true);
    expect(flows.map((f) => f.from).sort((a, b) => a.lat - b.lat)).toEqual([LISBOA, BRAGA]);
    const fromLisboa = flows.find((f) => f.from === LISBOA)!;
    expect(fromLisboa.parents).toEqual(['mum']);
    expect(fromLisboa.children).toEqual(['kid']);
  });

  it('puts both parents on one move when they came from the same place, with all their children there', () => {
    const people = tree({ dad: [], mum: [], kid: ['dad', 'mum'], kid2: ['dad', 'mum'] });
    const located = new Map<string, Place>([
      ['dad', BRAGA],
      ['mum', BRAGA],
      ['kid', PORTO],
      ['kid2', PORTO],
    ]);
    const gens = new Map([
      ['dad', 1],
      ['mum', 1],
      ['kid', 0],
      ['kid2', 0],
    ]);
    const [flow, ...rest] = computeFlows(people, located, gens, () => true);
    expect(rest).toHaveLength(0);
    expect(flow.parents).toEqual(['dad', 'mum']);
    expect(flow.children).toEqual(['kid', 'kid2']);
  });

  it('keeps generations on the same route apart in lanes, and respects hidden generations', () => {
    const people = tree({ a: [], b: ['a'], c: [], d: ['c'] });
    const located = new Map<string, Place>([
      ['a', BRAGA],
      ['b', PORTO],
      ['c', BRAGA],
      ['d', PORTO],
    ]);
    const gens = new Map([
      ['a', 3],
      ['b', 2],
      ['c', 1],
      ['d', 0],
    ]);
    const flows = computeFlows(people, located, gens, () => true);
    // Lanes go by the movers' generations (a = 3, c = 1).
    expect(flows.map((f) => [f.gen, f.lane]).sort()).toEqual([
      [1, 0],
      [3, 1],
    ]);
    // The filter gets the mover's and the child's generation.
    expect(computeFlows(people, located, gens, (moverGen) => moverGen !== 1).map((f) => f.gen)).toEqual([3]);
    expect(computeFlows(people, located, gens, (_m, childGen) => childGen >= 2).map((f) => f.step)).toEqual([2]);
  });

  it('finds the moves in the sample tree', () => {
    const t = parseGedcom(readFileSync(new URL('../public/sample.ged', import.meta.url), 'utf8'));
    const gens = computeGenerations(t);
    const located = new Map<string, Place>();
    for (const p of t.people.values()) {
      const ev = p.birth;
      if (ev?.lat !== undefined && ev.lon !== undefined) located.set(p.id, { lat: ev.lat, lon: ev.lon });
    }
    // Without geocoding, only places with coordinates in the file count. The one parent→child pair
    // with both ends known is Custódio (Braga) → his son Bento (Barcelos).
    const flows = computeFlows(t.people, located, gens, () => true);
    expect(flows).toHaveLength(1);
    expect(flows[0].parents).toEqual(['@I33@']); // Custódio moved
    expect(flows[0].children).toEqual(['@I30@']); // and had Bento in Barcelos
  });
});

describe('geometry', () => {
  it('measures distances', () => {
    expect(distanceKm(BRAGA, PORTO)).toBeGreaterThan(40);
    expect(distanceKm(BRAGA, PORTO)).toBeLessThan(50);
  });

  it('curves from start to end, bowing to the left of travel', () => {
    const pts = arcPoints([0, 0], [100, 0], 0.15);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([100, 0]);
    const mid = pts[(pts.length - 1) / 2];
    expect(mid[0]).toBeCloseTo(50);
    expect(mid[1]).toBeCloseTo(-15); // screen y up = left of an eastward move
    // The way back bows the other way, so the two arrows don't overlap.
    expect(arcPoints([100, 0], [0, 0], 0.15)[12][1]).toBeCloseTo(15);
  });

  it('points the arrowhead along the line', () => {
    const [tip, a, b] = arrowHead([10, 0], [0, 0], 5);
    expect(tip).toEqual([10, 0]);
    expect(a[0]).toBeLessThan(10);
    expect(b[0]).toBeLessThan(10);
    expect(a[1]).toBeCloseTo(-b[1]);
  });
});

describe('bundling', () => {
  // Places laid out directly in "pixels" for the test: x = lon, y = lat.
  const project = (p: Place): [number, number] => [p.lon, p.lat];
  const P = (x: number, y: number, place?: string): Place => ({ lat: y, lon: x, place });
  const flow = (from: Place, to: Place, gen: number, kids: string[]) =>
    ({ from, to, gen, step: gen - 1, children: kids, parents: kids.map((k) => `p-${k}`), lane: 0 });

  const porto = P(0, 0, 'Porto, Portugal');
  const braga = P(10, -15, 'Braga, Portugal');
  const saoPaulo = P(500, 300, 'São Paulo, SP, Brasil');
  const santos = P(520, 310, 'Santos, SP, Brasil');
  const rio = P(560, 260, 'Rio de Janeiro, RJ, Brasil');
  const flows = [
    flow(porto, saoPaulo, 1, ['a', 'b']),
    flow(braga, santos, 1, ['c']),
    flow(porto, rio, 1, ['d']),
  ];

  it('keeps one trunk per generation and pair of countries at any zoom', () => {
    for (const radius of [200, 60, 5]) expect(bundleFlows(flows, project, radius)).toHaveLength(1);
    expect(bundleFlows(flows, project, 60)[0].total).toBe(4);
  });

  it('only splits the ends as you zoom in', () => {
    // Zoomed out: each side gathers into one end, so it's a single arrow.
    const [far] = bundleFlows(flows, project, 200);
    expect([far.origins.length, far.dests.length]).toEqual([1, 1]);
    expect(bundleGeometry(far, 0.12)).toHaveLength(1);
    // Mid zoom: São Paulo and Santos still share an end, Rio splits off.
    const [mid] = bundleFlows(flows, project, 60);
    expect(mid.dests.map((d) => d.count).sort()).toEqual([1, 3]);
    // Zoomed in: every city is its own branch.
    const [near] = bundleFlows(flows, project, 5);
    expect([near.origins.length, near.dests.length]).toEqual([2, 3]);

    const paths = bundleGeometry(near, 0.12);
    const trunk = paths.find((p) => p.kind === 'trunk')!;
    expect(trunk.count).toBe(4);
    const outs = paths.filter((p) => p.kind === 'out');
    expect(outs).toHaveLength(3);
    for (const o of outs) expect(o.pts[0]).toEqual(trunk.pts[trunk.pts.length - 1]); // branches leave the trunk end
    for (const o of outs) expect([saoPaulo, santos, rio].map(project)).toContainEqual(o.pts[o.pts.length - 1]);
    for (const i of paths.filter((p) => p.kind === 'in')) expect(i.pts[i.pts.length - 1]).toEqual(trunk.pts[0]);
  });

  it('separates generations into lanes, and groups moves within a country by state', () => {
    const more = [...flows, flow(porto, saoPaulo, 2, ['e'])];
    expect(
      bundleFlows(more, project, 60)
        .map((b) => [b.gen, b.lane])
        .sort(),
    ).toEqual([
      [1, 0],
      [2, 1],
    ]);
    const inBrazil = [flow(saoPaulo, rio, 0, ['x']), flow(santos, rio, 0, ['y'])];
    const [b] = bundleFlows(inBrazil, project, 5);
    expect(b.total).toBe(2); // SP → RJ, from two cities
  });

  it('leaves out moves too short to see at this zoom', () => {
    expect(bundleFlows([flow(porto, braga, 0, ['k'])], project, 60)).toHaveLength(0);
    expect(bundleFlows([flow(porto, braga, 0, ['k'])], project, 5)).toHaveLength(1);
  });

  it('groups places with no country in their name by a coarse grid', () => {
    const a = flow(P(0, 0, 'Porto'), P(500, 300, 'Santos'), 0, ['x']);
    const b = flow(P(1, 1, 'Braga'), P(501, 301, 'Campinas'), 0, ['y']);
    expect(bundleFlows([a, b], project, 0.5)).toHaveLength(1);
  });

  it('keeps branches smooth: no doubling back, and joining the trunk in its direction', () => {
    // Origins spread across and ahead of each other; destinations spread wide.
    const from = [P(0, 0, 'A, X'), P(60, 40, 'B, X'), P(-30, 50, 'C, X')];
    const to = [P(600, 300, 'D, Y'), P(520, 420, 'E, Y'), P(680, 380, 'F, Y'), P(640, 250, 'G, Y')];
    const fs = from.flatMap((f, i) => to.map((t, j) => flow(f, t, 0, [`k${i}${j}`])));
    const [b] = bundleFlows(fs, project, 5);
    const paths = bundleGeometry(b, laneBend(0));
    const trunk = paths.find((p) => p.kind === 'trunk')!.pts;
    const dir = (a: [number, number], c: [number, number]) => Math.atan2(c[1] - a[1], c[0] - a[0]);
    const startDir = dir(trunk[0], trunk[1]);
    const endDir = dir(trunk[trunk.length - 2], trunk[trunk.length - 1]);
    const n = trunk.length - 1;
    for (const p of paths.filter((x) => x.kind === 'in')) {
      const k = p.pts.length - 1;
      expect(Math.abs(dir(p.pts[k - 1], p.pts[k]) - startDir)).toBeLessThan(0.12); // no kink at the merge (within sampling error, ~7°)
    }
    for (const p of paths.filter((x) => x.kind === 'out')) {
      expect(Math.abs(dir(p.pts[0], p.pts[1]) - endDir)).toBeLessThan(0.12); // no kink at the split
    }
    // No branch doubles back: each keeps moving forward along the trunk's direction where it joins.
    const forward = (pts: [number, number][], a: number) => {
      for (let i = 1; i < pts.length; i++) {
        const step = (pts[i][0] - pts[i - 1][0]) * Math.cos(a) + (pts[i][1] - pts[i - 1][1]) * Math.sin(a);
        expect(step).toBeGreaterThan(-1e-9);
      }
    };
    for (const p of paths.filter((x) => x.kind === 'in')) forward(p.pts, startDir);
    for (const p of paths.filter((x) => x.kind === 'out')) forward(p.pts, endDir);
    expect(n).toBeGreaterThan(0);
  });

  it('curves each generation on a shared route a little more, within limits', () => {
    expect(laneBend(1)).toBeGreaterThan(laneBend(0));
    expect(laneBend(10)).toBe(laneBend(4));
    expect(laneBend(10)).toBeLessThanOrEqual(0.25);
  });

  it('trims the end of a path so the arrow stops before the marker', () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
    ];
    expect(trimEnd(pts, 20)).toEqual([
      [0, 0],
      [80, 0],
    ]);
    expect(trimEnd(pts, 90).length).toBe(2); // very short: a stub is kept
  });

  it('cuts a path to a share of its length', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(cutPath(pts, 0.5)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(cutPath(pts, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
    expect(cutPath(pts, 1)).toBe(pts);
  });
});
