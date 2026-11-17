// The gift card page (gift-card.html): buy a vale-presente without loading a family tree. The
// order needs no design; once it is paid the order page shows the code (server/commerce/giftcards.ts).
// The designer's buy panel sells the same product once a tree is loaded.

import './shop.css';
import { currentLocale, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import type { Currency } from './catalogue';
import { guessCountry, shop, type ShopCatalogue } from './client';
import { esc, money, t } from './words';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const country = guessCountry();
let cat: ShopCatalogue | undefined;
let statusLine: { text: () => string; error: boolean } = { text: () => '', error: false };

const status = (text: () => string, error = false) => {
  statusLine = { text, error };
  $('#gc-status').textContent = text();
  $('#gc-status').classList.toggle('error', error);
};

const card = () => cat?.products.find((p) => p.kind === 'giftcard');

function fill() {
  document.title = t('gc.pageTitle');
  translateStatic(document, t);
  status(statusLine.text, statusLine.error);
  if (!cat) return;
  const p = card();
  $('#gc-form').hidden = !p;
  $('#gc-notice').hidden = !cat.placeholderPrices && cat.paymentMode !== 'test' && cat.paymentsReady;
  $('#gc-notice').textContent = [
    cat.placeholderPrices ? t('shop.placeholderPrices') : '',
    cat.paymentMode === 'test' ? t('shop.testMode') : '',
    !cat.paymentsReady ? t('shop.paymentsOff') : '',
    !p ? t('gc.unavailable') : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!p) return;
  const sel = $<HTMLSelectElement>('#gc-currency');
  sel.innerHTML = (['BRL', 'EUR', 'USD'] as const).map((c) => `<option${c === cat!.currency ? ' selected' : ''}>${c}</option>`).join('');
  const chosen = document.querySelector<HTMLInputElement>('#gc-values input:checked')?.value ?? p.variants[1]?.size ?? p.variants[0]?.size;
  $('#gc-values').innerHTML = p.variants
    .map(
      (v) =>
        `<label><input type="radio" name="gc-value" value="${v.size}"${v.size === chosen ? ' checked' : ''} /><span>${esc(money(v.totalAmount, cat!.currency))}</span></label>`,
    )
    .join('');
  $('#gc-hint').textContent = t('shop.giftCard.buyHint', { currency: cat.currency });
}

async function load(currency?: string) {
  try {
    cat = await shop.catalogue(country, currency);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    status(() => t('shop.offline', { error }), true);
    return;
  }
  fill();
}

async function buy() {
  const p = card();
  const size = document.querySelector<HTMLInputElement>('#gc-values input:checked')?.value;
  if (!cat || !p || !size) return;
  const email = $<HTMLInputElement>('#gc-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status(() => t('shop.needEmail'), true);
  const button = $<HTMLButtonElement>('#gc-buy');
  button.disabled = true;
  try {
    status(() => t('shop.creating'));
    const order = await shop.createOrder({ productId: p.id, size, country, currency: cat.currency as Currency, email, lang: currentLocale() });
    if (!cat.paymentsReady) {
      status(() => t('shop.savedNoPayments', { number: order.number }), true);
      location.href = `./order.html?id=${order.id}`;
      return;
    }
    status(() => t('shop.opening'));
    const res = await shop.checkout(order.id);
    location.href = 'url' in res ? res.url : `./order.html?id=${order.id}`;
  } catch (e) {
    // Server error messages are in English; shown as they come.
    const error = e instanceof Error ? e.message : String(e);
    status(() => t('shop.orderError', { error }), true);
    button.disabled = false;
  }
}

mountLanguageSwitcher($('#lang'));
onLocaleChange(fill);
fill();
$('#gc-currency').addEventListener('change', (e) => void load((e.target as HTMLSelectElement).value));
$('#gc-buy').addEventListener('click', () => void buy());
void load();
