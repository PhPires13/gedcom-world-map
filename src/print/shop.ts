// The "Order" panel of the print designer: choose a product and size, see the price in the
// visitor's currency, enter the delivery address, then pay on Stripe Checkout. The order carries
// the design (choices only); the server re-renders the print from the tree's public view.

import { formatMoney, type Currency } from '../commerce/catalogue';
import { guessCountry, shop, type ShopCatalogue } from '../commerce/client';
import type { DesignSpec } from '../commerce/design';
import type { Address } from '../commerce/order';
import isoCountries from 'i18n-iso-countries';
import { countryName } from './countries';
import type { PaperSize } from './types';

export interface ShopHost {
  /** The design as it stands, or undefined when no tree is loaded. */
  design(): Omit<DesignSpec, 'selection'> & { selection: DesignSpec['selection'] } | undefined;
  /**
   * Makes sure the tree is saved on the server (imports a local GEDCOM file if needed) and returns
   * its id, with a function turning the designer's person ids into the server's.
   */
  serverTree(): Promise<{ treeId: string; personId: (localId: string) => string | undefined }>;
  /** Shows the chosen size in the preview. */
  setPaper(size: PaperSize): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const val = (id: string) => $<HTMLInputElement | HTMLSelectElement>(`#${id}`).value.trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ADDRESS_FIELDS: [keyof Address, string, string?][] = [
  ['name', 'Full name'],
  ['line1', 'Address'],
  ['line2', 'Address line 2 (optional)'],
  ['city', 'City'],
  ['state', 'State / region'],
  ['postalCode', 'Postcode'],
  ['phone', 'Phone (for the courier)'],
  ['taxId', 'CPF or CNPJ', 'BR'],
];

export function initShop(host: ShopHost) {
  let cat: ShopCatalogue | undefined;
  const countries = Object.keys(isoCountries.getAlpha2Codes())
    .map((code) => ({ code, name: countryName(code.toLowerCase(), 'en', code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const first = ['BR', 'PT', 'IT', 'US'];
  $('#shop-country').innerHTML =
    first.map((c) => `<option value="${c}">${esc(countryName(c.toLowerCase(), 'en', c))}</option>`).join('') +
    '<option disabled>──────────</option>' +
    countries.filter((c) => !first.includes(c.code)).map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
  $<HTMLSelectElement>('#shop-country').value = countries.some((c) => c.code === guessCountry()) ? guessCountry() : 'US';
  $('#shop-address').innerHTML = ADDRESS_FIELDS.map(
    ([k, label, only]) => `<label data-only="${only ?? ''}">${label}<input type="text" id="addr-${k}" autocomplete="${autocomplete(k)}" /></label>`,
  ).join('');

  const status = (msg: string, error = false) => {
    const el = $('#shop-status');
    el.textContent = msg;
    el.classList.toggle('error', error);
  };

  async function loadCatalogue(keepCurrency = false) {
    const country = val('shop-country');
    const currency = keepCurrency ? (val('shop-currency') as Currency) : undefined;
    try {
      cat = await shop.catalogue(country, currency || undefined);
    } catch (e) {
      cat = undefined;
      $('#shop-form').hidden = true;
      status(`The shop is offline (${e instanceof Error ? e.message : String(e)}). Start the API server with \`npm run server\`.`, true);
      return;
    }
    $('#shop-form').hidden = false;
    status('');
    $('#shop-placeholder').hidden = !cat.placeholderPrices && cat.paymentMode !== 'test';
    $('#shop-placeholder').textContent = [
      cat.placeholderPrices ? 'Prices are placeholders.' : '',
      cat.paymentMode === 'test' ? 'Payments are in Stripe test mode: no real money moves.' : '',
      !cat.paymentsReady ? 'Payments are not set up on this server.' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const productSel = $<HTMLSelectElement>('#shop-product');
    const prev = productSel.value;
    productSel.innerHTML = cat.products.map((p) => `<option value="${p.id}">${esc(p.name.en)}</option>`).join('');
    if (cat.products.some((p) => p.id === prev)) productSel.value = prev;
    const curSel = $<HTMLSelectElement>('#shop-currency');
    curSel.innerHTML = (['BRL', 'EUR', 'USD'] as const).map((c) => `<option${c === cat!.currency ? ' selected' : ''}>${c}</option>`).join('');
    fillProduct();
  }

  function fillProduct() {
    const p = cat?.products.find((x) => x.id === val('shop-product'));
    if (!p) return;
    const sizeSel = $<HTMLSelectElement>('#shop-size');
    const prev = sizeSel.value;
    sizeSel.innerHTML = p.variants.map((v) => `<option>${v.size}</option>`).join('');
    if (p.variants.some((v) => v.size === prev)) sizeSel.value = prev;
    $('#shop-frame-wrap').hidden = p.kind !== 'framed';
    $('#shop-frame').innerHTML = (p.frameColours ?? []).map((c) => `<option>${esc(c)}</option>`).join('');
    $('#shop-desc').textContent = [p.description.en, p.material?.en].filter(Boolean).join(' · ');
    const physical = p.kind !== 'digital';
    $('#shop-address').hidden = !physical;
    for (const el of document.querySelectorAll<HTMLElement>('#shop-address [data-only]')) {
      const only = el.dataset.only;
      el.hidden = !!only && only !== val('shop-country');
    }
    fillPrice();
  }

  function fillPrice() {
    const p = cat?.products.find((x) => x.id === val('shop-product'));
    const v = p?.variants.find((x) => x.size === val('shop-size'));
    if (!cat || !p || !v) {
      $('#shop-price').textContent = '';
      return;
    }
    const cur = cat.currency as Currency;
    $('#shop-price').innerHTML =
      `<b>${formatMoney(v.totalAmount, cur)}</b>` +
      (p.kind === 'digital' ? ' · download' : v.shippingAmount ? ` · incl. ${formatMoney(v.shippingAmount, cur)} shipping` : ' · shipping included');
    if (p.kind !== 'digital') host.setPaper(v.size as PaperSize);
  }

  async function buy() {
    const design = host.design();
    if (!design || !cat) return;
    const p = cat.products.find((x) => x.id === val('shop-product'))!;
    const country = val('shop-country');
    const email = val('shop-email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status('Enter your email: the receipt and download link go there.', true);
    let shippingAddress: Address | undefined;
    if (p.kind !== 'digital') {
      const a = Object.fromEntries(ADDRESS_FIELDS.map(([k]) => [k, val(`addr-${k}`) || undefined])) as unknown as Address;
      shippingAddress = { ...a, country, taxId: country === 'BR' ? a.taxId : undefined };
      const missing = (['name', 'line1', 'city', 'postalCode'] as const).filter((k) => !shippingAddress![k]);
      if (country === 'BR' && !shippingAddress.taxId) return status('Brazilian deliveries need the recipient’s CPF (or CNPJ).', true);
      if (missing.length) return status(`Fill in the delivery address (${missing.join(', ')}).`, true);
    }
    const button = $<HTMLButtonElement>('#shop-buy');
    button.disabled = true;
    try {
      status('Saving your tree so we can print it…');
      const { treeId, personId } = await host.serverTree();
      const selection = { ...design.selection, rootId: design.selection.rootId ? personId(design.selection.rootId) : undefined };
      status('Creating your order…');
      const order = await shop.createOrder({
        treeId,
        productId: p.id,
        size: val('shop-size'),
        frameColour: p.kind === 'framed' ? val('shop-frame') : undefined,
        design: { ...design, selection },
        country,
        currency: val('shop-currency') as Currency,
        email,
        shippingAddress,
      });
      if (!cat.paymentsReady) {
        status(`Order ${order.number} saved, but payments are not set up on this server.`, true);
        window.location.href = `./order.html?id=${order.id}`;
        return;
      }
      status('Opening the secure payment page…');
      const { url } = await shop.checkout(order.id);
      window.location.href = url;
    } catch (e) {
      status(`Couldn’t place the order: ${e instanceof Error ? e.message : String(e)}`, true);
      button.disabled = false;
    }
  }

  $('#shop-country').addEventListener('change', () => void loadCatalogue());
  $('#shop-currency').addEventListener('change', () => void loadCatalogue(true));
  $('#shop-product').addEventListener('change', fillProduct);
  $('#shop-size').addEventListener('change', fillPrice);
  $('#shop-buy').addEventListener('click', () => void buy());
  void loadCatalogue();
}

function autocomplete(k: keyof Address): string {
  return (
    { name: 'name', line1: 'address-line1', line2: 'address-line2', city: 'address-level2', state: 'address-level1', postalCode: 'postal-code', phone: 'tel', taxId: 'off', country: 'country' } as Record<string, string>
  )[k];
}
