// Operations (ops.html): every order with its status, print file and the actions an operator can
// take: advance a manual (Brazil) order, open its production sheet, retry, ask Prodigi, refund.

import './shop.css';
import { formatDate, formatNumber, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { loginUrl, type Me } from '../account/api';
import { mountAccountMenu, t as tAccount } from '../account/menu';
import { ApiError } from '../tree/api';
import { BORDERS, FINISHES, LAYOUTS } from '../print/catalog';
import { STYLES } from '../print/styles';
import { shop, type OpsOrder } from './client';
import { ORDER_STATUSES, type OrderStatus } from './status';
import { DATE_TIME, designWords, esc, frameColourName, money, productKindName, statusLabel, t } from './words';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The status line, kept as a function so it is re-written in a new language. */
let statusLine: { text: () => string; error: boolean } = { text: () => '', error: false };
const status = (text: () => string, error = false) => {
  statusLine = { text, error };
  $('#ops-status').textContent = text();
  $('#ops-status').classList.toggle('error', error);
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let rows: OpsOrder[] | undefined;
/** Why the orders can't be shown: nobody signed in (401) or not an operator (403). */
let denied: { status: 401 } | { status: 403; me?: Me } | undefined;

function renderPrompt() {
  const box = $('#ops-prompt');
  box.hidden = !denied;
  $('.table-wrap').hidden = !!denied;
  if (!denied) return;
  const text = denied.status === 401 ? tAccount('prompt.opsSignIn') : tAccount('prompt.opsForbidden', { email: denied.me?.email ?? '?' });
  const label = denied.status === 401 ? tAccount('prompt.signIn') : tAccount('prompt.otherAccount');
  box.innerHTML = `<p>${esc(text)}</p><p><a class="btn primary" href="${esc(loginUrl('/ops.html'))}">${esc(label)}</a></p>`;
}
const design = (o: OpsOrder) => {
  const d = designWords(o.design, { styles: STYLES, layouts: LAYOUTS, borders: BORDERS, finishes: FINISHES });
  return `${d.style} · ${d.layout} · ${d.border} · ${d.finish}`;
};

const MARK: Partial<Record<OrderStatus, Parameters<typeof t>[0]>> = {
  sent_to_production: 'ops.mark.sent_to_production',
  shipped: 'ops.mark.shipped',
  delivered: 'ops.mark.delivered',
};
const markLabel = (s: OrderStatus) => (MARK[s] ? t(MARK[s]!) : t('ops.markAs', { status: statusLabel(s) }));

const routeName = (r: string) => (r === 'manual' ? t('ops.route.manual') : r === 'prodigi' ? t('ops.route.prodigi') : r === 'download' ? t('ops.route.download') : r);

function row(o: OpsOrder) {
  const a = o.shippingAddress;
  const actions = [
    o.manualNext ? `<button class="btn small primary" data-act="advance" data-id="${o.id}">${esc(markLabel(o.manualNext))}</button>` : '',
    o.fulfilment === 'manual' && o.files.png ? `<a class="btn small" href="${shop.ops.sheetUrl(o.id)}" target="_blank" rel="noopener">${esc(t('ops.sheet'))}</a>` : '',
    o.status === 'paid' || (o.status === 'file_ready' && !o.fulfilmentStatus) ? `<button class="btn small" data-act="retry" data-id="${o.id}">${esc(t('ops.retry'))}</button>` : '',
    o.fulfilment === 'prodigi' && o.fulfilmentRef ? `<button class="btn small" data-act="sync" data-id="${o.id}">${esc(t('ops.sync'))}</button>` : '',
    o.next.includes('cancelled') && o.status !== 'created' ? `<button class="btn small" data-act="cancel" data-id="${o.id}">${esc(t('ops.cancel'))}</button>` : '',
    o.paid && o.status !== 'refunded' && o.refundedAmount < o.totalAmount ? `<button class="btn small" data-act="refund" data-id="${o.id}">${esc(t('ops.refund'))}</button>` : '',
  ].join(' ');
  const cls = o.status === 'delivered' ? 'ok' : o.status === 'cancelled' || o.status === 'refunded' ? 'bad' : o.status === 'created' ? 'warn' : '';
  const px = o.files.widthPx ? `${formatNumber(o.files.widthPx)} × ${formatNumber(o.files.heightPx ?? 0)} px` : '';
  return `<tr>
    <td><b>${esc(o.number)}</b><div class="sub">${esc(formatDate(o.createdAt, DATE_TIME))}</div></td>
    <td>${esc(productKindName(o.kind))} ${esc(o.size)}<div class="sub">${esc(o.productId)}</div>${o.frameColour ? `<div class="sub">${esc(t('frame.withColour', { colour: frameColourName(o.frameColour) }))}</div>` : ''}<div class="sub">${esc(design(o))}</div></td>
    <td>${esc(o.market)} · ${esc(routeName(o.fulfilment ?? 'download'))}${o.fulfilmentRef ? `<div class="sub">${esc(o.fulfilmentRef)} (${esc(o.fulfilmentStatus ?? '')})</div>` : o.fulfilmentStatus ? `<div class="sub">${esc(o.fulfilmentStatus)}</div>` : ''}</td>
    <td><span class="badge ${cls}">${esc(statusLabel(o.status))}</span>${o.fileError ? `<div class="sub error">${esc(o.fileError)}</div>` : ''}</td>
    <td>${esc(money(o.totalAmount, o.currency))}${o.refundedAmount ? `<div class="sub">${esc(t('ops.refundedAmount', { amount: money(o.refundedAmount, o.currency) }))}</div>` : ''}</td>
    <td>${o.fileUrl ? `<a href="${esc(o.fileUrl)}">PNG</a> · <a href="${esc(o.pdfUrl ?? '')}">PDF</a><div class="sub">${px}</div>` : `<span class="sub">${esc(t('ops.notYet'))}</span>`}</td>
    <td>${esc(o.email)}${a ? `<div class="sub">${esc(a.name)}, ${esc(a.city)}, ${esc(a.country)}</div>` : ''}</td>
    <td><div class="row">${actions}</div></td>
  </tr>`;
}

function renderTable() {
  if (!rows) return;
  const cols = (['ops.col.order', 'ops.col.product', 'ops.col.route', 'ops.col.status', 'ops.col.total', 'ops.col.file', 'ops.col.customer', 'ops.col.actions'] as const)
    .map((k) => `<th>${esc(t(k))}</th>`)
    .join('');
  $('#orders').innerHTML =
    `<thead><tr>${cols}</tr></thead>` + `<tbody>${rows.map(row).join('') || `<tr><td colspan="8" class="muted">${esc(t('ops.empty'))}</td></tr>`}</tbody>`;
}

function fillFilter() {
  const sel = $<HTMLSelectElement>('#filter');
  const chosen = sel.value;
  sel.innerHTML =
    `<option value="">${esc(t('ops.all'))}</option>` + ORDER_STATUSES.map((s) => `<option value="${s}">${esc(statusLabel(s))}</option>`).join('');
  sel.value = chosen;
}

async function load() {
  status(() => t('ops.loading'));
  try {
    rows = await shop.ops.list($<HTMLSelectElement>('#filter').value || undefined);
    denied = undefined;
    renderPrompt();
    renderTable();
    const count = rows.length;
    status(() => t('ops.count', { count }));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      denied = e.status === 401 ? { status: 401 } : { status: 403, me: await signedIn };
      renderPrompt();
      status(() => '');
      return;
    }
    const error = errorText(e);
    status(() => t('ops.loadError', { error }), true);
  }
}

/** Everything with words in it, again in the language just chosen; the orders shown stay. */
function retranslate() {
  document.title = t('ops.pageTitle');
  translateStatic(document, t);
  fillFilter();
  renderTable();
  status(statusLine.text, statusLine.error);
  renderPrompt();
}

$('#orders').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b || !rows) return;
  const o = rows.find((r) => r.id === b.dataset.id)!;
  b.disabled = true;
  try {
    switch (b.dataset.act) {
      case 'advance': {
        const note = o.manualNext === 'shipped' ? (prompt(t('ops.promptTracking')) ?? undefined) : undefined;
        await shop.ops.advance(o.id, { note: note || undefined });
        break;
      }
      case 'cancel':
        if (!confirm(t('ops.confirmCancel', { number: o.number }))) return;
        await shop.ops.advance(o.id, { to: 'cancelled', note: prompt(t('ops.promptReason')) || undefined });
        break;
      case 'retry':
        await shop.ops.retry(o.id);
        break;
      case 'sync':
        await shop.ops.sync(o.id);
        break;
      case 'refund': {
        const left = o.totalAmount - o.refundedAmount;
        const input = prompt(t('ops.promptRefund', { amount: money(left, o.currency) }));
        if (input === null) return;
        // Accept "12,50" as well as "12.50"; anything else is refused rather than refunding everything.
        const typed = input.trim() ? Number(input.trim().replace(',', '.')) : undefined;
        if (typed !== undefined && !(typed > 0)) {
          status(() => t('ops.badAmount', { input }), true);
          return;
        }
        await shop.ops.refund(o.id, typed === undefined ? undefined : Math.round(typed * 100));
        break;
      }
    }
    await load();
  } catch (err) {
    // Server error messages are in English; shown as they come.
    const error = errorText(err);
    status(() => `${o.number}: ${error}`, true);
  } finally {
    b.disabled = false;
  }
});

mountLanguageSwitcher($('#lang'));
const signedIn = mountAccountMenu($('#account'));
onLocaleChange(retranslate);
retranslate();
$('#filter').addEventListener('change', load);
$('#reload').addEventListener('click', load);
void load();
