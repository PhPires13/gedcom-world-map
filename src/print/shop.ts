// The "Order" panel of the print designer: choose a product and size, see the price in the
// visitor's currency, enter the delivery address, then pay on Stripe Checkout. The order carries
// the design (choices only); the server re-renders the print from the tree's public view.
//
// The panel's static labels are in print.html (translated with the designer); everything written
// here (products, countries, address fields, price, messages) comes from src/i18n/messages/shop.ts
// and is written again when the language changes, keeping what the visitor chose and typed.

import type { Currency } from '../commerce/catalogue';
import { guessCountry, shop, type ShopCatalogue } from '../commerce/client';
import type { DesignSpec } from '../commerce/design';
import type { Address } from '../commerce/order';
import { esc, frameColourName, inLocale, money, t } from '../commerce/words';
import { localeTag, onLocaleChange } from '../i18n/core';
import { shopMessages, type ShopKey } from '../i18n/messages/shop';
import isoCountries from 'i18n-iso-countries';
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

type AddressField = Exclude<keyof Address, 'country'>;
const ADDRESS_FIELDS: AddressField[] = ['name', 'line1', 'line2', 'city', 'state', 'postalCode', 'phone', 'taxId'];
const POSTCODE_HINT: Record<string, string> = { BR: '00000-000', PT: '0000-000', ES: '28001', US: '10001' };

/** A country's own label for a field (addr.postalCode.BR = "CEP"), else the general one. */
function label(field: AddressField, country: string): string {
  const own = `addr.${field}.${country}`;
  return own in shopMessages.pt ? t(own as ShopKey) : t(`addr.${field}` as ShopKey);
}

/**
 * The delivery address as each country writes it: which fields show, which are required, their
 * labels in the visitor's language and a format hint. Brazil: street and number, complement and
 * bairro, state (UF), CEP and the recipient's CPF/CNPJ. Portugal: código postal, no state.
 * Spain: código postal and province.
 */
function addressForm(country: string): { key: AddressField; label: string; required: boolean; placeholder?: string }[] {
  const shown: Record<AddressField, boolean> = {
    name: true,
    line1: true,
    line2: true,
    city: true,
    state: country !== 'PT',
    postalCode: true,
    phone: true,
    taxId: country === 'BR',
  };
  const required = new Set<AddressField>(['name', 'line1', 'city', 'postalCode', ...(country === 'BR' ? (['state', 'taxId'] as const) : [])]);
  const placeholder: Partial<Record<AddressField, string>> = {
    postalCode: POSTCODE_HINT[country],
    state: country === 'BR' ? 'SP' : undefined,
    taxId: '000.000.000-00',
  };
  return ADDRESS_FIELDS.filter((k) => shown[k]).map((key) => ({ key, label: label(key, country), required: required.has(key), placeholder: placeholder[key] }));
}

/** Every country by its name in the visitor's language. */
function countryList(): { code: string; name: string }[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([localeTag()], { type: 'region' });
  } catch {
    names = undefined;
  }
  return Object.keys(isoCountries.getAlpha2Codes()).map((code) => {
    let name = code;
    try {
      name = names?.of(code) ?? code;
    } catch {
      /* the code as is */
    }
    return { code, name };
  });
}

