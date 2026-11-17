// Which e-mail an order's customer gets when its status changes, and sending it safely.
//
//   paid                    → order confirmed
//   file_ready (digital)    → the map is ready: download links (and a request for a review)
//   shipped                 → on its way, with tracking when there is some
//   delivered (print/frame) → arrived, with a request for a review
//   refunded                → refund made
//
// Called by the commerce routes after every status change that happened (orders.transition with
// `changed: true`), in the background. Sending never throws: a failure is logged and written to
// the order's history, and the order carries on exactly as it would have without e-mail.

import { formatMoney, productById, type Catalogue } from '../../src/commerce/catalogue';
import type { OrderStatus } from '../../src/commerce/status';
import type { Db } from '../db';
import * as orders from '../commerce/orders';
import { deliveredMail, fileReadyMail, orderPaidMail, refundedMail, shippedMail, type MailLang, type OrderMailInfo, type Rendered } from './templates';
import type { Mailer } from './types';

export type OrderMailKind = 'order_paid' | 'order_file_ready' | 'order_shipped' | 'order_delivered' | 'order_refunded';

export interface OrderMailDeps {
  db: Db;
  mailer: Mailer;
  catalogue: Catalogue;
  /** The customer's order page (with the key that opens it without signing in). */
  orderUrl: (orderId: string) => string;
  /** Signed download links of a digital order's files (the same the order page shows). */
  downloads: (o: orders.OrderRow) => { pdf?: string; png?: string; expiresAt: string } | undefined;
  /** Name at the top of every mail (MAIL_BRAND). */
  brand?: string;
  /** Where "Leave a review" goes (REVIEW_URL); without it, customers are asked to reply. */
  reviewUrl?: string;
}

export interface StatusChange {
  order: orders.OrderRow;
  from: OrderStatus;
  to: OrderStatus;
  actor: orders.Actor;
  note?: string;
}

/** The mail a status change sends, if any. */
export function mailKindFor(order: Pick<orders.OrderRow, 'kind'>, to: OrderStatus): OrderMailKind | undefined {
  switch (to) {
    case 'paid':
      return 'order_paid';
    case 'file_ready':
      return order.kind === 'digital' ? 'order_file_ready' : undefined;
    case 'shipped':
      return 'order_shipped';
    case 'delivered':
      // A digital order is "delivered" by its download links, already sent at file_ready.
      return order.kind === 'digital' ? undefined : 'order_delivered';
    case 'refunded':
      return 'order_refunded';
    default:
      return undefined;
  }
}

const LABEL: Record<OrderMailKind, string> = {
  order_paid: 'order confirmed',
  order_file_ready: 'download links',
  order_shipped: 'shipped',
  order_delivered: 'delivered, review request',
  order_refunded: 'refund',
};

// Frame colours are English ids in the catalogue; the same words as src/i18n/messages/shop.ts
// (which the server can't import: it is browser code).
const FRAME: Record<MailLang, { withColour: string; colours: Record<string, string> }> = {
  pt: { withColour: 'moldura {colour}', colours: { black: 'preta', natural: 'natural', brown: 'marrom', 'antique gold': 'dourada antiga', white: 'branca' } },
  en: { withColour: '{colour} frame', colours: {} },
  es: { withColour: 'marco {colour}', colours: { black: 'negro', natural: 'natural', brown: 'marrón', 'antique gold': 'dorado antiguo', white: 'blanco' } },
};

function productName(deps: OrderMailDeps, o: orders.OrderRow, lang: MailLang): string {
  const product = productById(deps.catalogue, o.productId);
  const name = product?.name[lang] || product?.name.en || o.productId;
  if (!o.frameColour) return `${name} ${o.size}`;
  const colour = FRAME[lang].colours[o.frameColour.trim().toLowerCase()] ?? o.frameColour;
  return `${name} ${o.size}, ${FRAME[lang].withColour.replace('{colour}', colour)}`;
}

/** Operators' default "Marked shipped by …" note is not tracking; anything else they type is. */
const trackingNote = (c: StatusChange) => (c.actor === 'operator' && c.note && !/^Marked .+ by /.test(c.note) ? c.note : undefined);

export function renderOrderMail(deps: OrderMailDeps, kind: OrderMailKind, c: StatusChange): Rendered | undefined {
  const o = c.order;
  const lang = o.design.lang ?? 'pt';
  const info: OrderMailInfo = {
    lang,
    number: o.number,
    product: productName(deps, o, lang),
    title: o.design.title || undefined,
    total: formatMoney(o.totalAmount, o.currency),
    digital: o.kind === 'digital',
    orderUrl: deps.orderUrl(o.id),
    brand: deps.brand,
  };
  switch (kind) {
    case 'order_paid':
      return orderPaidMail(info);
    case 'order_file_ready': {
      const links = deps.downloads(o);
      return links ? fileReadyMail(info, links) : undefined;
    }
    case 'order_shipped':
      return shippedMail(info, o.tracking, trackingNote(c));
    case 'order_delivered':
      return deliveredMail(info, deps.reviewUrl);
    case 'order_refunded':
      return refundedMail(info, formatMoney(o.refundedAmount || o.totalAmount, o.currency));
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Sends the mail for a status change, if it has one. Never throws. */
export async function sendOrderMail(deps: OrderMailDeps, change: StatusChange): Promise<void> {
  const kind = mailKindFor(change.order, change.to);
  if (!kind) return;
  const o = change.order;
  try {
    const mail = renderOrderMail(deps, kind, change);
    if (!mail) return;
    await deps.mailer.send({ ...mail, to: o.email, tag: kind, idempotencyKey: `${o.id}:${kind}` });
    await orders.addEvent(deps.db, o.id, 'system', `E-mail sent to the customer: ${LABEL[kind]}`);
  } catch (e) {
    console.error(`E-mail "${kind}" for order ${o.number} failed:`, e);
    try {
      await orders.addEvent(deps.db, o.id, 'system', `E-mail to the customer (${LABEL[kind]}) could not be sent: ${message(e)}`);
    } catch (e2) {
      console.error(`Could not record the e-mail failure on order ${o.number}:`, e2);
    }
  }
}
