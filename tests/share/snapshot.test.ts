// The public snapshot of a shared map: only people born 100+ years ago, only the map's fields,
// and the server-side check that refuses anything else.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { originEvent, parseGedcom, type Tree } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import { isPresumedLiving } from '../../src/model';
import { previewLang, previewText } from '../../src/share/preview-text';
import {
  buildSnapshot,
  defaultFamilyName,
  MAX_SHARE_PEOPLE,
  publishableIds,
  summarize,
  validateSnapshot,
  type ShareSnapshot,
} from '../../src/share/snapshot';

const NOW = 2026;
const sample = parseGedcom(readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8'));

/** Everyone with a birthplace gets coordinates (as if geocoded), so only the privacy rules decide. */
function locateAll(tree: Tree) {
  const located = new Map<string, { lat: number; lon: number; place: string }>();
  let i = 0;
  for (const p of tree.people.values()) {
    const ev = originEvent(p)?.event;
    if (!ev) continue;
    located.set(p.id, { lat: ev.lat ?? 10 + i, lon: ev.lon ?? -20 - i, place: ev.place ?? '' });
    i++;
  }
  return located;
}

const build = (tree: Tree, extra: { privateIds?: Set<string> } = {}) =>
  buildSnapshot({ tree, located: locateAll(tree), gens: computeGenerations(tree), family: 'Costa', currentYear: NOW, ...extra });

const ged = (body: string) => parseGedcom(`0 HEAD\n${body}\n0 TRLR`);

describe('buildSnapshot', () => {
  const { snapshot, withheld } = build(sample);
  const byName = new Map(snapshot.people.map((p) => [p.name, p]));

  it('leaves out everyone presumed living, entirely (not anonymised)', () => {
    expect(snapshot.people.length).toBeGreaterThan(0);
    expect(withheld).toBeGreaterThan(0);
    // Sofia (b. 1995) and Miguel (b. 1965) are in the file with birthplaces, but not in the share at all.
    expect(byName.has('Sofia Almeida Costa')).toBe(false);
    expect(byName.has('Miguel Costa')).toBe(false);
    expect(snapshot.people.some((p) => /private/i.test(p.name))).toBe(false);
    for (const p of snapshot.people) expect(p.birthYear === undefined || p.birthYear <= NOW - 100).toBe(true);
    // Everyone who is published is not presumed living by the model's own rule.
    const published = new Set(snapshot.people.map((p) => p.name));
    for (const p of sample.people.values()) {
      if (published.has(p.name)) expect(isPresumedLiving(p, NOW)).toBe(false);
    }
  });

  it('keeps only the map fields, with fresh ids instead of the file xrefs', () => {
    for (const p of snapshot.people) {
      expect(Object.keys(p).every((k) => ['id', 'name', 'sex', 'birthYear', 'place', 'lat', 'lon', 'gen', 'parents'].includes(k))).toBe(true);
      expect(p.id).toMatch(/^p\d+$/);
    }
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('@I');
    // Occupations, full dates and deaths never travel.
    expect(json).not.toMatch(/Architect|Engineer|occupation|death|burial|MAR 1|DATE/i);
  });

  it('counts generations from the youngest one published', () => {
    expect(Math.min(...snapshot.people.map((p) => p.gen))).toBe(0);
  });

  it('links parents only among published people', () => {
    const ids = new Set(snapshot.people.map((p) => p.id));
    expect(snapshot.people.some((p) => p.parents.length > 0)).toBe(true);
    for (const p of snapshot.people) for (const parent of p.parents) expect(ids.has(parent)).toBe(true);
  });

  it('keeps recently deceased people out too, and anyone the owner marked private', () => {
    const tree = ged(
      [
        '0 @A@ INDI\n1 NAME Old /One/\n1 BIRT\n2 DATE 1850\n2 PLAC Braga, Portugal',
        '0 @B@ INDI\n1 NAME Died /Young/\n1 BIRT\n2 DATE 1950\n2 PLAC Porto, Portugal\n1 DEAT\n2 DATE 1990',
        '0 @C@ INDI\n1 NAME Hidden /Old/\n1 BIRT\n2 DATE 1860\n2 PLAC Viseu, Portugal',
        '0 @D@ INDI\n1 NAME No /Date/\n1 BIRT\n2 PLAC Lisboa, Portugal',
      ].join('\n'),
    );
    const r = build(tree, { privateIds: new Set(['@C@']) });
    expect(r.snapshot.people.map((p) => p.name)).toEqual(['Old One']);
    expect(r.withheld).toBe(3);
  });

  it('dates people without a birth year from close relatives, leaning towards private', () => {
    // The child was born in 1900, so the undated parent was born by 1885: published.
    const tree = ged(
      [
        '0 @P@ INDI\n1 NAME Undated /Parent/\n1 BIRT\n2 PLAC Braga, Portugal\n1 FAMS @F@',
        '0 @K@ INDI\n1 NAME Child /Born1900/\n1 BIRT\n2 DATE 1900\n2 PLAC Recife, Brazil\n1 FAMC @F@',
        '0 @F@ FAM\n1 HUSB @P@\n1 CHIL @K@',
      ].join('\n'),
    );
    expect([...publishableIds(tree, NOW)].sort()).toEqual(['@K@', '@P@']);
    const r = build(tree);
    const child = r.snapshot.people.find((p) => p.name === 'Child Born1900')!;
    const parent = r.snapshot.people.find((p) => p.name === 'Undated Parent')!;
    expect(parent.birthYear).toBeUndefined();
    expect(child.parents).toEqual([parent.id]);
  });

  it('suggests the most common surname as the family name', () => {
    expect(defaultFamilyName(sample, publishableIds(sample, NOW))).toBeTruthy();
  });

  it('passes the server check as built', () => {
    expect(validateSnapshot(JSON.parse(JSON.stringify(snapshot)), NOW)).toEqual(snapshot);
  });

  it('summarises people, generations, places and years', () => {
    const s = summarize(snapshot);
    expect(s.people).toBe(snapshot.people.length);
    expect(s.generations).toBeGreaterThan(1);
    expect(s.fromYear).toBeLessThan(s.toYear!);
    expect(previewText('pt', 'Costa', s).title).toBe('Família Costa — mapa das migrações');
    expect(previewText('pt', 'Costa', s).description).toMatch(/^\d+ pessoas em \d+ gerações/);
    expect(previewLang('en-GB,en;q=0.9')).toBe('en');
    expect(previewLang('fr-FR, es;q=0.5')).toBe('es');
    expect(previewLang(undefined)).toBe('pt');
  });
});

describe('validateSnapshot', () => {
  const person = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Rosa Lima', place: 'Braga', lat: 41.5, lon: -8.4, gen: 2, parents: [], birthYear: 1880, ...over });
  const snap = (people: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, family: 'Lima', people, ...extra });
  const bad = (v: unknown, msg: RegExp) => expect(() => validateSnapshot(v, NOW)).toThrow(msg);

  it('accepts a clean snapshot and trims it', () => {
    const out = validateSnapshot(snap([person({ name: '  Rosa Lima ' }), person({ id: 'p2', parents: ['p1'], birthYear: 1926 })]), NOW);
    expect(out.people[0].name).toBe('Rosa Lima');
    expect(out.people[1].parents).toEqual(['p1']);
  });

  it('refuses anyone flagged living or private', () => {
    bad(snap([person({ living: true })]), /living/);
    bad(snap([person({ presumedLiving: true })]), /living/);
    bad(snap([person({ isPrivate: true })]), /living or private/);
  });

  it('refuses anyone born less than 100 years ago', () => {
    bad(snap([person({ birthYear: 1927 })]), /less than 100 years/);
    bad(snap([person({ birthYear: 2001 })]), /less than 100 years/);
  });

  it('refuses private fields and anything unknown', () => {
    bad(snap([person({ death: { year: 1950 } })]), /death is not allowed/);
    bad(snap([person({ occupation: 'Farmer' })]), /occupation is not allowed/);
    bad(snap([person()], { owner: 'x' }), /owner is not allowed/);
  });

  it('refuses malformed snapshots', () => {
    bad(null, /object/);
    bad(snap([]), /non-empty/);
    bad({ ...snap([person()]), version: 2 }, /version/);
    bad(snap([person()], { family: ' ' }), /family is required/);
    bad(snap([person({ lat: 100 })]), /lat/);
    bad(snap([person({ gen: 1.5 })]), /gen/);
    bad(snap([person({ sex: 'X' })]), /sex/);
    bad(snap([person({ parents: ['nobody'] })]), /parents/);
    bad(snap([person({ parents: ['p1'] })]), /parents/);
    bad(snap([person(), person()]), /repeated/);
    bad(snap([person({ id: '<script>' })]), /id/);
    bad(snap(Array.from({ length: MAX_SHARE_PEOPLE + 1 }, (_, i) => person({ id: `p${i}` }))), /Too many/);
  });

  it('round-trips a snapshot through JSON', () => {
    const s: ShareSnapshot = { version: 1, family: 'Lima', people: [person() as ShareSnapshot['people'][number]] };
    expect(validateSnapshot(JSON.parse(JSON.stringify(s)), NOW)).toEqual(s);
  });
});
