// The shop's catalogue: what can be bought, at what price in each currency, and who makes it for
// each market. It is plain data (config/catalogue.json) so the owner can change prices, sizes and
// partners without touching code; `validateCatalogue` checks it when the server starts.
//
// Runs in the browser (price display) and on the server (the price actually charged), so no I/O.

export const CURRENCIES = ['BRL', 'EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PRODUCT_KINDS = ['digital', 'print', 'framed'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const FULFILMENT_ROUTES = ['prodigi', 'manual'] as const;
/** Who makes and ships a physical product. Digital products need no fulfilment. */
export type FulfilmentRoute = (typeof FULFILMENT_ROUTES)[number];

export const SIZES = ['A3', 'A2', 'A1'] as const;
export type Size = (typeof SIZES)[number];

export type Localised = { en: string; pt: string };

/** A price per currency, in major units (e.g. 349.90). */
export type PriceTable = Partial<Record<Currency, number>>;

export interface Variant {
  size: Size;
  prices: PriceTable;
  /** Partner product codes, e.g. { "prodigi": "GLOBAL-HPR-A2" }. */
  skus?: Partial<Record<FulfilmentRoute, string>>;
}

export interface Product {
  id: string;
  kind: ProductKind;
  name: Localised;
  description: Localised;
  /** Paper / frame details shown to the customer and printed on the production sheet. */
  material?: Localised;
  /** Frame colours a customer can pick (framed products only). First one is the default. */
  frameColours?: string[];
  variants: Variant[];
}

export interface Market {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 codes; "*" matches every country not listed in another market. */
  countries: string[];
  /** Currency shown to visitors from these countries. */
  currency: Currency;
  /** Who makes physical products for this market. */
  fulfilment: FulfilmentRoute;
  /** Products this market can buy (default: all). */
  products?: string[];
  /** Flat shipping per product kind and currency, in major units (0 or missing = included in the price). */
  shipping?: Partial<Record<ProductKind, PriceTable>>;
}

export interface Catalogue {
  version: 1;
  /** True while the prices are placeholders: the shop shows a warning and refuses live payments. */
  placeholderPrices: boolean;
  currencies: Currency[];
  defaultCurrency: Currency;
  products: Product[];
  markets: Market[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isLocalised = (v: unknown) => isObj(v) && typeof v.en === 'string' && typeof v.pt === 'string' && !!v.en && !!v.pt;
const COUNTRY_RE = /^[A-Z]{2}$/;

/** Every problem with a catalogue, as readable messages (empty = valid). Unknown "_comment" keys are allowed. */
export function validateCatalogue(c: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(c)) return ['catalogue must be an object'];
  if (c.version !== 1) errors.push('version must be 1');
  if (typeof c.placeholderPrices !== 'boolean') errors.push('placeholderPrices must be true or false');
  const currencies = Array.isArray(c.currencies) ? (c.currencies as unknown[]) : [];
  if (!currencies.length) errors.push('currencies must list at least one currency');
  for (const cur of currencies) if (!CURRENCIES.includes(cur as Currency)) errors.push(`currencies: unknown currency ${String(cur)}`);
  if (!currencies.includes(c.defaultCurrency)) errors.push('defaultCurrency must be one of currencies');

  const checkPrices = (p: unknown, where: string, allowZero: boolean) => {
    if (!isObj(p)) return errors.push(`${where} must be an object of currency → price`);
    for (const cur of currencies) {
      const v = p[cur as string];
      if (v === undefined) {
        if (!allowZero) errors.push(`${where}: missing price in ${String(cur)}`);
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) errors.push(`${where}.${String(cur)} must be a positive number`);
      else if (Math.round(v * 100) !== Math.round(v * 100 * 1e6) / 1e6) errors.push(`${where}.${String(cur)} has more than 2 decimals`);
    }
    for (const k of Object.keys(p)) if (!currencies.includes(k)) errors.push(`${where}: ${k} is not in currencies`);
  };

  const productIds = new Set<string>();
  const products = Array.isArray(c.products) ? c.products : [];
  if (!products.length) errors.push('products must list at least one product');
  for (const [i, p] of products.entries()) {
    const at = `products[${i}]`;
    if (!isObj(p)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) errors.push(`${at}.id must be lower-case letters, digits and dashes`);
    else if (productIds.has(p.id)) errors.push(`${at}.id ${p.id} is used twice`);
    else productIds.add(p.id);
    if (!PRODUCT_KINDS.includes(p.kind as ProductKind)) errors.push(`${at}.kind must be one of ${PRODUCT_KINDS.join(', ')}`);
    if (!isLocalised(p.name)) errors.push(`${at}.name needs "en" and "pt"`);
    if (!isLocalised(p.description)) errors.push(`${at}.description needs "en" and "pt"`);
    if (p.material !== undefined && !isLocalised(p.material)) errors.push(`${at}.material needs "en" and "pt"`);
    if (p.kind === 'framed' && (!Array.isArray(p.frameColours) || !p.frameColours.length || p.frameColours.some((x) => typeof x !== 'string')))
      errors.push(`${at}.frameColours must list at least one colour`);
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (!variants.length) errors.push(`${at}.variants must list at least one size`);
    const sizes = new Set<string>();
    for (const [j, v] of variants.entries()) {
      const vat = `${at}.variants[${j}]`;
      if (!isObj(v)) {
        errors.push(`${vat} must be an object`);
        continue;
      }
      if (!SIZES.includes(v.size as Size)) errors.push(`${vat}.size must be one of ${SIZES.join(', ')}`);
      else if (sizes.has(v.size as string)) errors.push(`${vat}.size ${String(v.size)} is listed twice`);
      sizes.add(v.size as string);
      checkPrices(v.prices, `${vat}.prices`, false);
      if (v.skus !== undefined) {
        if (!isObj(v.skus)) errors.push(`${vat}.skus must be an object`);
        else for (const [route, sku] of Object.entries(v.skus)) {
          if (!FULFILMENT_ROUTES.includes(route as FulfilmentRoute)) errors.push(`${vat}.skus: unknown route ${route}`);
          if (typeof sku !== 'string' || !sku) errors.push(`${vat}.skus.${route} must be a product code`);
        }
      }
    }
  }

  const markets = Array.isArray(c.markets) ? c.markets : [];
  if (!markets.length) errors.push('markets must list at least one market');
  const seenCountries = new Map<string, string>();
  let hasWildcard = false;
  for (const [i, m] of markets.entries()) {
    const at = `markets[${i}]`;
    if (!isObj(m)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (typeof m.id !== 'string' || !m.id) errors.push(`${at}.id is required`);
    if (typeof m.name !== 'string' || !m.name) errors.push(`${at}.name is required`);
    if (!currencies.includes(m.currency)) errors.push(`${at}.currency must be one of currencies`);
    if (!FULFILMENT_ROUTES.includes(m.fulfilment as FulfilmentRoute)) errors.push(`${at}.fulfilment must be one of ${FULFILMENT_ROUTES.join(', ')}`);
    const countries = Array.isArray(m.countries) ? m.countries : [];
    if (!countries.length) errors.push(`${at}.countries must list at least one country (or "*")`);
    for (const cc of countries) {
      if (cc === '*') {
        if (hasWildcard) errors.push(`${at}: only one market may use "*"`);
        hasWildcard = true;
      } else if (typeof cc !== 'string' || !COUNTRY_RE.test(cc)) errors.push(`${at}.countries: ${String(cc)} is not a two-letter country code`);
      else if (seenCountries.has(cc)) errors.push(`${at}.countries: ${cc} is already in market ${seenCountries.get(cc)}`);
      else seenCountries.set(cc, String(m.id));
    }
    if (m.products !== undefined) {
      if (!Array.isArray(m.products)) errors.push(`${at}.products must be a list of product ids`);
      else for (const id of m.products) if (!productIds.has(id as string)) errors.push(`${at}.products: unknown product ${String(id)}`);
    }
    if (m.shipping !== undefined) {
      if (!isObj(m.shipping)) errors.push(`${at}.shipping must be an object`);
      else
        for (const [kind, table] of Object.entries(m.shipping)) {
          if (!PRODUCT_KINDS.includes(kind as ProductKind)) errors.push(`${at}.shipping: unknown product kind ${kind}`);
          checkPrices(table, `${at}.shipping.${kind}`, true);
        }
    }
    // Every physical product sold in a market that goes to a partner needs that partner's SKU.
    if (m.fulfilment === 'prodigi') {
      for (const p of products) {
        if (!isObj(p) || p.kind === 'digital') continue;
        if (Array.isArray(m.products) && !m.products.includes(p.id)) continue;
        for (const v of Array.isArray(p.variants) ? p.variants : []) {
          if (isObj(v) && !(isObj(v.skus) && typeof v.skus.prodigi === 'string'))
            errors.push(`${at}: product ${String(p.id)} ${String(v.size)} has no "prodigi" SKU but this market is fulfilled by Prodigi`);
        }
      }
    }
  }
  if (!hasWildcard) errors.push('one market must use "*" for every other country');
  return errors;
}

/** Throws with every problem listed if the catalogue is invalid. */
export function parseCatalogue(c: unknown): Catalogue {
  const errors = validateCatalogue(c);
  if (errors.length) throw new Error(`Invalid catalogue:\n  ${errors.join('\n  ')}`);
  return c as Catalogue;
}

/** The market a country belongs to (falls back to the "*" market). */
export function marketFor(cat: Catalogue, country: string): Market {
  const cc = country.toUpperCase();
  return cat.markets.find((m) => m.countries.includes(cc)) ?? cat.markets.find((m) => m.countries.includes('*'))!;
}

export const productById = (cat: Catalogue, id: string) => cat.products.find((p) => p.id === id);

/** Major units (349.9) → minor units (34990). All three currencies have 2 decimals. */
export const toMinor = (major: number) => Math.round(major * 100);

export function formatMoney(minor: number, currency: Currency, locale = currency === 'BRL' ? 'pt-BR' : currency === 'EUR' ? 'pt-PT' : 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

export interface Quote {
  productId: string;
  kind: ProductKind;
  size: Size;
  currency: Currency;
  market: string;
  /** Who makes it; undefined for digital products. */
  fulfilment?: FulfilmentRoute;
  sku?: string;
  /** Minor units. */
  unitAmount: number;
  shippingAmount: number;
  totalAmount: number;
}

export class QuoteError extends Error {}

/**
 * The price of a product in a size, delivered to a country, charged in a currency (default: the
 * market's). This is the only place prices are worked out; the server never trusts a price from
 * the browser.
 */
export function quote(cat: Catalogue, input: { productId: string; size: string; country: string; currency?: string }): Quote {
  const product = productById(cat, input.productId);
  if (!product) throw new QuoteError(`Unknown product ${input.productId}`);
  const variant = product.variants.find((v) => v.size === input.size);
  if (!variant) throw new QuoteError(`${product.name.en} is not sold in ${input.size}`);
  const market = marketFor(cat, input.country);
  if (market.products && !market.products.includes(product.id)) throw new QuoteError(`${product.name.en} can't be shipped to ${input.country} yet`);
  const currency = (input.currency ?? market.currency) as Currency;
  if (!cat.currencies.includes(currency)) throw new QuoteError(`Unsupported currency ${input.currency}`);
  const price = variant.prices[currency];
  if (price === undefined) throw new QuoteError(`No ${currency} price for ${product.name.en} ${variant.size}`);
  const physical = product.kind !== 'digital';
  const shipping = physical ? (market.shipping?.[product.kind]?.[currency] ?? 0) : 0;
  const unitAmount = toMinor(price);
  const shippingAmount = toMinor(shipping);
  return {
    productId: product.id,
    kind: product.kind,
    size: variant.size,
    currency,
    market: market.id,
    fulfilment: physical ? market.fulfilment : undefined,
    sku: physical ? variant.skus?.[market.fulfilment] : undefined,
    unitAmount,
    shippingAmount,
    totalAmount: unitAmount + shippingAmount,
  };
}

/** The catalogue as the shop page needs it for one country: products with prices in that market's currency. */
export function priceList(cat: Catalogue, country: string, currency?: Currency) {
  const market = marketFor(cat, country);
  const cur = currency && cat.currencies.includes(currency) ? currency : market.currency;
  return {
    market: market.id,
    currency: cur,
    placeholderPrices: cat.placeholderPrices,
    products: cat.products
      .filter((p) => !market.products || market.products.includes(p.id))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        description: p.description,
        material: p.material,
        frameColours: p.frameColours,
        variants: p.variants
          .filter((v) => v.prices[cur] !== undefined)
          .map((v) => {
            const q = quote(cat, { productId: p.id, size: v.size, country, currency: cur });
            return { size: v.size, unitAmount: q.unitAmount, shippingAmount: q.shippingAmount, totalAmount: q.totalAmount };
          }),
      })),
  };
}
export type PriceList = ReturnType<typeof priceList>;
