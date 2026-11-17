// Signed, expiring links to print files. They work without a login, so a print partner can fetch
// the file and a customer can download it from an email; the signature covers the order, the file
// and the expiry, so a link can't be edited to reach anything else or to live longer.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PRINT_FILES = ['png', 'pdf', 'svg'] as const;
export type PrintFile = (typeof PRINT_FILES)[number];

export class LinkSigner {
  constructor(
    private secret: string,
    /** Where the API is reachable from outside (partners need a public URL). */
    private baseUrl: string,
    private now: () => number = () => Date.now(),
  ) {
    if (secret.length < 16) throw new Error('The file link secret must be at least 16 characters');
  }

  private sign(orderId: string, file: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${orderId}:${file}:${exp}`).digest('base64url');
  }

  /** A link valid for `ttlSeconds`. */
  url(orderId: string, file: PrintFile, ttlSeconds: number): { url: string; expiresAt: Date } {
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    const url = `${this.baseUrl}/api/files/${orderId}/${file}?exp=${exp}&sig=${this.sign(orderId, file, exp)}`;
    return { url, expiresAt: new Date(exp * 1000) };
  }

  /**
   * The key that opens an order's page without signing in (`order.html?id=…&k=…`): in the
   * order e-mails, so a guest — or the buyer on another device — can
   * follow the order. It never expires; it shows the order (without phone and tax id), lets an
   * unpaid order be paid or cancelled, and nothing else.
   */
  orderKey(orderId: string): string {
    return createHmac('sha256', this.secret).update(`order-page:${orderId}`).digest('base64url').slice(0, 32);
  }

  checkOrderKey(orderId: string, key: string | undefined): boolean {
    if (!key) return false;
    const expected = Buffer.from(this.orderKey(orderId));
    const given = Buffer.from(key);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Why a link is not valid, or undefined if it is. */
  check(orderId: string, file: string, exp: string | undefined, sig: string | undefined): string | undefined {
    const e = Number(exp);
    if (!exp || !sig || !Number.isInteger(e)) return 'This link is incomplete';
    const expected = Buffer.from(this.sign(orderId, file, e));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'This link is not valid';
    if (e * 1000 < this.now()) return 'This link has expired: open your order page for a new one';
    return undefined;
  }
}
