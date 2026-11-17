// The "Order" panel of the print designer: choose a product and size, see the price in the
// visitor's currency, enter the delivery address, then pay on Stripe Checkout. The order carries
// the design (choices only); the server re-renders the print from the tree's public view.
//
// Also: a printed map can be sent as a gift (a card with a message, no prices in the parcel, the
// recipient's address), a gift card code can pay for a map (all of it, or Checkout takes the rest),
// and gift cards themselves are bought here (no design needed). Digital buyers are shown the framed
// version; physical orders say they include the digital file.
//
// The panel's static labels are in print.html (translated with the designer); everything written
// here (products, countries, address fields, price, messages, and the gift / gift card fields this
// file adds to the panel) comes from src/i18n/messages/shop.ts and is written again when the
// language changes, keeping what the visitor chose and typed.

import { isPhysical, type Currency } from '../commerce/catalogue';
import { guessCountry, shop, type GiftCardCheck, type ShopCatalogue } from '../commerce/client';
import type { DesignSpec } from '../commerce/design';
import { GIFT_MESSAGE_MAX, normaliseGiftCode } from '../commerce/gift';
import type { Address } from '../commerce/order';
import { esc, frameColourName, inLocale, money, t } from '../commerce/words';
import { currentLocale, localeTag, makeT, onLocaleChange } from '../i18n/core';
import { printMessages } from '../i18n/messages/print';
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
const checked = (id: string) => $<HTMLInputElement>(`#${id}`).checked;
const tPrint = makeT(printMessages);
const CHECK_STYLE = 'display:flex;gap:6px;align-items:center;color:var(--fg);margin:10px 0 6px';

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

/**
 * The panel's extra fields, added next to print.html's static ones (so the designer's page needs no
 * change): the upsell line under the price, the gift fields before the address, the gift card code
 * before the Buy button. Their words are written by `fillExtras`.
 */
function buildExtras() {
  $('#shop-price').insertAdjacentHTML(
    'afterend',
    `<p id="shop-upsell" class="small" hidden><span></span> <button type="button" class="btn" id="shop-upsell-see" hidden></button></p>`,
  );
  $('#shop-address').insertAdjacentHTML(
    'beforebegin',
    `<div id="shop-gift-wrap" hidden>
      <label style="${CHECK_STYLE}"><input type="checkbox" id="shop-gift" /><span data-w="shop.gift.toggle"></span></label>
      <div id="shop-gift-fields" hidden>
        <p class="muted small" data-w="shop.gift.hint"></p>
        <label><span data-w="shop.gift.recipient"></span><input type="text" id="shop-gift-recipient" maxlength="100" autocomplete="off" /></label>
        <label><span data-w="shop.gift.message"></span><textarea id="shop-gift-message" rows="4" maxlength="${GIFT_MESSAGE_MAX}"></textarea>
          <span id="shop-gift-count" class="small"></span></label>
      </div>
    </div>`,
  );
  $('#shop-buy').insertAdjacentHTML(
    'beforebegin',
    `<div id="shop-redeem-wrap" hidden>
      <label style="${CHECK_STYLE}"><input type="checkbox" id="shop-redeem" /><span data-w="shop.giftCard.toggle"></span></label>
      <div id="shop-redeem-fields" hidden>
        <label><span data-w="shop.giftCard.code"></span>
          <span class="row" style="flex-wrap:nowrap"><input type="text" id="shop-redeem-code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" style="text-transform:uppercase" />
          <button type="button" class="btn" id="shop-redeem-apply" data-w="shop.giftCard.apply" style="margin-top:4px"></button></span></label>
        <p id="shop-redeem-status" class="small"></p>
      </div>
    </div>`,
  );
  // Gift cards can also be bought without a tree.
  $('#shop-status').insertAdjacentHTML('afterend', `<p class="small"><a href="./gift-card.html" data-w="shop.giftCard.buyPage"></a></p>`);
}

function fillExtras() {
  for (const el of document.querySelectorAll<HTMLElement>('#shop [data-w]')) el.textContent = t(el.dataset.w as ShopKey);
  $<HTMLInputElement>('#shop-gift-recipient').placeholder = t('shop.gift.recipientPlaceholder');
  $<HTMLTextAreaElement>('#shop-gift-message').placeholder = t('shop.gift.messagePlaceholder');
}

