// Operations (ops.html): every order with its status, print file and the actions an operator can
// take: advance a manual (Brazil) order, open its production sheet, retry, ask Prodigi, refund.

import './shop.css';
import { BORDERS, FINISHES, LAYOUTS } from '../print/catalog';
import { STYLES } from '../print/styles';
import { formatMoney } from './catalogue';
import { describeDesign } from './design';
import { shop, type OpsOrder } from './client';
import { ORDER_STATUSES, STATUS_LABELS } from './status';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const status = (msg: string, error = false) => {
  $('#ops-status').textContent = msg;
  $('#ops-status').classList.toggle('error', error);
};

$('#filter').innerHTML += ORDER_STATUSES.map((s) => `<option value="${s}">${STATUS_LABELS[s].en}</option>`).join('');

let rows: OpsOrder[] = [];
const design = (o: OpsOrder) => {
  const d = describeDesign(o.design, { styles: STYLES, layouts: LAYOUTS, borders: BORDERS, finishes: FINISHES });
  return `${d.style} · ${d.layout} · ${d.border} · ${d.finish}`;
};

function row(o: OpsOrder) {
  const a = o.shippingAddress;
  const actions = [
    o.manualNext ? `<button class="btn small primary" data-act="advance" data-id="${o.id}">Mark ${STATUS_LABELS[o.manualNext].en.toLowerCase()}</button>` : '',
    o.fulfilment === 'manual' && o.files.png ? `<a class="btn small" href="${shop.ops.sheetUrl(o.id)}" target="_blank" rel="noopener">Production sheet</a>` : '',
    o.status === 'paid' || (o.status === 'file_ready' && !o.fulfilmentStatus) ? `<button class="btn small" data-act="retry" data-id="${o.id}">Retry</button>` : '',
    o.fulfilment === 'prodigi' && o.fulfilmentRef ? `<button class="btn small" data-act="sync" data-id="${o.id}">Ask Prodigi</button>` : '',
    o.next.includes('cancelled') && o.status !== 'created' ? `<button class="btn small" data-act="cancel" data-id="${o.id}">Cancel</button>` : '',
    o.paid && o.status !== 'refunded' && o.refundedAmount < o.totalAmount ? `<button class="btn small" data-act="refund" data-id="${o.id}">Refund</button>` : '',
  ].join(' ');
  const cls = o.status === 'delivered' ? 'ok' : o.status === 'cancelled' || o.status === 'refunded' ? 'bad' : o.status === 'created' ? 'warn' : '';
  return `<tr>
    <td><b>${esc(o.number)}</b><div class="sub">${new Date(o.createdAt).toLocaleString()}</div></td>
    <td>${esc(o.productId)} ${o.size}${o.frameColour ? `<div class="sub">${esc(o.frameColour)} frame</div>` : ''}<div class="sub">${esc(design(o))}</div></td>
    <td>${esc(o.market)} · ${esc(o.fulfilment ?? 'download')}${o.fulfilmentRef ? `<div class="sub">${esc(o.fulfilmentRef)} (${esc(o.fulfilmentStatus ?? '')})</div>` : o.fulfilmentStatus ? `<div class="sub">${esc(o.fulfilmentStatus)}</div>` : ''}</td>
    <td><span class="badge ${cls}">${STATUS_LABELS[o.status].en}</span>${o.fileError ? `<div class="sub error">${esc(o.fileError)}</div>` : ''}</td>
    <td>${formatMoney(o.totalAmount, o.currency)}${o.refundedAmount ? `<div class="sub">refunded ${formatMoney(o.refundedAmount, o.currency)}</div>` : ''}</td>
    <td>${o.fileUrl ? `<a href="${esc(o.fileUrl)}">PNG</a> · <a href="${esc(o.pdfUrl ?? '')}">PDF</a><div class="sub">${o.files.widthPx}×${o.files.heightPx}</div>` : '<span class="sub">not yet</span>'}</td>
    <td>${esc(o.email)}${a ? `<div class="sub">${esc(a.name)}, ${esc(a.city)}, ${esc(a.country)}</div>` : ''}</td>
    <td><div class="row">${actions}</div></td>
  </tr>`;
}

async function load() {
  status('Loading…');
  try {
    rows = await shop.ops.list($<HTMLSelectElement>('#filter').value || undefined);
    $('#orders').innerHTML =
      '<thead><tr><th>Order</th><th>Product</th><th>Route</th><th>Status</th><th>Total</th><th>Print file</th><th>Customer</th><th>Actions</th></tr></thead>' +
      `<tbody>${rows.map(row).join('') || '<tr><td colspan="8" class="muted">No orders.</td></tr>'}</tbody>`;
    status(`${rows.length} order${rows.length === 1 ? '' : 's'}.`);
  } catch (e) {
    status(`Couldn’t load orders: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

$('#orders').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const o = rows.find((r) => r.id === b.dataset.id)!;
  b.disabled = true;
  try {
    switch (b.dataset.act) {
      case 'advance': {
        const note = o.manualNext === 'shipped' ? prompt('Tracking number or note for the customer (optional):') ?? undefined : undefined;
        await shop.ops.advance(o.id, { note: note || undefined });
        break;
      }
      case 'cancel':
        if (!confirm(`Cancel ${o.number}? Refund it separately if it was paid.`)) return;
        await shop.ops.advance(o.id, { to: 'cancelled', note: prompt('Reason (optional):') || undefined });
        break;
      case 'retry':
        await shop.ops.retry(o.id);
        break;
      case 'sync':
        await shop.ops.sync(o.id);
        break;
      case 'refund': {
        const left = o.totalAmount - o.refundedAmount;
        const input = prompt(`Refund how much of ${formatMoney(left, o.currency)}? Leave empty for all.`);
        if (input === null) return;
        const amount = input.trim() ? Math.round(Number(input.replace(',', '.')) * 100) : undefined;
        await shop.ops.refund(o.id, amount);
        break;
      }
    }
    await load();
  } catch (err) {
    status(`${o.number}: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    b.disabled = false;
  }
});
$('#filter').addEventListener('change', load);
$('#reload').addEventListener('click', load);
void load();
