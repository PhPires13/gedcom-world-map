import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { localised, validateCatalogue, type Catalogue } from '../../src/commerce/catalogue';
import type { DesignSpec } from '../../src/commerce/design';
import { ORDER_STATUSES } from '../../src/commerce/status';
import { designWords, frameColourName, statusDescription, statusLabel } from '../../src/commerce/words';
import { LOCALES, setLocale } from '../../src/i18n/core';

const real = JSON.parse(readFileSync(new URL('../../config/catalogue.json', import.meta.url), 'utf8')) as Catalogue;
const NAMES = { styles: [{ id: 'antique', name: 'Antique parchment' }], layouts: [{ id: 'accurate', name: 'Geographic' }], borders: [], finishes: [] };

afterAll(() => setLocale('pt'));

describe('shop words', () => {
  it('names and describes every order status in every language', () => {
    for (const l of LOCALES) {
      setLocale(l);
      for (const s of ORDER_STATUSES) {
        expect(statusLabel(s)).not.toMatch(/^status\./);
        expect(statusDescription(s)).not.toMatch(/^statusDesc\./);
      }
    }
    setLocale('pt');
    expect(statusLabel('created')).toBe('Aguardando pagamento');
    setLocale('es');
    expect(statusLabel('delivered')).toBe('Entregado');
  });

  it('describes a design in the visitor’s language', () => {
    const d = { styleId: 'antique', layoutId: 'accurate', flagScale: 1, routes: 'essential', maxRoutes: 6, show: { flags: 'origins', surnames: true } } as unknown as DesignSpec;
    setLocale('es');
    expect(designWords(d, NAMES)).toMatchObject({ style: 'Pergamino antiguo', layout: 'Geográfico', border: 'el marco propio del estilo', routes: 'esenciales (algunas rutas principales, como máximo 6)' });
    setLocale('en');
    expect(designWords(d, NAMES).flags).toBe('countries people left, medium');
    expect(frameColourName('antique gold')).toBe('antique gold');
    setLocale('pt');
    expect(frameColourName('antique gold')).toBe('dourada antiga');
    expect(frameColourName('teal')).toBe('teal');
  });
});

describe('catalogue texts', () => {
  it('has every product in Portuguese, English and Spanish', () => {
    for (const p of real.products) for (const l of LOCALES) expect(localised(p.name, l)).toBe(p.name[l]);
    expect(real.products.map((p) => p.name.es)).toEqual(['Mapa familiar digital', 'Impresión fine art (sin marco)', 'Impresión fine art enmarcada']);
  });

  it('refuses a product without a Spanish name', () => {
    const c = structuredClone(real) as unknown as { products: { name: Record<string, string> }[] };
    delete c.products[0].name.es;
    expect(validateCatalogue(c)).toContain('products[0].name needs "pt", "en" and "es"');
  });
});
