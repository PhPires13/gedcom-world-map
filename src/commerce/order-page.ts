// The customer's order page (order.html?id=…), where Stripe Checkout returns to. It follows the
// order while payment clears and the print file is made, then shows the download (digital) or the
// delivery progress (prints, which include the digital file too), or a gift card's code.

import './shop.css';
import { formatDate, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { BORDERS, FINISHES, LAYOUTS } from '../print/catalog';
import { STYLES } from '../print/styles';
import { shop } from './client';
import { amountCharged, type OrderDetail } from './order';
import type { OrderStatus } from './status';
import { DATE_TIME, designWords, esc, frameColourName, giftCardStatus, money, productKindName, statusDescription, statusLabel, t, variantName } from './words';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const from = params.get('from');
const box = document.querySelector<HTMLElement>('#order')!;

/** What the page shows, kept so a language change re-renders it without reloading. */
let view: { order: OrderDetail } | { error: string } | { noId: true } | undefined;
let message = '';

function steps(o: OrderDetail): OrderStatus[] {
  if (o.kind === 'giftcard') return ['created', 'paid', 'delivered'];
  return o.kind === 'digital' ? ['created', 'paid', 'file_ready', 'delivered'] : ['created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered'];
}

function badge(s: OrderStatus) {
  const cls = s === 'delivered' ? 'ok' : s === 'cancelled' || s === 'refunded' ? 'bad' : s === 'created' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(statusLabel(s))}</span>`;
}

function render(o: OrderDetail) {
  view = { order: o };
  const order = steps(o);
  const at = order.indexOf(o.status);
  const ended = o.status === 'cancelled' || o.status === 'refunded';
  const stepList = ended
    ? ''
    : `<ol class="steps">${order.map((s, i) => `<li class="${i < at || o.status === 'delivered' ? 'done' : i === at ? 'now' : ''}">${esc(statusLabel(s))}</li>`).join('')}</ol>`;
  const waiting =
    o.status === 'created' && from === 'checkout'
      ? `<p class="note">${esc(t('order.waitingPayment'))}</p>`
      : o.status === 'paid' && o.kind !== 'giftcard'
        ? `<p class="note">${esc(t('order.paidDrawing'))}</p>`
        : '';
  const actions =
    o.status === 'created'
      ? `<div class="row"><button class="btn primary" id="pay">${esc(t(from === 'cancel' ? 'order.payAgain' : 'order.payNow'))}</button><button class="btn" id="cancel">${esc(t('order.cancel'))}</button></div>`
      : '';
  const downloads = o.downloads
    ? `<h2>${esc(t('order.files'))}</h2>${o.kind !== 'digital' ? `<p class="small">${esc(t('order.filesIncluded'))}</p>` : ''}<div class="row">${o.downloads.pdf ? `<a class="btn primary" href="${esc(o.downloads.pdf)}">${esc(t('order.downloadPdf'))}</a>` : ''}${o.downloads.png ? `<a class="btn" href="${esc(o.downloads.png)}">${esc(t('order.downloadPng'))}</a>` : ''}</div>
       <p class="muted small">${esc(t('order.linksUntil', { date: formatDate(o.downloads.expiresAt, DATE_TIME) }))}</p>`
    : '';
  const tracking = o.tracking.length
    ? `<h2>${esc(t('order.tracking'))}</h2><ul>${o.tracking.map((tr) => `<li>${esc(tr.carrier ?? '')} ${tr.url ? `<a href="${esc(tr.url)}">${esc(tr.number ?? tr.url)}</a>` : esc(tr.number ?? '')}</li>`).join('')}</ul>`
    : '';
  const card = o.kind === 'giftcard' ? giftCardBox(o) : '';
  const a = o.shippingAddress;
  const d = o.design && designWords(o.design, { styles: STYLES, layouts: LAYOUTS, borders: BORDERS, finishes: FINISHES });
  const frame = o.frameColour ? ` · ${esc(t('frame.withColour', { colour: frameColourName(o.frameColour) }))}` : '';
  const price =
    money(o.unitAmount, o.currency) +
    (o.shippingAmount ? ` ${t('order.plusShipping', { amount: money(o.shippingAmount, o.currency) })}` : '') +
    (o.refundedAmount ? ` · ${t('order.refunded', { amount: money(o.refundedAmount, o.currency) })}` : '');
  const row = (key: Parameters<typeof t>[0], value: string) => `<dt>${esc(t(key))}</dt><dd>${value}</dd>`;
  // What was taken off and what was actually charged, once there is something to show.
  const paidRows =
    (o.giftCardAmount ? row('order.giftCardUsed', `−${esc(money(o.giftCardAmount, o.currency))}`) : '') +
    (o.discountAmount ? row('order.discount', `−${esc(money(o.discountAmount, o.currency))}`) : '') +
    ((o.giftCardAmount || o.discountAmount) && o.paid ? row('order.charged', esc(money(amountCharged(o), o.currency))) : '');
  const giftRows = o.gift
    ? row('order.giftFor', esc(o.gift.recipientName)) +
      (o.gift.message ? row('order.giftMessage', `<span class="gift-message">${esc(o.gift.message)}</span>`) : '') +
      `<dt></dt><dd class="muted small">${esc(t('order.giftNoPrices'))}</dd>`
    : '';
  const designRows = d
    ? `${row('order.map', esc(o.design!.title || t('order.mapUntitled')))}
        ${row('order.style', esc(d.style))}
        ${row('order.layout', esc(d.layout))}
        ${row('order.border', esc(d.border))}
        ${row('order.finish', esc(d.finish))}
        ${row('order.routes', esc(d.routes) + (d.surnames ? ` · ${esc(t('design.surnames'))}` : ''))}
        ${row('order.flags', esc(d.flags))}`
    : ''; // a gift card: its value is the price
  box.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between"><h1>${esc(t('order.title', { number: o.number }))}</h1>${badge(o.status)}</div>
      <p class="muted">${esc(productKindName(o.kind))} · ${esc(variantName(o))}${frame}${o.kind === 'giftcard' ? '' : ` · ${esc(money(o.totalAmount, o.currency))}`}</p>
      <p class="small">${esc(o.kind === 'giftcard' && o.status === 'delivered' ? t('order.giftCardDelivered') : statusDescription(o.status))}</p>
      ${waiting}${stepList}${actions}
      <p id="msg" class="error small">${esc(message)}</p>
      ${card}${downloads}${tracking}
      <h2>${esc(t('order.details'))}</h2>
      <dl>
        ${designRows}
        ${row('order.price', esc(price))}
        ${paidRows}
        ${giftRows}
        ${row('order.email', esc(o.email))}
        ${a ? row('order.deliverTo', `${esc(a.name)}, ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.postalCode)} ${esc(a.city)}${a.state ? ` – ${esc(a.state)}` : ''}, ${esc(a.country)}`) : ''}
        ${row('order.ordered', esc(formatDate(o.createdAt, DATE_TIME)))}
      </dl>
      <h2>${esc(t('order.history'))}</h2>
      <ul class="history">${o.events
        // Status changes only: the other notes are for the shop's operators. A shipping note carries tracking.
        .filter((e) => e.toStatus)
        .map((e) => `<li>${esc(formatDate(e.createdAt, DATE_TIME))} · ${esc(statusLabel(e.toStatus!))}${e.toStatus === 'shipped' && e.note ? `: ${esc(e.note)}` : ''}</li>`)
        .join('')}</ul>
    </div>`;
  document.querySelector('#copy-code')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(o.giftCard?.code ?? '');
      b.textContent = t('order.copied');
    } catch {
      /* the code stays selectable on the page */
    }
  });
  document.querySelector('#pay')?.addEventListener('click', async () => {
    try {
      const res = await shop.checkout(o.id);
      if ('url' in res) location.href = res.url;
      else await refresh(); // a gift card covered it
    } catch (e) {
      // Server error messages are in English; shown as they come.
      message = String(e instanceof Error ? e.message : e);
      document.querySelector('#msg')!.textContent = message;
    }
  });
  document.querySelector('#cancel')?.addEventListener('click', async () => {
    if (!confirm(t('order.cancelConfirm'))) return;
    try {
      message = '';
      render(await shop.cancel(o.id));
    } catch (e) {
      message = String(e instanceof Error ? e.message : e);
      document.querySelector('#msg')!.textContent = message;
    }
  });
}

