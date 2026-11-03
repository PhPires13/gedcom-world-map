import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractYear, originEvent, parseCoord, parseGedcom } from '../src/gedcom';
import { computeGenerations, lineage } from '../src/generations';
import { placeVariants } from '../src/geocode';
import { generationColor, vibrant } from '../src/colors';

const sample = parseGedcom(readFileSync(new URL('../public/sample.ged', import.meta.url), 'utf8'));

describe('parseGedcom', () => {
  it('reads people, names and relationships', () => {
    expect(sample.people.size).toBe(34);
    const miguel = sample.people.get('@I3@')!;
    expect(miguel.name).toBe('Miguel Costa');
    expect(miguel.surname).toBe('Costa');
    expect(miguel.parents.sort()).toEqual(['@I5@', '@I6@']);
    expect(miguel.children.sort()).toEqual(['@I1@', '@I2@']);
    expect(miguel.spouses).toEqual(['@I4@']);
  });

  it('reads MAP coordinates with hemispheres', () => {
    const b = sample.people.get('@I5@')!.birth!;
    expect(b.lat).toBeCloseTo(41.5454);
    expect(b.lon).toBeCloseTo(-8.4265);
  });

  it('falls back to baptism place for the map', () => {
    const luisa = sample.people.get('@I19@')!;
    expect(originEvent(luisa)).toMatchObject({ kind: 'baptism', event: { place: 'Benguela, Angola' } });
    expect(originEvent(sample.people.get('@I21@')!)).toBeUndefined();
  });

  it('handles CONC/CONT and CRLF line endings', () => {
    const t = parseGedcom('0 @I1@ INDI\r\n1 NAME Jo /Doe/\r\n1 BIRT\r\n2 PLAC Spring\r\n3 CONC field, USA\r\n0 TRLR\r\n');
    expect(t.people.get('@I1@')!.birth!.place).toBe('Springfield, USA');
  });
});

describe('helpers', () => {
  it('parses coordinates', () => {
    expect(parseCoord('N41.5')).toBe(41.5);
    expect(parseCoord('W8.4')).toBe(-8.4);
    expect(parseCoord('-12,25')).toBe(-12.25);
    expect(parseCoord('nonsense')).toBeUndefined();
  });

  it('extracts years from GEDCOM dates', () => {
    expect(extractYear('12 MAR 1901')).toBe(1901);
    expect(extractYear('ABT 1850')).toBe(1850);
    expect(extractYear('BET 1850 AND 1860')).toBe(1850);
    expect(extractYear(undefined)).toBeUndefined();
  });

  it('builds less specific place variants but never just the country', () => {
    expect(placeVariants('Lugar do Outeiro, Ponte de Lima, Viana do Castelo, Portugal')).toEqual([
      'Lugar do Outeiro, Ponte de Lima, Viana do Castelo, Portugal',
      'Ponte de Lima, Viana do Castelo, Portugal',
      'Viana do Castelo, Portugal',
    ]);
    expect(placeVariants('Paris')).toEqual(['Paris']);
  });

  it('makes colours more vibrant: same hue and lightness, more saturated', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const light = (h: string) => (Math.max(...rgb(h)) + Math.min(...rgb(h))) / 2;
    const chroma = (h: string) => Math.max(...rgb(h)) - Math.min(...rgb(h));
    const order = (h: string) =>
      rgb(h)
        .map((x, i) => [x, i])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .map((p) => p[1])
        .join();
    for (const c of ['#f76707', '#74b816', '#1098ad', '#5f3dc4', '#862e9c']) {
      const v = vibrant(c);
      expect(Math.abs(light(v) - light(c))).toBeLessThanOrEqual(1.5); // not darker
      expect(chroma(v)).toBeGreaterThanOrEqual(chroma(c)); // more saturated
      expect(order(v)).toBe(order(c)); // same hue family
    }
    expect(vibrant('#808080')).toBe('#808080');
  });

  it('gives distinct colours to each generation in small trees', () => {
    const colors = new Set([0, 1, 2, 3, 4, 5, 6].map((g) => generationColor(g, 6)));
    expect(colors.size).toBe(7);
  });
});

describe('generations', () => {
  const gens = computeGenerations(sample);
  it('puts the youngest at 0 and ancestors further back', () => {
    expect(gens.get('@I1@')).toBe(0); // Sofia
    expect(gens.get('@I9@')).toBe(0); // cousin Lucas
    expect(gens.get('@I3@')).toBe(1); // father
    expect(gens.get('@I8@')).toBe(1); // aunt's husband (spouse = same generation)
    expect(gens.get('@I5@')).toBe(2);
    expect(gens.get('@I33@')).toBe(6);
  });

  it('collects ancestors and descendants', () => {
    expect(lineage(sample, '@I1@', 'parents').size).toBe(25);
    expect([...lineage(sample, '@I5@', 'children')].sort()).toEqual(['@I1@', '@I2@', '@I3@', '@I7@', '@I9@']);
  });
});
