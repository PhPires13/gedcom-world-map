import { describe, expect, it } from 'vitest';
import type { Flow, Place } from '../../src/flows';
import { essentialRoutes, routeCap, routesAsFlows, segmentsCross } from '../../src/print/simplify';

// Places named "town, country"; the region is the country.
const at = (name: string, lat: number, lon: number): Place => ({ lat, lon, place: name });
const P = { braga: at('Braga, PT', 41.5, -8.4), porto: at('Porto, PT', 41.1, -8.6), rio: at('Rio, BR', -22.9, -43.2), sp: at('São Paulo, BR', -23.5, -46.6), boston: at('Boston, US', 42.4, -71.1), paris: at('Paris, FR', 48.9, 2.4), luanda: at('Luanda, AO', -8.8, 13.3) };
const country = (p: Place) => p.place!.split(', ')[1];
let n = 0;
const flow = (from: Place, to: Place, gen: number, movers: number, ids?: string[]): Flow => ({
  from,
  to,
  gen,
  step: gen - 1,
  parents: ids ?? Array.from({ length: movers }, () => `m${n++}`),
  children: [`c${n++}`],
  lane: 0,
});

describe('essential routes', () => {
  it('merges every generation’s moves between two countries into one route', () => {
    const routes = essentialRoutes(
      [flow(P.braga, P.rio, 3, 2), flow(P.porto, P.rio, 2, 1), flow(P.braga, P.sp, 2, 2), flow(P.braga, P.rio, 1, 1)],
      { regionOf: country, maxRoutes: 5 },
    );
    expect(routes).toHaveLength(1);
    const r = routes[0];
    expect(r.movers).toHaveLength(6);
    expect(r.from).toBe(P.braga); // most movers left from Braga
    expect(r.to).toBe(P.rio);
    expect(r.gen).toBe(2); // generation 2 has the most movers (3)
    expect(r.flows).toHaveLength(4);
  });

  it('colours a tie by the most recent generation', () => {
    const [r] = essentialRoutes([flow(P.braga, P.rio, 3, 2), flow(P.braga, P.rio, 1, 2)], { regionOf: country, maxRoutes: 5 });
    expect(r.gen).toBe(1);
  });

  it('keeps only the most travelled routes, up to the cap', () => {
    const flows = [flow(P.braga, P.rio, 2, 9), flow(P.rio, P.boston, 1, 5), flow(P.rio, P.paris, 1, 3), flow(P.rio, P.luanda, 1, 2), flow(P.braga, P.paris, 2, 1)];
    const routes = essentialRoutes(flows, { regionOf: country, maxRoutes: 3 });
    expect(routes.map((r) => `${r.fromRegion}>${r.toRegion}`)).toEqual(['PT>BR', 'BR>US', 'BR>FR']);
    expect(routeCap('A3')).toBeLessThan(routeCap('A2'));
    expect(routeCap('A2')).toBeLessThanOrEqual(routeCap('A1'));
  });

  it('ranks the direct line higher only as much as the boost says', () => {
    // A side branch of three people to Boston, against two people (one of them a direct ancestor) to Paris.
    const side = flow(P.rio, P.boston, 1, 3);
    const direct = flow(P.rio, P.paris, 1, 2, ['ancestor', 'cousin']);
    const directLine = new Set(['ancestor']);
    const pick = (directBoost: number) => essentialRoutes([side, direct], { regionOf: country, maxRoutes: 1, directLine, directBoost })[0].toRegion;
    expect(pick(0)).toBe('US');
    expect(pick(1)).toBe('FR'); // 2 + 1 ties with 3, and a tie goes to the direct line
    expect(pick(2)).toBe('FR'); // 2 + 2 beats 3
    // A bigger side branch still wins when the boost isn't enough.
    const bigSide = flow(P.rio, P.boston, 1, 5);
    expect(essentialRoutes([bigSide, direct], { regionOf: country, maxRoutes: 1, directLine, directBoost: 1 })[0].toRegion).toBe('US');
  });

  it('drops moves within a region unless the layout allows a few', () => {
    const flows = [flow(P.braga, P.porto, 2, 4), flow(P.rio, P.sp, 1, 3), flow(P.braga, P.rio, 2, 1)];
    expect(essentialRoutes(flows, { regionOf: country, maxRoutes: 5 }).map((r) => r.toRegion)).toEqual(['BR']);
    const some = essentialRoutes(flows, { regionOf: country, maxRoutes: 3, internalRoutes: (r) => (r === 'PT' ? 1 : 0) });
    expect(some.map((r) => `${r.fromRegion}>${r.toRegion}`)).toEqual(['PT>BR', 'PT>PT']);
  });

  it('prefers routes that don’t cross the ones already chosen', () => {
    // On a plain grid: A→B is the top route; C→D crosses it, E→F doesn't. With room for two, E→F wins.
    const pts: Record<string, [number, number]> = { A: [0, 0], B: [10, 10], C: [0, 10], D: [10, 0], E: [20, 0], F: [30, 10] };
    const pl = (k: string) => at(`${k}, ${k}`, pts[k][1], pts[k][0]);
    const flows = [flow(pl('A'), pl('B'), 1, 5), flow(pl('C'), pl('D'), 1, 4), flow(pl('E'), pl('F'), 1, 3)];
    const project = (p: Place): [number, number] => [p.lon, p.lat];
    const two = essentialRoutes(flows, { regionOf: country, maxRoutes: 2, project });
    expect(two.map((r) => r.fromRegion)).toEqual(['A', 'E']);
    // With room for all three, the crossing one is still drawn: only needless crossings are avoided.
    expect(essentialRoutes(flows, { regionOf: country, maxRoutes: 3, project })).toHaveLength(3);
  });

  it('turns routes back into single moves for drawing', () => {
    const routes = essentialRoutes([flow(P.braga, P.rio, 2, 2), flow(P.braga, P.rio, 1, 1)], { regionOf: country, maxRoutes: 5 });
    const [f] = routesAsFlows(routes);
    expect(f).toMatchObject({ from: P.braga, to: P.rio, gen: 2, lane: 0 });
    expect(f.parents).toHaveLength(3);
  });

  it('tells crossing segments apart from ones that only touch', () => {
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsCross([0, 0], [10, 10], [10, 10], [20, 0])).toBe(false);
    expect(segmentsCross([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false);
  });
});
