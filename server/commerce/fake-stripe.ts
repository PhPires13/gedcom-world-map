// A stand-in for Stripe's servers, for development without Stripe keys (FAKE_PAYMENTS=yes) and for
// tests. It is the real Stripe SDK with its two network calls replaced:
//
// - checkout.sessions.create returns a session whose URL is a local "simulated Checkout" page;
// - refunds.create answers "succeeded".
//
// Promotion codes: when a session allows them, the simulated page has a code field. The codes are
// in `promotionCodes` (TESTE10 = 10% off, TESTE20REAIS = 20.00 off BRL orders, plus any a test adds);
// the completed session carries the discount the way Stripe's does.
//
// Paying on the simulated page sends a `checkout.session.completed` event to the shop's own
// webhook URL, signed with the webhook secret exactly like Stripe signs it, so the real signature
// check and order logic run. Nothing here talks to Stripe.

import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import Stripe from 'stripe';
import type { AuthEnv } from '../auth';

interface FakeSession {
  id: string;
  params: Stripe.Checkout.SessionCreateParams;
  status: 'open' | 'complete' | 'expired';
  /** The promotion code applied on the simulated page (a key of `promotionCodes`). */
  promotionCode?: string;
}

export interface FakePromotionCode {
  id: string;
  percentOff?: number;
  /** Minor units, in `currency` only. */
  amountOff?: number;
  currency?: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fakeStripe(apiUrl: string, webhookSecret: string, post: (body: string, signature: string) => Promise<Response> = defaultPost(apiUrl)) {
  const stripe = new Stripe('sk_test_fake_local_only');
  const sessions = new Map<string, FakeSession>();
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const refunds: Stripe.RefundCreateParams[] = [];
  const promotionCodes = new Map<string, FakePromotionCode>([
    ['TESTE10', { id: 'promo_fake_teste10', percentOff: 10 }],
    ['TESTE20REAIS', { id: 'promo_fake_teste20reais', amountOff: 2000, currency: 'brl' }],
  ]);

  (stripe.checkout.sessions as unknown as { create: unknown }).create = async (params: Stripe.Checkout.SessionCreateParams) => {
    const id = `cs_test_fake_${randomUUID().replace(/-/g, '')}`;
    sessions.set(id, { id, params, status: 'open' });
    created.push(params);
    return { id, url: `${apiUrl}/api/dev/checkout/${id}` };
  };
  (stripe.refunds as unknown as { create: unknown }).create = async (params: Stripe.RefundCreateParams) => {
    refunds.push(params);
    return { id: `re_fake_${randomUUID().slice(0, 8)}`, amount: params.amount ?? 0, status: 'succeeded' };
  };

  /** A signed Stripe event, as Stripe would send it. */
  function event(type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({ id: `evt_fake_${randomUUID().replace(/-/g, '')}`, object: 'event', type, api_version: '2026-10-28.endive', created: Math.floor(Date.now() / 1000), data: { object } });
    return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }) };
  }

  /** Applies a promotion code to an open session, as typing it on Checkout would; an error message if refused. */
  function applyPromotionCode(sessionId: string, input: string): string | undefined {
    const s = sessions.get(sessionId);
    if (!s || s.status !== 'open') return 'Unknown or finished session';
    if (!s.params.allow_promotion_codes) return 'This session does not take promotion codes';
    const code = input.trim().toUpperCase();
    const promo = promotionCodes.get(code);
    const currency = s.params.line_items?.[0]?.price_data?.currency;
    if (!promo || (promo.amountOff && promo.currency !== currency)) return 'This code is invalid';
    s.promotionCode = code;
    return undefined;
  }

  function sessionObject(s: FakeSession, paid: boolean) {
    const p = s.params;
    const subtotal = (p.line_items ?? []).reduce((sum, l) => sum + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1), 0);
    const promo = s.promotionCode ? promotionCodes.get(s.promotionCode) : undefined;
    const discount = promo ? Math.min(subtotal, promo.amountOff ?? Math.round((subtotal * (promo.percentOff ?? 0)) / 100)) : 0;
    const total = subtotal - discount;
    return {
      id: s.id,
      object: 'checkout.session',
      client_reference_id: p.client_reference_id,
      metadata: p.metadata,
      amount_subtotal: subtotal,
      amount_total: total,
      total_details: { amount_discount: discount, amount_shipping: 0, amount_tax: 0 },
      discounts: promo ? [{ coupon: `co_fake_${s.promotionCode!.toLowerCase()}`, promotion_code: promo.id }] : [],
      currency: p.line_items?.[0]?.price_data?.currency,
      payment_status: paid ? (total === 0 ? 'no_payment_required' : 'paid') : 'unpaid',
      status: paid ? 'complete' : 'expired',
      payment_intent: paid && total > 0 ? `pi_fake_${s.id.slice(-12)}` : null,
    };
  }

  /** The simulated Checkout pages (mount before authentication, dev only). */
  function mount(app: Hono<AuthEnv>) {
    app.get('/api/dev/checkout/:id', (c) => {
      const s = sessions.get(c.req.param('id'));
      if (!s) return c.text('Unknown session', 404);
      const lines = (s.params.line_items ?? [])
        .map((l) => `<tr><td>${esc(l.price_data?.product_data?.name)}</td><td style="text-align:right">${((l.price_data?.unit_amount ?? 0) / 100).toFixed(2)} ${esc(l.price_data?.currency?.toUpperCase())}</td></tr>`)
        .join('');
      return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulated checkout</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#222}.warn{background:#fff3cd;border:1px solid #e0c060;padding:10px 12px;border-radius:6px}
table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:6px 0;border-bottom:1px solid #eee}button{font:inherit;padding:10px 16px;border-radius:6px;border:1px solid #888;cursor:pointer;margin-right:8px}
.pay{background:#635bff;color:#fff;border-color:#635bff}</style></head><body>
<p class="warn"><b>Simulated Stripe Checkout.</b> This server has no Stripe keys (FAKE_PAYMENTS=yes). Paying here sends a signed test-mode <code>checkout.session.completed</code> event to the shop's webhook. No money moves.</p>
<p>Order ${esc(s.params.metadata?.order_number)} · ${esc(s.params.customer_email)}</p>
<table>${lines}</table>
${s.status === 'open' ? `<form method="post" action="${esc(apiUrl)}/api/dev/checkout/${esc(s.id)}/pay" style="display:inline">${
        s.params.allow_promotion_codes
          ? `<p><label>Promotion code (try ${[...promotionCodes.keys()].map(esc).join(', ')}): <input name="promo" autocomplete="off" style="font:inherit;padding:6px"></label></p>`
          : ''
      }<button class="pay">Pay with test card 4242 4242 4242 4242</button></form>
<form method="post" action="${esc(apiUrl)}/api/dev/checkout/${esc(s.id)}/expire" style="display:inline"><button>Let it expire</button></form>
<p><a href="${esc(s.params.cancel_url)}">← Back</a></p>` : `<p>This session is ${s.status}.</p>`}
</body></html>`);
    });
    app.post('/api/dev/checkout/:id/:action', async (c) => {
      const s = sessions.get(c.req.param('id'));
      const action = c.req.param('action');
      if (!s || s.status !== 'open' || (action !== 'pay' && action !== 'expire')) return c.text('Unknown or finished session', 404);
      const paid = action === 'pay';
      if (paid) {
        const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
        const promo = typeof form.promo === 'string' ? form.promo.trim() : '';
        const problem = promo ? applyPromotionCode(s.id, promo) : undefined;
        if (problem) return c.text(`${problem}. Go back and try another code.`, 400);
      }
      s.status = paid ? 'complete' : 'expired';
      const e = event(paid ? 'checkout.session.completed' : 'checkout.session.expired', sessionObject(s, paid));
      const res = await post(e.payload, e.signature);
      if (!res.ok) return c.text(`The shop's webhook answered ${res.status}: ${await res.text()}`, 502);
      return c.redirect(paid ? s.params.success_url! : s.params.cancel_url!, 303);
    });
  }

  return { stripe, mount, event, sessionObject, applyPromotionCode, promotionCodes, sessions, created, refunds };
}

const defaultPost = (apiUrl: string) => (body: string, signature: string) =>
  fetch(`${apiUrl}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body });
