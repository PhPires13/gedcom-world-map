// "Minha conta" (account.html): who is signed in, their orders (status, link to each order page)
// and their saved trees. Sends people who aren't signed in to the sign-in page.

import '../commerce/shop.css';
import { formatDate, formatNumber, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { shop } from '../commerce/client';
import type { Order } from '../commerce/order';
import { DATE_TIME, esc, money, productKindName, statusLabel } from '../commerce/words';
import type { TreeSummary } from '../model';
import { api } from '../tree/api';
import { account, DEV_EMAIL, loginUrl, type Me } from './api';
import { mountAccountMenu, t } from './menu';

const box = document.querySelector<HTMLElement>('#account-page')!;

let view: { me: Me; orders: Order[]; trees: TreeSummary[] } | { error: string } | undefined;

function badge(o: Order) {
  const cls = o.status === 'delivered' ? 'ok' : o.status === 'cancelled' || o.status === 'refunded' ? 'bad' : o.status === 'created' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(statusLabel(o.status))}</span>`;
}

function render() {
  document.title = t('account.pageTitle');
  translateStatic(document, t);
  if (!view) return;
  if ('error' in view) {
    box.innerHTML = `<div class="card"><p class="error">${esc(t('account.loadError', { error: view.error }))}</p></div>`;
    return;
  }
  const { me, orders, trees } = view;
  const cols = (['account.col.order', 'account.col.date', 'account.col.product', 'account.col.total', 'account.col.status'] as const).map((k) => `<th>${esc(t(k))}</th>`).join('');
  const orderRows = orders
    .map(
      (o) => `<tr>
        <td><a href="./order.html?id=${encodeURIComponent(o.id)}"><b>${esc(o.number)}</b></a></td>
        <td>${esc(formatDate(o.createdAt, DATE_TIME))}</td>
        <td>${esc(productKindName(o.kind))} ${esc(o.size)}${o.design.title ? `<div class="sub">${esc(o.design.title)}</div>` : ''}</td>
        <td>${esc(money(o.totalAmount, o.currency))}</td>
        <td>${badge(o)}</td>
        <td><a class="btn small" href="./order.html?id=${encodeURIComponent(o.id)}">${esc(t('account.view'))}</a></td>
      </tr>`,
    )
    .join('');
  const treeItems = trees
    .map(
      (tr) => `<li><span><b>${esc(tr.name)}</b> <span class="muted small">· ${esc(t('account.people', { count: formatNumber(tr.peopleCount) }))} · ${esc(formatDate(tr.updatedAt))}</span></span>
        <a class="btn small" href="./print.html?tree=${encodeURIComponent(tr.id)}">${esc(t('account.makePrint'))}</a></li>`,
    )
    .join('');
  box.innerHTML = `
    <div class="card">
      <h1>${esc(t('account.heading'))}</h1>
      <p class="muted">${esc(me.email === DEV_EMAIL ? t('account.devUser') : t('account.signedInAs', { email: me.email }))}</p>
      ${me.operator ? `<p><a class="btn small" href="./ops.html">${esc(t('account.ops'))}</a></p>` : ''}
    </div>
    <h2>${esc(t('account.orders'))}</h2>
    ${orders.length ? `<div class="table-wrap"><table><thead><tr>${cols}<th></th></tr></thead><tbody>${orderRows}</tbody></table></div>` : `<div class="card"><p class="muted">${esc(t('account.noOrders'))}</p></div>`}
    <h2>${esc(t('account.trees'))}</h2>
    <div class="card">${trees.length ? `<ul class="account-list">${treeItems}</ul>` : `<p class="muted">${esc(t('account.noTrees'))}</p>`}</div>`;
}

async function load() {
  try {
    const me = await account.me();
    if (!me) {
      location.replace(loginUrl('/account.html'));
      return;
    }
    const [orders, trees] = await Promise.all([shop.myOrders(), api.listTrees()]);
    view = { me, orders, trees };
  } catch (e) {
    view = { error: e instanceof Error ? e.message : String(e) };
  }
  render();
}

mountLanguageSwitcher(document.querySelector<HTMLElement>('#lang')!);
void mountAccountMenu(document.querySelector<HTMLElement>('#account')!);
onLocaleChange(render);
render();
void load();
