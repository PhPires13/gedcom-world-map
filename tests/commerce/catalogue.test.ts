import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatMoney, marketFor, parseCatalogue, priceList, quote, QuoteError, validateCatalogue, type Catalogue } from '../../src/commerce/catalogue';

const real = JSON.parse(readFileSync(new URL('../../config/catalogue.json', import.meta.url), 'utf8'));
const clone = (): Catalogue => structuredClone(real);

describe('the shipped catalogue (config/catalogue.json)', () => {
  it('is valid', () => {
    expect(validateCatalogue(real)).toEqual([]);
  });

  it('is still marked as placeholder prices', () => {
    // Flip this test when the owner sets real prices.
    expect(real.placeholderPrices).toBe(true);
  });

  it('sells the planned products and sizes', () => {
    const cat = parseCatalogue(real);
    const sizes = (id: string) => cat.products.find((p) => p.id === id)?.variants.map((v) => v.size);
    expect(sizes('digital')).toEqual(['A1']);
    expect(sizes('print')).toEqual(['A3', 'A2', 'A1']);
    expect(sizes('framed')).toEqual(['A3', 'A2']);
    expect(sizes('poster')).toEqual(['A3', 'A2', 'A1']);
    expect(sizes('canvas')).toEqual(['A3', 'A2']);
    expect(sizes('giftcard')).toEqual(['V1', 'V2', 'V3']);
  });

  it('sells gift cards of BRL 200/350/500 and EUR/USD 50/90/130', () => {
    const card = parseCatalogue(real).products.find((p) => p.kind === 'giftcard')!;
    expect(card.variants.map((v) => v.prices)).toEqual([
      { BRL: 200, EUR: 50, USD: 50 },
      { BRL: 350, EUR: 90, USD: 90 },
      { BRL: 500, EUR: 130, USD: 130 },
    ]);
  });

  it('routes Brazil to manual fulfilment in BRL and Portugal to Prodigi in EUR', () => {
    const cat = parseCatalogue(real);
    expect(marketFor(cat, 'BR')).toMatchObject({ currency: 'BRL', fulfilment: 'manual' });
    expect(marketFor(cat, 'pt')).toMatchObject({ currency: 'EUR', fulfilment: 'prodigi' });
    expect(marketFor(cat, 'JP')).toMatchObject({ id: 'ROW', currency: 'USD' });
  });
});

describe('validateCatalogue', () => {
  it('reports missing prices, bad amounts and unknown currencies', () => {
    const c = clone();
    delete c.products[1].variants[0].prices.EUR;
    c.products[1].variants[1].prices.BRL = -5;
    c.products[1].variants[2].prices.USD = 12.345;
    (c.products[0].variants[0].prices as Record<string, number>).GBP = 10;
    const errors = validateCatalogue(c);
    expect(errors).toContain('products[1].variants[0].prices: missing price in EUR');
    expect(errors).toContain('products[1].variants[1].prices.BRL must be a positive number');
    expect(errors).toContain('products[1].variants[2].prices.USD has more than 2 decimals');
    expect(errors).toContain('products[0].variants[0].prices: GBP is not in currencies');
  });

  it('needs a Prodigi SKU for every physical product a Prodigi market sells', () => {
    const c = clone();
    delete c.products[2].variants[1].skus;
    expect(validateCatalogue(c)).toContain('markets[1]: product framed A2 has no "prodigi" SKU but this market is fulfilled by Prodigi');
  });

  it('rejects duplicate countries, a missing "*" market and unknown routes', () => {
    const c = clone();
    c.markets[1].countries.push('BR');
    c.markets[2].countries = ['US'];
    (c.markets[0] as { fulfilment: string }).fulfilment = 'gelato';
    const errors = validateCatalogue(c);
    expect(errors).toContain('markets[1].countries: BR is already in market BR');
    expect(errors).toContain('one market must use "*" for every other country');
    expect(errors.some((e) => e.startsWith('markets[0].fulfilment must be one of'))).toBe(true);
  });

  it('rejects framed products without frame colours and duplicate sizes', () => {
    const c = clone();
    c.products[2].frameColours = [];
    c.products[1].variants[1].size = 'A3';
    const errors = validateCatalogue(c);
    expect(errors).toContain('products[2].frameColours must list at least one colour');
    expect(errors).toContain('products[1].variants[1].size A3 is listed twice');
  });

  it('checks gift cards: value tiers, no partner, no shipping', () => {
    const c = clone();
    const card = c.products.find((p) => p.kind === 'giftcard')!;
    const i = c.products.indexOf(card);
    (card.variants[0] as { size: string }).size = 'A3';
    card.variants[1].skus = { prodigi: 'GIFT' };
    (c.markets[0].shipping as Record<string, unknown>).giftcard = { BRL: 5 };
    const errors = validateCatalogue(c);
    expect(errors).toContain(`products[${i}].variants[0].size must be one of V1, V2, V3 (a gift card’s value tiers)`);
    expect(errors).toContain(`products[${i}].variants[1].skus: a gift card is not made by a partner`);
    expect(errors).toContain('markets[0].shipping: giftcard products are not shipped');
    // …and a print can't use a value tier.
    const d = clone();
    (d.products[1].variants[0] as { size: string }).size = 'V1';
    expect(validateCatalogue(d)).toContain('products[1].variants[0].size must be one of A3, A2, A1');
  });

  it('checks partner attributes and frame colours on the right products', () => {
    const c = clone();
    const canvas = c.products.findIndex((p) => p.kind === 'canvas');
    c.products[canvas].partnerAttributes = { prodigi: { wrap: '' } };
    c.products[1].frameColours = ['black'];
    c.products[0].partnerAttributes = { prodigi: { wrap: 'MirrorWrap' } };
    const errors = validateCatalogue(c);
    expect(errors).toContain(`products[${canvas}].partnerAttributes.prodigi must map attribute names to text`);
    expect(errors).toContain('products[1].frameColours is only for framed products');
    expect(errors).toContain('products[0].partnerAttributes must be an object, on a physical product');
  });

  it('needs Prodigi SKUs for the new physical formats too', () => {
    const c = clone();
    delete c.products.find((p) => p.id === 'poster')!.variants[2].skus;
    expect(validateCatalogue(c)).toContain('markets[1]: product poster A1 has no "prodigi" SKU but this market is fulfilled by Prodigi');
  });

  it('parseCatalogue throws with every problem listed', () => {
    expect(() => parseCatalogue({ version: 2 })).toThrow(/version must be 1[\s\S]*products must list/);
  });
});