/** The code a gift card order bought, once paid. */
function giftCardBox(o: OrderDetail): string {
  const c = o.giftCard;
  if (!c) return o.paid && o.status !== 'refunded' && o.status !== 'cancelled' ? `<h2>${esc(t('order.giftCardTitle'))}</h2><p class="muted small">${esc(t('order.giftCardWaiting'))}</p>` : '';
  return `<h2>${esc(t('order.giftCardTitle'))}</h2>
    <div class="giftcard"><code class="giftcard-code">${esc(c.code)}</code><button class="btn small" id="copy-code">${esc(t('order.copy'))}</button></div>
    <p class="small">${esc(money(c.amount, c.currency))} · ${esc(giftCardStatus(c))}</p>
    <p class="muted small">${esc(t('order.giftCardHow', { currency: c.currency }))}</p>`;
}

function show() {
  document.title = t('order.pageTitle');
  translateStatic(document, t);
  if (!view) return; // still loading: the static "Loading…" text was just translated
  if ('order' in view) render(view.order);
  else if ('error' in view) box.innerHTML = `<div class="card"><p class="error">${esc(t('order.loadError', { error: view.error }))}</p></div>`;
  else box.innerHTML = `<div class="card"><p>${esc(t('order.noId'))}</p></div>`;
}

let polls = 0;
async function refresh() {
  try {
    const o = await shop.order(id);
    render(o);
    // Follow the order while it is moving on its own: payment clearing, the file being made.
    const moving = (o.status === 'created' && from === 'checkout') || o.status === 'paid' || (o.status === 'file_ready' && o.kind === 'digital');
    if (moving && polls++ < 120) setTimeout(refresh, 2500);
  } catch (e) {
    view = { error: e instanceof Error ? e.message : String(e) };
    show();
  }
}

mountLanguageSwitcher(document.querySelector<HTMLElement>('#lang')!);
onLocaleChange(show);
show();
if (id) void refresh();
else {
  view = { noId: true };
  show();
}
