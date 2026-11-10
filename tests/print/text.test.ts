import { describe, expect, it } from 'vitest';
import { STRINGS, WATERS } from '../../src/print/text';
import type { Lang } from '../../src/print/types';

const LANGS: Lang[] = ['pt', 'en', 'es'];

describe('words printed on the map', () => {
  it('has every word in every language', () => {
    const keys = Object.keys(STRINGS.pt).sort();
    for (const lang of LANGS) expect(Object.keys(STRINGS[lang]).sort()).toEqual(keys);
    for (const water of WATERS) for (const lang of LANGS) expect(water.name[lang]).toBeTruthy();
  });

  it('writes the legend and default title in Spanish', () => {
    const T = STRINGS.es;
    expect(T.legend).toBe('Leyenda');
    expect(T.birthplace).toBe('Lugar de nacimiento');
    expect(T.origin).toBe('País de origen');
    expect(T.generationOf('1850–1880')).toBe('Generación de 1850–1880');
    expect(T.generation('II')).toBe('Generación II');
    expect(T.family('Rodrigues')).toBe('Familia Rodrigues');
    expect(WATERS.find((w) => w.name.en === 'Atlantic Ocean')!.name.es).toBe('Océano Atlántico');
  });

  it('keeps the Portuguese and English words', () => {
    expect(STRINGS.pt.family('Costa')).toBe('Família Costa');
    expect(STRINGS.en.family('Costa')).toBe('The Costa Family');
    expect(STRINGS.pt.legend).toBe('Legenda');
    expect(STRINGS.en.scale).toBe('Scale of kilometres');
  });
});
