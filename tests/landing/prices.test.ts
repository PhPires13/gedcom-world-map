import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalogue, priceList } from '../../src/commerce/catalogue';
import { lowestPrices } from '../../src/landing/prices';

const cat = parseCatalogue(JSON.parse(readFileSync(new URL('../../config/catalogue.json', import.meta.url), 'utf8')));
type List = Parameters<typeof lowestPrices>[0];

describe('"from" prices on the landing page', () => {
  it('takes the cheapest size of each product, in catalogue order', () => {
    const list = {
      products: [
        {
          id: 'framed',
          kind: 'framed',
          variants: [
            { size: 'A2', unitAmount: 64990, shippingAmount: 3990, totalAmount: 68980 },
            { size: 'A3', unitAmount: 44990, shippingAmount: 3990, totalAmount: 48980 },
          ],
        },
        { id: 'digital', kind: 'digital', variants: [{ size: 'A1', unitAmount: 6990, shippingAmount: 0, totalAmount: 6990 }] },
      ],
    } as unknown as List;
    expect(lowestPrices(list)).toEqual([
      { productId: 'framed', kind: 'framed', fromAmount: 44990, size: 'A3', shippingAmount: 3990, sizes: ['A2', 'A3'] },
      { productId: 'digital', kind: 'digital', fromAmount: 6990, size: 'A1', shippingAmount: 0, sizes: ['A1'] },
    ]);
  });

  it('leaves out products with no price in this currency', () => {
    const list = { products: [{ id: 'print', kind: 'print', variants: [] }] } as unknown as List;
    expect(lowestPrices(list)).toEqual([]);
  });

  it('works on the shipped catalogue for Brazil, Portugal and elsewhere', () => {
    const br = priceList(cat, 'BR');
    expect(br.currency).toBe('BRL');
    const fromBr = Object.fromEntries(lowestPrices(br).map((p) => [p.productId, p.fromAmount]));
    for (const p of br.products) if (p.kind !== 'giftcard') expect(fromBr[p.id]).toBe(Math.min(...p.variants.map((v) => v.unitAmount)));
    expect(lowestPrices(priceList(cat, 'PT')).map((p) => p.productId)).toEqual(['digital', 'print', 'framed', 'poster', 'canvas']);
    expect(priceList(cat, 'PT').currency).toBe('EUR');
    expect(priceList(cat, 'JP').currency).toBe('USD');
  });
});