export function initShop(host: ShopHost) {
  let cat: ShopCatalogue | undefined;
  /** The gift card checked with Apply (the server checks it again, under a lock, when ordering). */
  let giftCard: { code: string; check: GiftCardCheck } | undefined;
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
    // A gift goes to the recipient: the name field is theirs.
    if (checked('shop-gift') && form.has('name')) form.get('name')!.label = t('shop.gift.addressName');
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
    if (giftCard && checked('shop-redeem')) void applyGiftCard(); // the card is in one currency: check it again
    fillNotice();
    fillProducts();
    const curSel = $<HTMLSelectElement>('#shop-currency');
    curSel.innerHTML = (['BRL', 'EUR', 'USD'] as const).map((c) => `<option${c === cat!.currency ? ' selected' : ''}>${c}</option>`).join('');
    fillProduct();
  }

  const product = () => cat?.products.find((x) => x.id === val('shop-product'));

  function fillProduct() {
    const p = product();
    if (!p) return;
    const giftcard = p.kind === 'giftcard';
    const sizeSel = $<HTMLSelectElement>('#shop-size');
    const prev = sizeSel.value;
    // A gift card's "sizes" are its values: show the amount (the value stays the tier id).
    sizeSel.innerHTML = p.variants.map((v) => `<option value="${v.size}">${giftcard ? esc(money(v.totalAmount, cat!.currency)) : v.size}</option>`).join('');
    if (p.variants.some((v) => v.size === prev)) sizeSel.value = prev;
    const sizeLabel = sizeSel.closest('label')!.querySelector('span')!;
    if (giftcard) sizeLabel.removeAttribute('data-i18n');
    else sizeLabel.setAttribute('data-i18n', 'shop.size');
    sizeLabel.textContent = giftcard ? t('shop.giftCard.value') : tPrint('shop.size');
    $('#shop-frame-wrap').hidden = p.kind !== 'framed';
    const frameSel = $<HTMLSelectElement>('#shop-frame');
    const prevFrame = frameSel.value;
    // The value stays the catalogue's colour id (sent with the order); the text is translated.
    frameSel.innerHTML = (p.frameColours ?? []).map((c) => `<option value="${esc(c)}">${esc(frameColourName(c))}</option>`).join('');
    if ((p.frameColours ?? []).includes(prevFrame)) frameSel.value = prevFrame;
    $('#shop-desc').textContent = [
      inLocale(p.description),
      p.material && inLocale(p.material),
      giftcard ? t('shop.giftCard.buyHint', { currency: cat!.currency }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    $('#shop-address').hidden = !isPhysical(p.kind);
    $('#shop-gift-wrap').hidden = !isPhysical(p.kind);
    $('#shop-gift-fields').hidden = !checked('shop-gift');
    $('#shop-redeem-wrap').hidden = giftcard;
    $('#shop-redeem-fields').hidden = !checked('shop-redeem');
    fillAddress();
    fillPrice();
  }

  /** Under the price: digital → the framed version (which includes the file); physical → "includes the file". */
  function fillUpsell() {
    const p = product();
    const box = $('#shop-upsell');
    const see = $<HTMLButtonElement>('#shop-upsell-see');
    const framed = cat?.products.find((x) => x.kind === 'framed' && x.variants.length);
    box.hidden = !p || p.kind === 'giftcard' || (p.kind === 'digital' && !framed);
    see.hidden = true;
    if (box.hidden || !p || !cat) return;
    if (p.kind === 'digital' && framed) {
      const from = Math.min(...framed.variants.map((v) => v.totalAmount));
      box.querySelector('span')!.textContent = t('shop.upsell.framed', { amount: money(from, cat.currency) });
      see.textContent = t('shop.upsell.see');
      see.dataset.product = framed.id;
      see.hidden = false;
    } else box.querySelector('span')!.textContent = t('shop.includesDigital');
  }

  /** The gift card line: what it takes off, or why it can't be used. */
  function fillGiftCard() {
    const el = $('#shop-redeem-status');
    const p = product();
    const v = p?.variants.find((x) => x.size === val('shop-size'));
    el.classList.remove('error');
    if (!giftCard || !checked('shop-redeem') || !cat || !p || !v || p.kind === 'giftcard') {
      el.textContent = '';
      return;
    }
    const c = giftCard.check;
    if (!c.valid) {
      el.classList.add('error');
      el.textContent =
        c.reason === 'used' ? t('shop.giftCard.used') : c.reason === 'currency' ? t('shop.giftCard.currency', { currency: c.currency ?? '' }) : t('shop.giftCard.unknown');
      return;
    }
    const due = Math.max(0, v.totalAmount - c.amount);
    const cur = cat.currency as Currency;
    el.textContent = due
      ? t('shop.giftCard.applied', { amount: money(c.amount, cur), due: money(due, cur) })
      : t('shop.giftCard.covers', { amount: money(c.amount, cur) });
  }

  async function applyGiftCard() {
    const code = normaliseGiftCode(val('shop-redeem-code'));
    if (!code || !cat) return;
    const el = $('#shop-redeem-status');
    el.classList.remove('error');
    el.textContent = t('shop.giftCard.checking');
    try {
      giftCard = { code, check: await shop.checkGiftCard(code, cat.currency) };
    } catch (e) {
      giftCard = undefined;
      el.classList.add('error');
      el.textContent = errorText(e);
      return;
    }
    fillGiftCard();
  }

  function fillGiftCount() {
    $('#shop-gift-count').textContent = t('shop.gift.count', { count: $<HTMLTextAreaElement>('#shop-gift-message').value.length, max: GIFT_MESSAGE_MAX });
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
      p.kind === 'giftcard'
        ? t('shop.price.giftCard')
        : p.kind === 'digital'
        ? t('shop.price.download')
        : v.shippingAmount
          ? t('shop.price.shippingIncl', { amount: money(v.shippingAmount, cur) })
          : t('shop.price.shippingIncluded');
    $('#shop-price').innerHTML = `<b>${esc(money(v.totalAmount, cur))}</b> · ${esc(extra)}`;
    if (isPhysical(p.kind)) host.setPaper(v.size as PaperSize);
    fillUpsell();
    fillGiftCard();
  }

  async function buy() {
    if (!cat) return;
    const p = cat.products.find((x) => x.id === val('shop-product'))!;
    // A gift card needs no tree; a map needs the design as it stands.
    const design = p.kind === 'giftcard' ? undefined : host.design();
    if (!design && p.kind !== 'giftcard') return;
    const country = val('shop-country');
    const email = val('shop-email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status(() => t('shop.needEmail'), true);
    let shippingAddress: Address | undefined;
    if (isPhysical(p.kind)) {
      const form = addressForm(country);
      const a = Object.fromEntries(form.map((f) => [f.key, val(`addr-${f.key}`) || undefined])) as Partial<Address>;
      shippingAddress = { ...(a as Address), country };
      if (country === 'BR' && !shippingAddress.taxId) return status(() => t('shop.needTaxId'), true);
      const missing = form.filter((f) => f.required && !a[f.key]).map((f) => f.key);
      if (missing.length) return status(() => t('shop.needAddress', { fields: missing.map((k) => label(k, country)).join(', ') }), true);
    }
    const gift =
      isPhysical(p.kind) && checked('shop-gift')
        ? { recipientName: val('shop-gift-recipient') || undefined, message: $<HTMLTextAreaElement>('#shop-gift-message').value.trim() || undefined }
        : undefined;
    if ((gift?.message?.length ?? 0) > GIFT_MESSAGE_MAX) return status(() => t('shop.gift.tooLong', { max: GIFT_MESSAGE_MAX }), true);
    const giftCardCode = p.kind !== 'giftcard' && checked('shop-redeem') ? normaliseGiftCode(val('shop-redeem-code')) || undefined : undefined;
    const button = $<HTMLButtonElement>('#shop-buy');
    button.disabled = true;
    try {
      let map: { treeId: string; design: unknown } | undefined;
      if (design) {
        status(() => t('shop.saving'));
        const { treeId, personId } = await host.serverTree();
        const selection = { ...design.selection, rootId: design.selection.rootId ? personId(design.selection.rootId) : undefined };
        map = { treeId, design: { ...design, selection } };
      }
      status(() => t('shop.creating'));
      const order = await shop.createOrder({
        ...map,
        productId: p.id,
        size: val('shop-size'),
        frameColour: p.kind === 'framed' ? val('shop-frame') : undefined,
        country,
        currency: val('shop-currency') as Currency,
        email,
        shippingAddress,
        gift,
        giftCardCode,
        lang: currentLocale(),
      });
      if (order.paid) {
        // A gift card paid for all of it: no Checkout.
        status(() => t('shop.paidWithGiftCard'));
        window.location.href = `./order.html?id=${order.id}`;
        return;
      }
      if (!cat.paymentsReady) {
        status(() => t('shop.savedNoPayments', { number: order.number }), true);
        window.location.href = `./order.html?id=${order.id}`;
        return;
      }
      status(() => t('shop.opening'));
      const res = await shop.checkout(order.id);
      window.location.href = 'url' in res ? res.url : `./order.html?id=${order.id}`;
    } catch (e) {
      // Server error messages are in English; shown as they come.
      const error = errorText(e);
      status(() => t('shop.orderError', { error }), true);
      button.disabled = false;
    }
  }

  fillCountries();
  buildAddress();
  buildExtras();
  fillExtras();
  fillGiftCount();
  fillAddress();

  onLocaleChange(() => {
    fillExtras();
    fillGiftCount();
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
  $('#shop-upsell-see').addEventListener('click', (e) => {
    $<HTMLSelectElement>('#shop-product').value = (e.currentTarget as HTMLElement).dataset.product ?? '';
    fillProduct();
  });
  $('#shop-gift').addEventListener('change', () => {
    $('#shop-gift-fields').hidden = !checked('shop-gift');
    fillAddress();
  });
  $('#shop-gift-message').addEventListener('input', fillGiftCount);
  $('#shop-redeem').addEventListener('change', () => {
    $('#shop-redeem-fields').hidden = !checked('shop-redeem');
    fillGiftCard();
  });
  $('#shop-redeem-apply').addEventListener('click', () => void applyGiftCard());
  $('#shop-redeem-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void applyGiftCard();
    }
  });
  $('#shop-redeem-code').addEventListener('input', () => {
    giftCard = undefined;
    fillGiftCard();
  });
  $('#shop-buy').addEventListener('click', () => void buy());
  void loadCatalogue();
}

function autocomplete(k: AddressField): string {
  return (
    { name: 'name', line1: 'address-line1', line2: 'address-line2', city: 'address-level2', state: 'address-level1', postalCode: 'postal-code', phone: 'tel', taxId: 'off' } as Record<string, string>
  )[k];
}
