// Gift cards (vale-presente): issued when a gift card order is paid, spent once on a map order.
//
//   gift card order paid ──issue()──▶ code ACTIVE ──a map order uses it (reserve, row lock)──▶ REDEEMED
//                                        ▲                                                       │
//                                        └──────── that map order is cancelled or refunded ──────┘
//   gift card order refunded / cancelled while the code is unused ──▶ VOID
//
// Reserving happens in the transaction that creates the map order, under `select … for update`,
// and the update itself only matches an active card: two orders can never spend one code.

import { randomInt, randomUUID } from 'node:crypto';
import type { Currency } from '../../src/commerce/catalogue';
import { formatGiftCode, GIFT_CODE_ALPHABET, GIFT_CODE_LENGTH, isGiftCodeShape, maskGiftCode, normaliseGiftCode } from '../../src/commerce/gift';
import type { IssuedGiftCard } from '../../src/commerce/order';
import type { Db } from '../db';
import { badRequest, HttpError } from '../errors';

/** A new random code (normalised form), from the OS's secure random source. */
export function generateGiftCode(): string {
  let code = '';
  for (let i = 0; i < GIFT_CODE_LENGTH; i++) code += GIFT_CODE_ALPHABET[randomInt(GIFT_CODE_ALPHABET.length)];
  return code;
}

type Row = Record<string, unknown>;

function toCard(r: Row, masked: boolean): IssuedGiftCard {
  const code = String(r.code);
  return {
    code: masked ? maskGiftCode(code) : formatGiftCode(code),
    amount: Number(r.amount),
    currency: r.currency as Currency,
    status: r.status as IssuedGiftCard['status'],
    redeemedOrderNumber: (r.redeemed_order_number as string | null) ?? undefined,
  };
}

/**
 * Issues the card a paid gift card order bought (once: repeating returns the same card). `code`
 * is for tests; a collision with an existing code just draws another.
 */
export async function issueGiftCard(db: Db, order: { id: string; currency: Currency; totalAmount: number }, code = generateGiftCode): Promise<IssuedGiftCard> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db.query(
      `insert into gift_cards (id, code, order_id, currency, amount) values ($1, $2, $3, $4, $5)
       on conflict do nothing returning *`,
      [randomUUID(), code(), order.id, order.currency, order.totalAmount],
    );
    if (rows.length) return toCard(rows[0], false);
    const existing = await giftCardOfOrder(db, order.id, false);
    if (existing) return existing;
  }
  throw new Error('Could not draw an unused gift card code');
}

/** The card a gift card order bought, if issued. Operators get it masked. */
export async function giftCardOfOrder(db: Db, orderId: string, masked: boolean): Promise<IssuedGiftCard | undefined> {
  const [row] = await db.query(
    `select g.*, o.number as redeemed_order_number from gift_cards g left join orders o on o.id = g.redeemed_order_id where g.order_id = $1`,
    [orderId],
  );
  return row ? toCard(row, masked) : undefined;
}

export type GiftCardCheck = { valid: true; amount: number; currency: Currency } | { valid: false; reason: 'unknown' | 'used' | 'currency'; currency?: Currency };

/** Can this code pay for an order in `currency`? (For the buy panel; spending checks again under a lock.) */
export async function checkGiftCard(db: Db, input: string, currency: Currency): Promise<GiftCardCheck> {
  const code = normaliseGiftCode(input);
  if (!isGiftCodeShape(code)) return { valid: false, reason: 'unknown' };
  const [row] = await db.query('select * from gift_cards where code = $1', [code]);
  return verdict(row, currency);
}

function verdict(row: Row | undefined, currency: Currency): GiftCardCheck {
  if (!row || row.status === 'void') return { valid: false, reason: 'unknown' };
  if (row.status === 'redeemed') return { valid: false, reason: 'used' };
  if (row.currency !== currency) return { valid: false, reason: 'currency', currency: row.currency as Currency };
  return { valid: true, amount: Number(row.amount), currency };
}

/**
 * Spends a code on a new order, inside the transaction that creates that order. Returns the amount
 * it covers (at most `total`; a single-use card's remainder is not kept). Throws 400/409 otherwise,
 * which rolls the order back.
 */
export async function reserveGiftCard(tx: Db, input: string, order: { id: string; currency: Currency; total: number }): Promise<number> {
  const code = normaliseGiftCode(input);
  if (!isGiftCodeShape(code)) throw badRequest('This gift card code is not valid');
  const [row] = await tx.query('select * from gift_cards where code = $1 for update', [code]);
  const v = verdict(row, order.currency);
  if (!v.valid) {
    if (v.reason === 'used') throw new HttpError(409, 'This gift card has already been used');
    if (v.reason === 'currency') throw badRequest(`This gift card is in ${v.currency}: choose ${v.currency} as the currency to use it`);
    throw badRequest('This gift card code is not valid');
  }
  const done = await tx.query(
    `update gift_cards set status = 'redeemed', redeemed_order_id = $2, redeemed_at = now(), updated_at = now()
     where code = $1 and status = 'active' returning amount`,
    [code, order.id],
  );
  if (!done.length) throw new HttpError(409, 'This gift card has already been used');
  return Math.min(v.amount, order.total);
}

/**
 * When an order is cancelled or refunded (inside `transition`'s transaction): a card it spent goes
 * back to its owner (or is void if its own purchase was refunded meanwhile), and the card a gift
 * card order bought is voided if still unused. Returns notes for the history.
 */
export async function onOrderUndone(tx: Db, orderId: string, kind: string): Promise<string[]> {
  const notes: string[] = [];
  const restored = await tx.query<{ code: string; status: string }>(
    `update gift_cards g
       set status = case when p.status in ('cancelled', 'refunded') then 'void' else 'active' end,
           redeemed_order_id = null, redeemed_at = null, updated_at = now()
     from orders p
     where p.id = g.order_id and g.redeemed_order_id = $1 and g.status = 'redeemed'
     returning g.code, g.status`,
    [orderId],
  );
  for (const r of restored)
    notes.push(r.status === 'active' ? `Gift card ${maskGiftCode(r.code)} can be used again` : `Gift card ${maskGiftCode(r.code)} not given back: its purchase was refunded`);
  if (kind === 'giftcard') {
    const voided = await tx.query<{ code: string }>(`update gift_cards set status = 'void', updated_at = now() where order_id = $1 and status = 'active' returning code`, [orderId]);
    for (const r of voided) notes.push(`Gift card ${maskGiftCode(r.code)} voided`);
    const [spent] = await tx.query<{ code: string }>(`select code from gift_cards where order_id = $1 and status = 'redeemed'`, [orderId]);
    if (spent) notes.push(`Gift card ${maskGiftCode(spent.code)} was already spent: it stays used`);
  }
  return notes;
}

/** Voids an unused card before refunding its purchase; false if it was already spent. */
export async function voidUnusedGiftCard(db: Db, orderId: string): Promise<boolean> {
  // One statement, so a code can't be spent between the check and the void.
  const voided = await db.query(`update gift_cards set status = 'void', updated_at = now() where order_id = $1 and status = 'active' returning id`, [orderId]);
  if (voided.length) return true;
  const [row] = await db.query<{ status: string }>('select status from gift_cards where order_id = $1', [orderId]);
  return row?.status !== 'redeemed'; // never issued, or already void
}
