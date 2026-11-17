// "From" prices for the landing page: the cheapest size of each product, from the shop's price list
// (GET /api/shop/catalogue). Pure, so it is tested without a browser.

import type { PriceList } from '../commerce/catalogue';

export interface FromPrice {
  productId: string;
  kind: PriceList['products'][number]['kind'];
  /** Cheapest size's price in minor units (34990 = 349,90), shipping not included. */
  fromAmount: number;
  /** Size of that cheapest variant. */
  size: string;
  /** Shipping added to that variant in minor units (0 = included). */
  shippingAmount: number;
  /** Every size sold, in catalogue order. */
  sizes: string[];
}

/**
 * The lowest price of each product in the list, keeping the list's order. Products without any
 * priced size (none in this currency) are left out.
 */
export function lowestPrices(list: Pick<PriceList, 'products'>): FromPrice[] {
  const out: FromPrice[] = [];
  for (const p of list.products) {
    const priced = p.variants.filter((v) => Number.isFinite(v.unitAmount) && v.unitAmount > 0);
    if (!priced.length) continue;
    const cheapest = priced.reduce((a, b) => (b.unitAmount < a.unitAmount ? b : a));
    out.push({
      productId: p.id,
      kind: p.kind,
      fromAmount: cheapest.unitAmount,
      size: cheapest.size,
      shippingAmount: cheapest.shippingAmount,
      sizes: priced.map((v) => v.size),
    });
  }
  return out;
}
