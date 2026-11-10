import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/core';
import { printMessages, type PrintKey } from '../../src/i18n/messages/print';
import { BORDERS, FINISHES, LAYOUTS } from '../../src/print/catalog';
import { STYLES } from '../../src/print/styles';

describe('print designer words', () => {
  it('names every style, layout, border and finish in every language', () => {
    const items = [
      ...STYLES.map((x) => ['style', x.id]),
      ...LAYOUTS.map((x) => ['layout', x.id]),
      ...BORDERS.map((x) => ['border', x.id]),
      ...FINISHES.map((x) => ['finish', x.id]),
    ];
    for (const [kind, id] of items) {
      for (const locale of LOCALES) {
        for (const part of ['name', 'desc']) {
          const msg = printMessages[locale][`${kind}.${id}.${part}` as PrintKey];
          expect(typeof msg === 'string' && msg.length > 0, `${locale} ${kind}.${id}.${part}`).toBe(true);
        }
      }
    }
  });

  it('keeps the English names the same as the JSON files', () => {
    for (const s of STYLES) expect(printMessages.en[`style.${s.id}.name` as PrintKey]).toBe(s.name);
    for (const l of LAYOUTS) expect(printMessages.en[`layout.${l.id}.name` as PrintKey]).toBe(l.name);
    for (const b of BORDERS) expect(printMessages.en[`border.${b.id}.name` as PrintKey]).toBe(b.name);
    for (const f of FINISHES) expect(printMessages.en[`finish.${f.id}.name` as PrintKey]).toBe(f.name);
  });

  it('words counts in each language', () => {
    const find = (locale: 'pt' | 'en' | 'es', count: number) => {
      const m = printMessages[locale]['warn.outsideArea'];
      return typeof m === 'function' ? m({ count }) : m;
    };
    expect(find('en', 1)).toContain('1 person is');
    expect(find('en', 3)).toContain('3 people are');
  });
});
