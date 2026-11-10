// The customer's order page (order.html?id=…), where Stripe Checkout returns to. It follows the
// order while payment clears and the print file is made, then shows the download (digital) or the
// delivery progress (prints).

import './shop.css';
import { BORDERS, FINISHES, LAYOUTS } from '../print/catalog';
import { STYLES } from '../print/styles';
import { formatMoney } from './catalogue';
import { describeDesign } from './design';
import { shop } from './client';
import type { OrderDetail } from './order';
import { STATUS_LABELS, type OrderStatus } from './status';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const from = params.get('from');
const box = document.querySelector<HTMLElement>('#order')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const PRODUCT = { digital: 'Digital heritage map', print: 'Fine-art print', framed: 'Framed fine-art print' };

function steps(o: OrderDetail): OrderStatus[] {
  return o.kind === 'digital' ? ['created', 'paid', 'file_ready', 'delivered'] : ['created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered'];
}

function badge(s: OrderStatus) {
  const cls = s === 'delivered' ? 'ok' : s === 'cancelled' || s === 'refunded' ? 'bad' : s === 'created' ? 'warn' : '';
  return `<span class="badge ${cls}">${STATUS_LABELS[s].en}</span>`;
}

function render(o: OrderDetail) {
  const order = steps(o);
  const at = order.indexOf(o.status);
  const ended = o.status === 'cancelled' || o.status === 'refunded';
  const stepList = ended
    ? ''
    : `<ol class="steps">${order.map((s, i) => `<li class="${i < at || o.status === 'delivered' ? 'done' : i === at ? 'now' : ''}">${STATUS_LABELS[s].en}</li>`).join('')}</ol>`;
  const waiting =
    o.status === 'created' && from === 'checkout'
      ? '<p class="note">Payment received by Stripe; confirming it… (Pix and boleto payments can take a little while.)</p>'
      : o.status === 'paid'
        ? '<p class="note">Paid, thank you! We’re drawing your map at 300 dpi; this takes under a minute.</p>'
        : '';
  const actions =
    o.status === 'created'
      ? `<div class="row"><button class="btn primary" id="pay">${from === 'cancel' ? 'Try paying again' : 'Pay now'}</button><button class="btn" id="cancel">Cancel order</button></div>`
      : '';
  const downloads = o.downloads
    ? `<h2>Your files</h2><div class="row">${o.downloads.pdf ? `<a class="btn primary" href="${esc(o.downloads.pdf)}">Download PDF</a>` : ''}${o.downloads.png ? `<a class="btn" href="${esc(o.downloads.png)}">Download PNG (300 dpi)</a>` : ''}</div>
       <p class="muted small">Links work until ${new Date(o.downloads.expiresAt).toLocaleString()}; this page always has fresh ones.</p>`
    : '';
  const tracking = o.tracking.length
    ? `<h2>Tracking</h2><ul>${o.tracking.map((t) => `<li>${esc(t.carrier ?? '')} ${t.url ? `<a href="${esc(t.url)}">${esc(t.number ?? t.url)}</a>` : esc(t.number ?? '')}</li>`).join('')}</ul>`
    : '';
  const a = o.shippingAddress;
  const d = describeDesign(o.design, { styles: STYLES, layouts: LAYOUTS, borders: BORDERS, finishes: FINISHES });
  box.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between"><h1>Order ${esc(o.number)}</h1>${badge(o.status)}</div>
      <p class="muted">${PRODUCT[o.kind]} · ${o.size}${o.frameColour ? ` · ${esc(o.frameColour)} frame` : ''} · ${formatMoney(o.totalAmount, o.currency)}</p>
      ${waiting}${stepList}${actions}
      <p id="msg" class="error small"></p>
      ${downloads}${tracking}
      <h2>Details</h2>
      <dl>
        <dt>Map</dt><dd>${esc(o.design.title || 'Heritage map')}</dd>
        <dt>Design</dt><dd>${esc(d.style)} style · ${esc(d.layout)} layout · ${esc(d.border)} border · ${esc(d.finish)} finish</dd>
        <dt>Flags</dt><dd>${esc(d.flags)}${d.surnames ? ' · surnames on the routes' : ''}</dd>
        <dt>Price</dt><dd>${formatMoney(o.unitAmount, o.currency)}${o.shippingAmount ? ` + ${formatMoney(o.shippingAmount, o.currency)} shipping` : ''}${o.refundedAmount ? ` · refunded ${formatMoney(o.refundedAmount, o.currency)}` : ''}</dd>
        <dt>Email</dt><dd>${esc(o.email)}</dd>
        ${a ? `<dt>Deliver to</dt><dd>${esc(a.name)}, ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.postalCode)} ${esc(a.city)}, ${esc(a.country)}</dd>` : ''}
        <dt>Ordered</dt><dd>${new Date(o.createdAt).toLocaleString()}</dd>
      </dl>
      <h2>History</h2>
      <ul class="history">${o.events
        // Status changes only: the other notes are for the shop's operators. A shipping note carries tracking.
        .filter((e) => e.toStatus)
        .map((e) => `<li>${new Date(e.createdAt).toLocaleString()} · ${STATUS_LABELS[e.toStatus!].en}${e.toStatus === 'shipped' && e.note ? `: ${esc(e.note)}` : ''}</li>`)
        .join('')}</ul>
    </div>`;
  document.querySelector('#pay')?.addEventListener('click', async () => {
    try {
      location.href = (await shop.checkout(o.id)).url;
    } catch (e) {
      document.querySelector('#msg')!.textContent = String(e instanceof Error ? e.message : e);
    }
  });
  document.querySelector('#cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancel this order?')) return;
    render(await shop.cancel(o.id));
  });
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
    box.innerHTML = `<div class="card"><p class="error">Couldn’t load this order: ${esc(e instanceof Error ? e.message : String(e))}</p></div>`;
  }
}

if (id) void refresh();
else box.innerHTML = '<div class="card"><p>No order given.</p></div>';
