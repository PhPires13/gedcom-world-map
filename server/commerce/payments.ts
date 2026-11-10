// Payments through Stripe Checkout, in TEST MODE ONLY for now. The routes only see the small
// `Payments` interface; tests pass a Stripe client whose network calls are mocked.
//
// Stripe facts this relies on (docs.stripe.com, read 2026-11-10; details in the commerce README):
// - Checkout Sessions created with `price_data` line items; since API 2026-09-30 the list of
//   methods is `allowed_payment_method_types` (the old `payment_method_types` is rejected), or
//   omitted to let the Dashboard's dynamic payment methods decide.
// - Card payments complete with `checkout.session.completed` (payment_status "paid"); Pix (and
//   boleto) complete later with `checkout.session.async_payment_succeeded`.
// - A Portuguese, EU or US Stripe account can charge cards and Pix in BRL; boleto needs a
//   Brazilian Stripe account.

import Stripe from 'stripe';
import type { Currency } from '../../src/commerce/catalogue';

export interface CheckoutInput {
  orderId: string;
  orderNumber: string;
  email: string;
  currency: Currency;
  lines: { name: string; description?: string; amount: number }[];
  successUrl: string;
  cancelUrl: string;
  locale: 'pt-BR' | 'pt' | 'en';
}

/** What the order logic needs from a Stripe event, already verified. */
export type PaymentEvent =
  | { id: string; type: 'paid'; orderId: string; sessionId: string; paymentIntent?: string; amount: number; currency: string }
  | { id: string; type: 'pending'; orderId: string; sessionId: string }
  | { id: string; type: 'failed'; orderId: string; sessionId: string }
  | { id: string; type: 'expired'; orderId: string; sessionId: string }
  | { id: string; type: 'refunded'; paymentIntent: string; amountRefunded: number; fullyRefunded: boolean }
  | { id: string; type: 'ignored'; stripeType: string };

export interface Payments {
  /** "test" or "live", from the key. */
  mode: 'test' | 'live';
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  refund(paymentIntent: string, amount: number | undefined, orderId: string): Promise<{ id: string; amount: number; status: string }>;
  /** Verifies the Stripe-Signature header and turns the event into a PaymentEvent. Throws if the signature is wrong. */
  parseWebhook(rawBody: string, signature: string): PaymentEvent;
}

export class PaymentsNotConfigured extends Error {
  constructor() {
    super('Payments are not set up: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (Stripe test mode keys)');
  }
}

export interface StripeOptions {
  /** Offer Pix for BRL orders (it must also be enabled in the Stripe Dashboard). */
  pixForBrl?: boolean;
  /** How long a Pix QR code stays payable. */
  pixExpiresSeconds?: number;
}

const sessionOrderId = (s: Stripe.Checkout.Session) => s.metadata?.order_id ?? s.client_reference_id ?? '';

export function stripePayments(stripe: Stripe, secretKey: string, webhookSecret: string, opts: StripeOptions = {}): Payments {
  const mode = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_') ? 'live' : 'test';
  return {
    mode,
    async createCheckout(input) {
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        client_reference_id: input.orderId,
        customer_email: input.email,
        locale: input.locale,
        line_items: input.lines.map((l) => ({
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: l.amount,
            product_data: { name: l.name, ...(l.description ? { description: l.description } : {}) },
          },
        })),
        metadata: { order_id: input.orderId, order_number: input.orderNumber },
        payment_intent_data: { metadata: { order_id: input.orderId, order_number: input.orderNumber } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // An unpaid session can be reused for 2 hours; then `checkout.session.expired` arrives.
        expires_at: Math.floor(Date.now() / 1000) + 2 * 3600,
      };
      if (input.currency === 'BRL' && opts.pixForBrl) {
        params.allowed_payment_method_types = ['card', 'pix'];
        params.payment_method_options = { pix: { expires_after_seconds: opts.pixExpiresSeconds ?? 3600 } };
      }
      const s = await stripe.checkout.sessions.create(params, { idempotencyKey: `checkout-${input.orderId}-${input.lines.map((l) => l.amount).join('-')}` });
      if (!s.url) throw new Error('Stripe returned a Checkout Session without a URL');
      return { id: s.id, url: s.url };
    },
    async refund(paymentIntent, amount, orderId) {
      const r = await stripe.refunds.create(
        { payment_intent: paymentIntent, ...(amount ? { amount } : {}), metadata: { order_id: orderId } },
        { idempotencyKey: `refund-${orderId}-${amount ?? 'full'}` },
      );
      return { id: r.id, amount: r.amount, status: r.status ?? 'pending' };
    },
    parseWebhook(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const s = event.data.object as Stripe.Checkout.Session;
          const base = { id: event.id, orderId: sessionOrderId(s), sessionId: s.id };
          // A Pix/boleto session "completes" when the voucher is issued; it is paid later.
          if (s.payment_status === 'unpaid') return { ...base, type: 'pending' };
          const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
          return { ...base, type: 'paid', paymentIntent: pi, amount: s.amount_total ?? 0, currency: (s.currency ?? '').toUpperCase() };
        }
        case 'checkout.session.async_payment_failed': {
          const s = event.data.object as Stripe.Checkout.Session;
          return { id: event.id, type: 'failed', orderId: sessionOrderId(s), sessionId: s.id };
        }
        case 'checkout.session.expired': {
          const s = event.data.object as Stripe.Checkout.Session;
          return { id: event.id, type: 'expired', orderId: sessionOrderId(s), sessionId: s.id };
        }
        case 'charge.refunded': {
          const c = event.data.object as Stripe.Charge;
          const pi = typeof c.payment_intent === 'string' ? c.payment_intent : (c.payment_intent?.id ?? '');
          return { id: event.id, type: 'refunded', paymentIntent: pi, amountRefunded: c.amount_refunded, fullyRefunded: c.refunded };
        }
        default:
          return { id: event.id, type: 'ignored', stripeType: event.type };
      }
    },
  };
}

/** Payments from the environment, or undefined when the keys aren't set. Refuses live keys unless explicitly allowed. */
export function paymentsFromEnv(env: NodeJS.ProcessEnv, placeholderPrices: boolean): Payments | undefined {
  const key = env.STRIPE_SECRET_KEY;
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!key) return undefined;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required with STRIPE_SECRET_KEY (stripe listen prints one for local testing)');
  const live = /^(sk|rk)_live_/.test(key);
  if (live && (env.ALLOW_LIVE_PAYMENTS !== 'yes' || placeholderPrices)) {
    throw new Error('Refusing a live Stripe key: this shop runs in test mode only (and its prices are placeholders). Use an sk_test_ key.');
  }
  return stripePayments(new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: 'heritage-map-shop' } }), key, secret, {
    pixForBrl: env.STRIPE_PIX === 'yes',
  });
}
