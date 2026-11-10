import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGedcom } from '../../src/gedcom';
import {
  gedcomToDrafts,
  isPresumedLiving,
  isPrivate,
  latestPlausibleBirthYear,
  localTreeDetail,
  presumedLivingAll,
  redactPerson,
  toGedcomTree,
} from '../../src/model';

const NOW = 2026;
const born = (year: number) => ({ birth: { year } });

describe('isPresumedLiving', () => {
  it('is false for anyone with a death or burial record, even undated', () => {
    expect(isPresumedLiving({ ...born(2000), death: {} }, NOW)).toBe(false);
    expect(isPresumedLiving({ burial: { place: 'Braga' } }, NOW)).toBe(false);
  });

  it('uses the 100-year rule on the birth year', () => {
    expect(isPresumedLiving(born(1927), NOW)).toBe(true);
    expect(isPresumedLiving(born(1926), NOW)).toBe(false);
  });

  it('falls back to the baptism year', () => {
    expect(isPresumedLiving({ baptism: { year: 1950 } }, NOW)).toBe(true);
    expect(isPresumedLiving({ baptism: { year: 1850 } }, NOW)).toBe(false);
  });

  it('presumes living when nothing is known', () => {
    expect(isPresumedLiving({}, NOW)).toBe(true);
  });

  it('estimates from relatives when the own birth year is unknown', () => {
    // A child born in 1900 means the parent was born by 1885.
    expect(isPresumedLiving({}, NOW, { children: [1900] })).toBe(false);
    expect(isPresumedLiving({}, NOW, { children: [1990] })).toBe(true);
    // A parent born in 1850 could have had them as late as 1900.
    expect(isPresumedLiving({}, NOW, { parents: [1850] })).toBe(false);
    expect(isPresumedLiving({}, NOW, { parents: [1900] })).toBe(true);
  });
});

describe('latestPlausibleBirthYear', () => {
  it('prefers the tightest child bound and errs young otherwise', () => {
    expect(latestPlausibleBirthYear({ children: [1920, 1910], parents: [1800] })).toBe(1895);
    expect(latestPlausibleBirthYear({ parents: [1850, 1860], spouses: [1880] })).toBe(1910);
    expect(latestPlausibleBirthYear({})).toBeUndefined();
  });
});

describe('isPrivate', () => {
  it('follows the override, then the living rule', () => {
    expect(isPrivate(null, true)).toBe(true);
    expect(isPrivate(null, false)).toBe(false);
    expect(isPrivate('public', true)).toBe(false);
    expect(isPrivate('private', false)).toBe(true);
  });
});

describe('GEDCOM bridge', () => {
  const ged = parseGedcom(readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8'));

  it('turns every family link into a parent or spouse link, once', () => {
    const { people, links } = gedcomToDrafts(ged);
    expect(people).toHaveLength(34);
    const miguel = '@I3@';
    expect(links.filter((l) => l.kind === 'parent' && l.toRef === miguel).map((l) => l.fromRef).sort()).toEqual([
      '@I5@',
      '@I6@',
    ]);
    expect(links.filter((l) => l.kind === 'spouse' && (l.fromRef === miguel || l.toRef === miguel))).toHaveLength(1);
  });

  it('builds a local tree where every link is unsupported and the young are private', () => {
    const d = localTreeDetail(ged, 'sample', NOW);
    expect(d.relationships.every((r) => r.confidence === 'unsupported')).toBe(true);
    expect(d.health.provenShare).toBe(0);
    const sofia = d.people.find((p) => p.id === '@I1@')!;
    expect(sofia.isPrivate).toBe(true);
    expect(redactPerson(sofia).name).toBe('Private');
    expect(redactPerson(sofia).birth).toBeUndefined();
  });

  it('round-trips back to the map shape', () => {
    const back = toGedcomTree(localTreeDetail(ged, 'sample', NOW));
    const miguel = back.people.get('@I3@')!;
    expect(miguel.parents.sort()).toEqual(['@I5@', '@I6@']);
    expect(miguel.children.sort()).toEqual(['@I1@', '@I2@']);
    expect(miguel.spouses).toEqual(['@I4@']);
  });

  it('applies the living rule across a whole tree', () => {
    const m = presumedLivingAll(
      [{ id: 'a' }, { id: 'b', birth: { year: 1890 } }],
      [{ kind: 'parent', from: 'a', to: 'b' }],
      NOW,
    );
    expect(m.get('a')).toBe(false);
    expect(m.get('b')).toBe(false);
  });
});