describe('quote', () => {
  const cat = parseCatalogue(real);

  it('prices in the market currency, in minor units, with the market shipping', () => {
    expect(quote(cat, { productId: 'framed', size: 'A2', country: 'BR' })).toEqual({
      productId: 'framed',
      kind: 'framed',
      size: 'A2',
      currency: 'BRL',
      market: 'BR',
      fulfilment: 'manual',
      sku: undefined,
      unitAmount: 64990,
      shippingAmount: 3990,
      totalAmount: 68980,
    });
    expect(quote(cat, { productId: 'print', size: 'A2', country: 'PT' })).toMatchObject({ currency: 'EUR', fulfilment: 'prodigi', sku: 'GLOBAL-HPR-A2', totalAmount: 5500 });
  });

  it('lets the customer choose another currency, and charges digital products no shipping', () => {
    expect(quote(cat, { productId: 'print', size: 'A3', country: 'US', currency: 'EUR' })).toMatchObject({ currency: 'EUR', unitAmount: 3900, shippingAmount: 0 });
    expect(quote(cat, { productId: 'digital', size: 'A1', country: 'US' })).toMatchObject({ fulfilment: undefined, shippingAmount: 0, totalAmount: 1690 });
  });

  it('prices gift cards with no shipping or partner, and the new formats with their kind’s shipping', () => {
    expect(quote(cat, { productId: 'giftcard', size: 'V2', country: 'US' })).toEqual({
      productId: 'giftcard',
      kind: 'giftcard',
      size: 'V2',
      currency: 'USD',
      market: 'ROW',
      fulfilment: undefined,
      sku: undefined,
      unitAmount: 9000,
      shippingAmount: 0,
      totalAmount: 9000,
    });
    expect(quote(cat, { productId: 'poster', size: 'A2', country: 'JP' })).toMatchObject({ sku: 'GLOBAL-EMA-A2', unitAmount: 3200, shippingAmount: 900 });
    expect(quote(cat, { productId: 'canvas', size: 'A3', country: 'BR' })).toMatchObject({ fulfilment: 'manual', unitAmount: 39990, shippingAmount: 3990 });
    expect(() => quote(cat, { productId: 'giftcard', size: 'A3', country: 'BR' })).toThrow(/not sold in A3/);
  });

  it('refuses unknown products, sizes and currencies', () => {
    expect(() => quote(cat, { productId: 'mug', size: 'A3', country: 'PT' })).toThrow(QuoteError);
    expect(() => quote(cat, { productId: 'framed', size: 'A1', country: 'PT' })).toThrow(/not sold in A1/);
    expect(() => quote(cat, { productId: 'print', size: 'A3', country: 'PT', currency: 'GBP' })).toThrow(/Unsupported currency/);
  });

  it('respects a market that only sells some products', () => {
    const c = clone();
    c.markets[0].products = ['digital'];
    expect(() => quote(c, { productId: 'framed', size: 'A3', country: 'BR' })).toThrow(/can't be shipped to BR/);
  });
});

describe('priceList and formatMoney', () => {
  it('lists every product with totals for the visitor', () => {
    const list = priceList(parseCatalogue(real), 'BR');
    expect(list.currency).toBe('BRL');
    expect(list.products.map((p) => p.id)).toEqual(['digital', 'print', 'framed', 'poster', 'canvas', 'giftcard']);
    expect(list.products[2].variants[0]).toEqual({ size: 'A3', unitAmount: 44990, shippingAmount: 3990, totalAmount: 48980 });
  });

  it('formats money the local way', () => {
    expect(formatMoney(68980, 'BRL')).toMatch(/R\$\s?689,80/);
    expect(formatMoney(5500, 'EUR')).toMatch(/55,00\s?€/);
    expect(formatMoney(1690, 'USD')).toBe('$16.90');
  });
});
