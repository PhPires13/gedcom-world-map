// Orders in the database. Every status change goes through `transition`, which locks the row,
// checks the state machine (src/commerce/status.ts) and writes the history, so concurrent webhooks
// and operators can't push an order backwards or skip a step. Repeating a change is a no-op.
// The commerce routes wrap it (createCommerce → `transition`) to e-mail the customer after a change.

import { randomUUID } from 'node:crypto';
import { formatMoney, type Quote } from '../../src/commerce/catalogue';
import type { DesignSpec } from '../../src/commerce/design';
import { maskGiftCode, normaliseGiftCode, type GiftDetails } from '../../src/commerce/gift';
import type { Address, Order, OrderEvent } from '../../src/commerce/order';
import { canTransition, PAID_STATUSES, type OrderStatus } from '../../src/commerce/status';
import type { Db } from '../db';
import { HttpError, notFound } from '../errors';
import { onOrderUndone, reserveGiftCard } from './giftcards';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));

export function toOrder(r: Row): Order {
  const status = r.status as OrderStatus;
  return {
    id: r.id as string,
    number: r.number as string,
    treeId: opt(r.tree_id),
    productId: r.product_id as string,
    kind: r.kind as Order['kind'],
    size: r.size as Order['size'],
    frameColour: opt(r.frame_colour),
    design: opt(r.design),
    lang: (r.lang ?? 'pt') as Order['lang'],
    currency: r.currency as Order['currency'],
    unitAmount: r.unit_amount as number,
    shippingAmount: r.shipping_amount as number,
    totalAmount: r.total_amount as number,
    giftCardAmount: (r.gift_card_amount ?? 0) as number,
    discountAmount: (r.discount_amount ?? 0) as number,
    discountCode: opt(r.discount_code),
    amountPaid: opt(r.amount_paid),
    refundedAmount: r.refunded_amount as number,
    country: r.country as string,
    market: r.market as string,
    fulfilment: opt(r.fulfilment),
    sku: opt(r.sku),
    email: r.email as string,
    shippingAddress: opt(r.shipping_address),
    gift: opt(r.gift),
    status,
    files: (r.files ?? {}) as Order['files'],
    fileError: opt(r.file_error),
    fulfilmentRef: opt(r.fulfilment_ref),
    fulfilmentStatus: opt(r.fulfilment_status),
    tracking: (r.tracking ?? []) as Order['tracking'],
    paid: PAID_STATUSES.includes(status) || !!r.stripe_payment_intent,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Internal fields the API never sends to browsers. */
export interface OrderRow extends Order {
  ownerId: string;
  stripeSessionId?: string;
  stripePaymentIntent?: string;
}
const toRow = (r: Row): OrderRow => ({
  ...toOrder(r),
  ownerId: r.owner_id as string,
  stripeSessionId: opt(r.stripe_session_id),
  stripePaymentIntent: opt(r.stripe_payment_intent),
});

export function publicOrder(o: OrderRow): Order {
  const { ownerId: _o, stripeSessionId: _s, stripePaymentIntent: _p, ...order } = o;
  return order;
}

export interface NewOrder {
  ownerId: string;
  /** The tree and design of a map; a gift card order has neither. */
  treeId?: string;
  quote: Quote;
  country: string;
  frameColour?: string;
  design?: DesignSpec;
  lang: Order['lang'];
  email: string;
  shippingAddress?: Address;
  gift?: GiftDetails;
  /** A gift card code to spend on this order (reserved in the same transaction, or nothing is created). */
  giftCardCode?: string;
}

export async function createOrder(db: Db, o: NewOrder): Promise<OrderRow> {
  const id = randomUUID();
  const q = o.quote;
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into orders (id, owner_id, tree_id, product_id, kind, size, frame_colour, design, currency, unit_amount, shipping_amount,
         total_amount, country, market, fulfilment, sku, email, shipping_address, lang, gift)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        id,
        o.ownerId,
        o.treeId ?? null,
        q.productId,
        q.kind,
        q.size,
        o.frameColour ?? null,
        o.design ? JSON.stringify(o.design) : null,
        q.currency,
        q.unitAmount,
        q.shippingAmount,
        q.totalAmount,
        o.country,
        q.market,
        q.fulfilment ?? null,
        q.sku ?? null,
        o.email,
        o.shippingAddress ? JSON.stringify(o.shippingAddress) : null,
        o.lang,
        o.gift ? JSON.stringify(o.gift) : null,
      ],
    );
    await tx.query(`insert into order_events (order_id, to_status, actor, note) values ($1, 'created', 'customer', $2)`, [
      id,
      `${q.productId} ${q.size}${o.gift ? ' (a gift)' : ''}`,
    ]);
    if (o.giftCardCode) {
      const covered = await reserveGiftCard(tx, o.giftCardCode, { id, currency: q.currency, total: q.totalAmount });
      await tx.query('update orders set gift_card_amount = $2 where id = $1', [id, covered]);
      await tx.query(`insert into order_events (order_id, actor, note) values ($1, 'customer', $2)`, [
        id,
        `Gift card ${maskGiftCode(normaliseGiftCode(o.giftCardCode))} pays ${formatMoney(covered, q.currency)}`,
      ]);
    }
  });
  return getOrderById(db, id);
}