export function initShop(host: ShopHost) {
  let cat: ShopCatalogue | undefined;
  /** The current message in the status line, kept as a function so it follows the language. */
  let statusLine: { text: () => string; error: boolean } = { text: () => '', error: false };

  function fillCountries() {
    const sel = $<HTMLSelectElement>('#shop-country');
    const chosen = sel.value;
    const countries = countryList();
    const collator = new Intl.Collator(localeTag());
    countries.sort((a, b) => collator.compare(a.name, b.name));
    const first = ['BR', 'PT', 'ES', 'IT', 'US'];
    const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
    sel.innerHTML =
      first.map((c) => `<option value="${c}">${esc(nameOf(c))}</option>`).join('') +
      '<option disabled>──────────</option>' +
      countries.filter((c) => !first.includes(c.code)).map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
    sel.value = chosen || (countries.some((c) => c.code === guessCountry()) ? guessCountry() : 'US');
  }

  /** Builds the address inputs once; `fillAddress` labels them for the country and language. */
  function buildAddress() {
    $('#shop-address').innerHTML = ADDRESS_FIELDS.map(
      (k) => `<label data-field="${k}"><span></span><input type="text" id="addr-${k}" autocomplete="${autocomplete(k)}" /></label>`,
    ).join('');
  }

  function fillAddress() {
    const form = new Map(addressForm(val('shop-country')).map((f) => [f.key, f]));
    for (const k of ADDRESS_FIELDS) {
      const el = $(`#shop-address [data-field="${k}"]`);
      const f = form.get(k);
      el.hidden = !f;
      if (!f) continue;
      el.querySelector('span')!.textContent = f.label;
      const input = el.querySelector('input')!;
      if (f.placeholder) input.placeholder = f.placeholder;
      else input.removeAttribute('placeholder');
      input.required = f.required;
    }
  }

  const status = (text: () => string, error = false) => {
    statusLine = { text, error };
    const el = $('#shop-status');
    el.textContent = text();
    el.classList.toggle('error', error);
  };
  const clearStatus = () => status(() => '');
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function fillNotice() {
    if (!cat) return;
    $('#shop-placeholder').hidden = !cat.placeholderPrices && cat.paymentMode !== 'test';
    $('#shop-placeholder').textContent = [
      cat.placeholderPrices ? t('shop.placeholderPrices') : '',
      cat.paymentMode === 'test' ? t('shop.testMode') : '',
      !cat.paymentsReady ? t('shop.paymentsOff') : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function fillProducts() {
    if (!cat) return;
    const productSel = $<HTMLSelectElement>('#shop-product');
    const prev = productSel.value;
    productSel.innerHTML = cat.products.map((p) => `<option value="${p.id}">${esc(inLocale(p.name))}</option>`).join('');
    if (cat.products.some((p) => p.id === prev)) productSel.value = prev;
  }

  async function loadCatalogue(keepCurrency = false) {
    const country = val('shop-country');
    const currency = keepCurrency ? (val('shop-currency') as Currency) : undefined;
    try {
      cat = await shop.catalogue(country, currency || undefined);
    } catch (e) {
      cat = undefined;
      $('#shop-form').hidden = true;
      const error = errorText(e);
      status(() => t('shop.offline', { error }), true);
      return;
    }
    $('#shop-form').hidden = false;
    clearStatus();
    fillNotice();
    fillProducts();
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
    const frameSel = $<HTMLSelectElement>('#shop-frame');
    const prevFrame = frameSel.value;
    // The value stays the catalogue's colour id (sent with the order); the text is translated.
    frameSel.innerHTML = (p.frameColours ?? []).map((c) => `<option value="${esc(c)}">${esc(frameColourName(c))}</option>`).join('');
    if ((p.frameColours ?? []).includes(prevFrame)) frameSel.value = prevFrame;
    $('#shop-desc').textContent = [inLocale(p.description), p.material && inLocale(p.material)].filter(Boolean).join(' · ');
    $('#shop-address').hidden = p.kind === 'digital';
    fillAddress();
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
    const extra =
      p.kind === 'digital'
        ? t('shop.price.download')
        : v.shippingAmount
          ? t('shop.price.shippingIncl', { amount: money(v.shippingAmount, cur) })
          : t('shop.price.shippingIncluded');
    $('#shop-price').innerHTML = `<b>${esc(money(v.totalAmount, cur))}</b> · ${esc(extra)}`;
    if (p.kind !== 'digital') host.setPaper(v.size as PaperSize);
  }

  async function buy() {
    const design = host.design();
    if (!design || !cat) return;
    const p = cat.products.find((x) => x.id === val('shop-product'))!;
    const country = val('shop-country');
    const email = val('shop-email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status(() => t('shop.needEmail'), true);
    let shippingAddress: Address | undefined;
    if (p.kind !== 'digital') {
      const form = addressForm(country);
      const a = Object.fromEntries(form.map((f) => [f.key, val(`addr-${f.key}`) || undefined])) as Partial<Address>;
      shippingAddress = { ...(a as Address), country };
      if (country === 'BR' && !shippingAddress.taxId) return status(() => t('shop.needTaxId'), true);
      const missing = form.filter((f) => f.required && !a[f.key]).map((f) => f.key);
      if (missing.length) return status(() => t('shop.needAddress', { fields: missing.map((k) => label(k, country)).join(', ') }), true);
    }
    const button = $<HTMLButtonElement>('#shop-buy');
    button.disabled = true;
    try {
      status(() => t('shop.saving'));
      const { treeId, personId } = await host.serverTree();
      const selection = { ...design.selection, rootId: design.selection.rootId ? personId(design.selection.rootId) : undefined };
      status(() => t('shop.creating'));
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
        status(() => t('shop.savedNoPayments', { number: order.number }), true);
        window.location.href = `./order.html?id=${order.id}`;
        return;
      }
      status(() => t('shop.opening'));
      const { url } = await shop.checkout(order.id);
      window.location.href = url;
    } catch (e) {
      // Server error messages are in English; shown as they come.
      const error = errorText(e);
      status(() => t('shop.orderError', { error }), true);
      button.disabled = false;
    }
  }

  fillCountries();
  buildAddress();
  fillAddress();

  onLocaleChange(() => {
    fillCountries();
    fillNotice();
    fillProducts();
    fillProduct(); // description, frame colours, address labels, price
    fillAddress(); // also for a digital product, so the form is ready if they switch
    status(statusLine.text, statusLine.error);
  });

  $('#shop-country').addEventListener('change', () => {
    fillAddress();
    void loadCatalogue();
  });
  $('#shop-currency').addEventListener('change', () => void loadCatalogue(true));
  $('#shop-product').addEventListener('change', fillProduct);
  $('#shop-size').addEventListener('change', fillPrice);
  $('#shop-buy').addEventListener('click', () => void buy());
  void loadCatalogue();
}

function autocomplete(k: AddressField): string {
  return (
    { name: 'name', line1: 'address-line1', line2: 'address-line2', city: 'address-level2', state: 'address-level1', postalCode: 'postal-code', phone: 'tel', taxId: 'off' } as Record<string, string>
  )[k];
}
