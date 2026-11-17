// The customer's order page (order.html?id=…), where Stripe Checkout returns to. It follows the
// order while payment clears and the print file is made, then shows the download (digital) or the
// delivery progress (prints).

import './shop.css';
import { formatDate, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { loginUrl } from '../account/api';
import { mountAccountMenu, t as tAccount } from '../account/menu';
import { ApiError } from '../tree/api';
import { BORDERS, FINISHES, LAYOUTS } from '../print/catalog';
import { STYLES } from '../print/styles';
import { shop } from './client';
import type { OrderDetail } from './order';
import type { OrderStatus } from './status';
import { DATE_TIME, designWords, esc, frameColourName, money, productKindName, statusDescription, statusLabel, t } from './words';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const from = params.get('from');
/** The order link's key (e-mailed links): opens the order without signing in. */
const key = params.get('k');
const box = document.querySelector<HTMLElement>('#order')!;

/** What the page shows, kept so a language change re-renders it without reloading. */
let view: { order: OrderDetail } | { error: string } | { noId: true } | { signIn: true } | undefined;
let message = '';

function steps(o: OrderDetail): OrderStatus[] {
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
      : o.status === 'paid'
        ? `<p class="note">${esc(t('order.paidDrawing'))}</p>`
        : '';
  const actions =
    o.status === 'created'
      ? `<div class="row"><button class="btn primary" id="pay">${esc(t(from === 'cancel' ? 'order.payAgain' : 'order.payNow'))}</button><button class="btn" id="cancel">${esc(t('order.cancel'))}</button></div>`
      : '';
  const downloads = o.downloads
    ? `<h2>${esc(t('order.files'))}</h2><div class="row">${o.downloads.pdf ? `<a class="btn primary" href="${esc(o.downloads.pdf)}">${esc(t('order.downloadPdf'))}</a>` : ''}${o.downloads.png ? `<a class="btn" href="${esc(o.downloads.png)}">${esc(t('order.downloadPng'))}</a>` : ''}</div>
       <p class="muted small">${esc(t('order.linksUntil', { date: formatDate(o.downloads.expiresAt, DATE_TIME) }))}</p>`
    : '';
  const tracking = o.tracking.length
    ? `<h2>${esc(t('order.tracking'))}</h2><ul>${o.tracking.map((tr) => `<li>${esc(tr.carrier ?? '')} ${tr.url ? `<a href="${esc(tr.url)}">${esc(tr.number ?? tr.url)}</a>` : esc(tr.number ?? '')}</li>`).join('')}</ul>`
    : '';
  const a = o.shippingAddress;
  const d = designWords(o.design, { styles: STYLES, layouts: LAYOUTS, borders: BORDERS, finishes: FINISHES });
  const frame = o.frameColour ? ` · ${esc(t('frame.withColour', { colour: frameColourName(o.frameColour) }))}` : '';
  const price =
    money(o.unitAmount, o.currency) +
    (o.shippingAmount ? ` ${t('order.plusShipping', { amount: money(o.shippingAmount, o.currency) })}` : '') +
    (o.refundedAmount ? ` · ${t('order.refunded', { amount: money(o.refundedAmount, o.currency) })}` : '');
  const row = (key: Parameters<typeof t>[0], value: string) => `<dt>${esc(t(key))}</dt><dd>${value}</dd>`;
  box.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between"><h1>${esc(t('order.title', { number: o.number }))}</h1>${badge(o.status)}</div>
      <p class="muted">${esc(productKindName(o.kind))} · ${esc(o.size)}${frame} · ${esc(money(o.totalAmount, o.currency))}</p>
      <p class="small">${esc(statusDescription(o.status))}</p>
      ${waiting}${stepList}${actions}
      <p id="msg" class="error small">${esc(message)}</p>
      ${downloads}${tracking}
      <h2>${esc(t('order.details'))}</h2>
      <dl>
        ${row('order.map', esc(o.design.title || t('order.mapUntitled')))}
        ${row('order.style', esc(d.style))}
        ${row('order.layout', esc(d.layout))}
        ${row('order.border', esc(d.border))}
        ${row('order.finish', esc(d.finish))}
        ${row('order.routes', esc(d.routes) + (d.surnames ? ` · ${esc(t('design.surnames'))}` : ''))}
        ${row('order.flags', esc(d.flags))}
        ${row('order.price', esc(price))}
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
  document.querySelector('#pay')?.addEventListener('click', async () => {
    try {
      location.href = (await shop.checkout(o.id, key)).url;
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
      render(await shop.cancel(o.id, key));
    } catch (e) {
      message = String(e instanceof Error ? e.message : e);
      document.querySelector('#msg')!.textContent = message;
    }
  });
}

function show() {
  document.title = t('order.pageTitle');
  translateStatic(document, t);
  if (!view) return; // still loading: the static "Loading…" text was just translated
  if ('order' in view) render(view.order);
  else if ('signIn' in view)
    box.innerHTML = `<div class="card prompt"><p>${esc(tAccount('prompt.orderSignIn'))}</p><p><a class="btn primary" href="${esc(loginUrl())}">${esc(tAccount('prompt.signIn'))}</a></p></div>`;
  else if ('error' in view) box.innerHTML = `<div class="card"><p class="error">${esc(t('order.loadError', { error: view.error }))}</p></div>`;
  else box.innerHTML = `<div class="card"><p>${esc(t('order.noId'))}</p></div>`;
}

let polls = 0;
async function refresh() {
  try {
    const o = await shop.order(id, key);
    render(o);
    // Follow the order while it is moving on its own: payment clearing, the file being made.
    const moving = (o.status === 'created' && from === 'checkout') || o.status === 'paid' || (o.status === 'file_ready' && o.kind === 'digital');
    if (moving && polls++ < 120) setTimeout(refresh, 2500);
  } catch (e) {
    // Someone else's order (or nobody signed in, without the order link's key): offer to sign in.
    const hidden = e instanceof ApiError && (e.status === 404 || e.status === 401);
    view = hidden && !(await signedIn) ? { signIn: true } : { error: e instanceof Error ? e.message : String(e) };
    show();
  }
}

mountLanguageSwitcher(document.querySelector<HTMLElement>('#lang')!);
const signedIn = mountAccountMenu(document.querySelector<HTMLElement>('#account')!);
onLocaleChange(show);
show();
if (id) void refresh();
else {
  view = { noId: true };
  show();
}