export async function getOrderById(db: Db, id: string): Promise<OrderRow> {
  const [row] = await db.query('select * from orders where id = $1', [id]);
  if (!row) throw notFound('Order');
  return toRow(row);
}

/** An order of this owner (404 for anyone else's, like trees). */
export async function getOrder(db: Db, ownerId: string, id: string): Promise<OrderRow> {
  const [row] = await db.query('select * from orders where id = $1 and owner_id = $2', [id, ownerId]);
  if (!row) throw notFound('Order');
  return toRow(row);
}

export async function findOrder(db: Db, where: 'stripe_payment_intent' | 'fulfilment_ref' | 'stripe_session_id', value: string): Promise<OrderRow | undefined> {
  const [row] = await db.query(`select * from orders where ${where} = $1`, [value]);
  return row ? toRow(row) : undefined;
}

export async function listOrders(db: Db, filter: { ownerId?: string; status?: OrderStatus; limit?: number }): Promise<OrderRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ownerId) where.push(`owner_id = $${params.push(filter.ownerId)}`);
  if (filter.status) where.push(`status = $${params.push(filter.status)}`);
  const rows = await db.query(
    `select * from orders ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at desc limit $${params.push(filter.limit ?? 200)}`,
    params,
  );
  return rows.map(toRow);
}

export async function orderEvents(db: Db, orderId: string): Promise<OrderEvent[]> {
  const rows = await db.query('select * from order_events where order_id = $1 order by id', [orderId]);
  return rows.map((r) => ({
    id: Number(r.id),
    fromStatus: opt(r.from_status),
    toStatus: opt(r.to_status),
    actor: r.actor as OrderEvent['actor'],
    note: opt(r.note),
    createdAt: iso(r.created_at),
  }));
}

/** Columns `transition` and `update` may set alongside a status change. */
export interface OrderPatch {
  stripe_session_id?: string;
  stripe_payment_intent?: string;
  files?: Order['files'];
  file_error?: string | null;
  fulfilment_ref?: string;
  fulfilment_status?: string;
  tracking?: Order['tracking'];
  refunded_amount?: number;
  amount_paid?: number;
  discount_amount?: number;
  discount_code?: string | null;
}

function patchSql(patch: OrderPatch, params: unknown[]): string[] {
  return Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} = $${params.push(k === 'files' || k === 'tracking' ? JSON.stringify(v) : v)}`);
}

export type Actor = OrderEvent['actor'];

/**
 * Moves an order to `to` if the state machine allows it. Returns `changed: false` (and changes
 * nothing) when the order is already there; throws 409 when the move isn't allowed.
 */
export async function transition(
  db: Db,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  note?: string,
  patch: OrderPatch = {},
): Promise<{ order: OrderRow; changed: boolean; from: OrderStatus }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query('select * from orders where id = $1 for update', [orderId]);
    if (!row) throw notFound('Order');
    const from = row.status as OrderStatus;
    if (from === to) return { order: toRow(row), changed: false, from };
    if (!canTransition(from, to, row.kind as Order['kind'])) throw new HttpError(409, `Order ${String(row.number)} can't go from ${from} to ${to}`);
    const params: unknown[] = [orderId];
    const sets = [`status = $${params.push(to)}`, 'updated_at = now()', ...patchSql(patch, params)];
    const [updated] = await tx.query(`update orders set ${sets.join(', ')} where id = $1 returning *`, params);
    await tx.query('insert into order_events (order_id, from_status, to_status, actor, note) values ($1, $2, $3, $4, $5)', [orderId, from, to, actor, note ?? null]);
    // Gift cards follow the order: a spent card comes back, a bought one that is unused is voided.
    if (to === 'cancelled' || to === 'refunded')
      for (const n of await onOrderUndone(tx, orderId, String(row.kind))) await tx.query(`insert into order_events (order_id, actor, note) values ($1, 'system', $2)`, [orderId, n]);
    return { order: toRow(updated), changed: true, from };
  });
}

/** Sets fields without changing the status; with a note, also records it in the history. */
export async function updateOrder(db: Db, orderId: string, patch: OrderPatch, event?: { actor: Actor; note: string }): Promise<OrderRow> {
  return db.transaction(async (tx) => {
    const params: unknown[] = [orderId];
    const sets = ['updated_at = now()', ...patchSql(patch, params)];
    const [row] = await tx.query(`update orders set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!row) throw notFound('Order');
    if (event) await tx.query('insert into order_events (order_id, actor, note) values ($1, $2, $3)', [orderId, event.actor, event.note]);
    return toRow(row);
  });
}

export async function addEvent(db: Db, orderId: string, actor: Actor, note: string) {
  await db.query('insert into order_events (order_id, actor, note) values ($1, $2, $3)', [orderId, actor, note]);
}

export async function webhookSeen(db: Db, provider: string, eventId: string): Promise<boolean> {
  const rows = await db.query('select 1 from webhook_events where provider = $1 and event_id = $2', [provider, eventId]);
  return rows.length > 0;
}

/** Records a handled event; false if it had already been recorded (a concurrent redelivery). */
export async function markWebhook(db: Db, provider: string, eventId: string): Promise<boolean> {
  const rows = await db.query('insert into webhook_events (provider, event_id) values ($1, $2) on conflict do nothing returning event_id', [provider, eventId]);
  return rows.length > 0;
}
