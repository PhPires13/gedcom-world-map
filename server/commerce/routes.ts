// Commerce routes. Mounted by createApp when it is given `commerce` deps.
//
// Without login (signature-checked instead), mounted before authentication:
//   POST   /api/webhooks/stripe                         Stripe events (Stripe-Signature)
//   POST   /api/webhooks/prodigi                        Prodigi v5 events (X-Prodigi-Signature)
//   GET    /api/files/:orderId/:file?exp&sig            print file (png | pdf | svg), signed expiring link
//
// The order's owner, or anyone with the order's link — `?k=<order key>` (links.ts orderKey), which
// the order e-mails carry — so a guest, or the buyer on another device,
// can follow it without signing in. Without the key, someone else's order is 404. Someone who isn't
// the owner gets the address without phone and tax id:
//   GET    /api/shop/catalogue?country=BR[&currency=EUR]  products and prices for a country
//   GET    /api/orders/:id                                order, history, download links once paid (digital)
//   POST   /api/orders/:id/checkout                       → {url} of a Stripe Checkout page
//   POST   /api/orders/:id/cancel                         cancel an unpaid order
//
// Signed in (orders belong to their owner, like trees, and are listed in "Minha conta"):
//   POST   /api/orders          {treeId, productId, size, frameColour?, design, country, currency?, email, shippingAddress?}
//   GET    /api/orders                                    my orders
//
// Operations (signed in, with an e-mail listed in OPERATOR_EMAILS; 401 / 403 otherwise):
//   GET    /api/ops/orders[?status=]                      every order, with file links
//   POST   /api/ops/orders/:id/advance {to?, note?}       next manual step, or a given status
//   POST   /api/ops/orders/:id/refund {amount?}           refund through Stripe (minor units; default: all)
//   POST   /api/ops/orders/:id/retry                      re-run the after-payment steps
//   POST   /api/ops/orders/:id/sync                       poll the partner for its status
//   GET    /api/ops/orders/:id/sheet                      production sheet (HTML, printable) for the lab
//   POST   /api/ops/quote {productId, size, country, frameColour?, currency?}   the partner's cost

import type { Context, Hono } from 'hono';
import { formatMoney, priceList, productById, quote, QuoteError, type Catalogue, type Currency } from '../../src/commerce/catalogue';
import { DesignError, parseDesign, type DesignOptionIds } from '../../src/commerce/design';
import type { Address, OrderDetail } from '../../src/commerce/order';
import { allowedNext, nextManualStep, ORDER_STATUSES, STATUS_LABELS } from '../../src/commerce/status';
import { currentUser, type AuthEnv, type User } from '../auth';
import type { Db } from '../db';
import { badRequest, HttpError, notFound } from '../errors';
import { sendOrderMail } from '../mail/order-mails';
import type { Mailer } from '../mail/types';
import * as repo from '../repo';
import type { DocumentStorage } from '../storage';
import { obj, oneOf, optStr, str, uuid } from '../validate';
import type { FulfilmentAdapter } from './fulfilment/types';
import { LinkSigner, PRINT_FILES, type PrintFile } from './links';
import * as orders from './orders';
import { PaymentsNotConfigured, type Payments } from './payments';
import { fileKey, Pipeline, type RenderFiles } from './pipeline';
import { productionSheet } from './sheet';

export type Commerce = ReturnType<typeof createCommerce>;

export interface CommerceDeps {
  catalogue: Catalogue;
  /** Undefined when Stripe keys aren't set: checkout answers 503. */
  payments?: Payments;
  fulfilment: Partial<Record<'prodigi' | 'manual', FulfilmentAdapter>>;
  links: LinkSigner;
  render: RenderFiles;
  /** The print options the server can render (styles, layouts, borders, finishes), for design validation. */
  designOptions: DesignOptionIds;
  /** The web app's address, for Stripe's return pages (e.g. http://localhost:5173). */
  appUrl: string;
  /** Emails allowed on the operations routes. */
  operators: readonly string[];
  /** Extra routes mounted without login (the simulated Checkout of fake-stripe.ts in dev). */
  devRoutes?: (app: Hono<AuthEnv>) => void;
  /** Runs after-payment work without holding up the webhook response. Tests pass one they can await. */
  background?: (task: () => Promise<void>) => void;
  /** E-mails the customer when the order moves (server/mail/order-mails.ts). Without it, no e-mail. */
  mailer?: Mailer;
  /** Name at the top of the e-mails (MAIL_BRAND). */
  mailBrand?: string;
  /** "Leave a review" link in the delivered e-mail (REVIEW_URL). */
  reviewUrl?: string;
}

const DOWNLOAD_TTL = 7 * 24 * 3600;
const CONTENT_TYPES: Record<PrintFile, string> = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' };
const COUNTRY_RE = /^[A-Z]{2}$/;

function parseAddress(v: unknown, country: string): Address {
  const o = obj(v, 'shippingAddress');
  const a: Address = {
    name: str(o.name, 'shippingAddress.name', 100),
    line1: str(o.line1, 'shippingAddress.line1', 100),
    line2: optStr(o.line2, 'shippingAddress.line2', 100),
    city: str(o.city, 'shippingAddress.city', 50),
    state: optStr(o.state, 'shippingAddress.state', 50),
    postalCode: str(o.postalCode, 'shippingAddress.postalCode', 20),
    country: str(o.country ?? country, 'shippingAddress.country', 2).toUpperCase(),
    phone: optStr(o.phone, 'shippingAddress.phone', 20),
    taxId: optStr(o.taxId, 'shippingAddress.taxId', 20),
  };
  if (a.country !== country) throw badRequest('shippingAddress.country must be the country the price was quoted for');
  if (a.country === 'BR') {
    const digits = (a.taxId ?? '').replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) throw badRequest('shippingAddress.taxId: a CPF (11 digits) or CNPJ (14 digits) is needed for delivery in Brazil');
    a.taxId = digits;
  }
  return a;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

/**
 * The commerce part of the API. `mountPublic` must run before the authentication middleware
 * (webhooks and signed file links carry their own proof), `mountAuthed` after it.
 */
export function createCommerce(db: Db, storage: DocumentStorage, now: () => Date, deps: CommerceDeps) {
  const { catalogue, links } = deps;
  const background =
    deps.background ??
    ((task) => {
      setImmediate(() => task().catch((e) => console.error('Background order task failed:', e)));
    });

  const downloadLinks = (o: orders.OrderRow): OrderDetail['downloads'] => {
    if (!o.files.png) return undefined;
    const made = PRINT_FILES.filter((f) => o.files[f]).map((f) => [f, links.url(o.id, f, DOWNLOAD_TTL)] as const);
    return { ...Object.fromEntries(made.map(([f, l]) => [f, l.url])), expiresAt: made[0][1].expiresAt.toISOString() };
  };

  /**
   * Every status change goes through here: orders.transition, then (when it changed something) the
   * customer's e-mail, in the background so a slow or failing mail provider never holds up or
   * breaks the order.
   */
  const mailer = deps.mailer;
  const transition: typeof orders.transition = async (tdb, orderId, to, actor, note, patch) => {
    const result = await orders.transition(tdb, orderId, to, actor, note, patch);
    if (result.changed && mailer) {
      const change = { order: result.order, from: result.from, to, actor, note };
      background(() => sendOrderMail({ db, mailer, catalogue, orderUrl: orderPageUrl, downloads: downloadLinks, brand: deps.mailBrand, reviewUrl: deps.reviewUrl }, change));
    }
    return result;
  };
  const pipeline = new Pipeline({ db, storage, render: deps.render, fulfilment: deps.fulfilment, links, now, transition });

  const detail = async (o: orders.OrderRow, withLinks: boolean): Promise<OrderDetail> => {
    const out: OrderDetail = { ...orders.publicOrder(o), events: await orders.orderEvents(db, o.id) };
    const downloads = withLinks ? downloadLinks(o) : undefined;
    if (downloads) out.downloads = downloads;
    return out;
  };

  /** The order as seen by someone holding its link who isn't its owner: no phone or tax id. */
  const forViewer = (out: OrderDetail, o: orders.OrderRow, viewer: User | undefined): OrderDetail => {
    if (viewer?.id === o.ownerId || !out.shippingAddress) return out;
    const { phone: _p, taxId: _t, ...address } = out.shippingAddress;
    return { ...out, shippingAddress: address };
  };

  /** The customer's order page, with the key that opens it without signing in. */
  const orderPageUrl = (orderId: string) => `${deps.appUrl}/order.html?id=${orderId}&k=${links.orderKey(orderId)}`;

  const isOperator = (user: User | undefined) => !!user && deps.operators.some((e) => e.toLowerCase() === user.email.toLowerCase());

  // ---------- Without login ----------

  const mountStripeWebhook = (app: Hono<AuthEnv>) => {
    app.post('/api/webhooks/stripe', async (c) => {
      if (!deps.payments) return c.json({ error: 'Payments are not configured' }, 503);
      const raw = await c.req.text();
      let event;
      try {
        event = deps.payments.parseWebhook(raw, c.req.header('stripe-signature') ?? '');
      } catch (e) {
        return c.json({ error: `Webhook signature check failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
      }
      if (await orders.webhookSeen(db, 'stripe', event.id)) return c.json({ received: true, duplicate: true });
      await handleStripeEvent(event);
      await orders.markWebhook(db, 'stripe', event.id);
      return c.json({ received: true });
    });
  };

  async function handleStripeEvent(event: ReturnType<Payments['parseWebhook']>) {
    if (event.type === 'ignored') return;
    if (event.type === 'refunded') {
      const order = await orders.findOrder(db, 'stripe_payment_intent', event.paymentIntent);
      if (!order) return;
      await orders.updateOrder(db, order.id, { refunded_amount: event.amountRefunded });
      if (event.fullyRefunded && order.status !== 'refunded') {
        await transition(db, order.id, 'refunded', 'stripe', `Refunded ${formatMoney(event.amountRefunded, order.currency)}`);
      } else if (!event.fullyRefunded) {
        await orders.addEvent(db, order.id, 'stripe', `Partly refunded: ${formatMoney(event.amountRefunded, order.currency)} in all`);
      }
      return;
    }
    if (!event.orderId) return;
    let order: orders.OrderRow;
    try {
      order = await orders.getOrderById(db, event.orderId);
    } catch {
      return; // not one of ours (another app on the same Stripe account)
    }
    if (order.stripeSessionId && order.stripeSessionId !== event.sessionId) {
      await orders.addEvent(db, order.id, 'stripe', `Ignored an event for another Checkout session (${event.sessionId})`);
      return;
    }
    switch (event.type) {
      case 'paid': {
        if (event.amount !== order.totalAmount || event.currency !== order.currency) {
          await orders.addEvent(db, order.id, 'stripe', `Payment of ${event.amount} ${event.currency} does not match the order total: check it by hand`);
          return;
        }
        if (order.status !== 'created') {
          if (order.status === 'cancelled')
            await orders.addEvent(db, order.id, 'stripe', 'Paid after the order was cancelled: refund it from the operations page');
          return;
        }
        await transition(db, order.id, 'paid', 'stripe', `Paid ${formatMoney(event.amount, order.currency)}`, { stripe_payment_intent: event.paymentIntent });
        background(() => pipeline.processOrder(order.id));
        return;
      }
      case 'pending':
        await orders.addEvent(db, order.id, 'stripe', 'Checkout finished; waiting for the payment to clear (Pix / boleto)');
        return;
      case 'failed':
        if (order.status === 'created') await transition(db, order.id, 'cancelled', 'stripe', 'The delayed payment failed');
        return;
      case 'expired':
        if (order.status === 'created') await transition(db, order.id, 'cancelled', 'stripe', 'Checkout expired without payment');
        return;
    }
  }

  const mountPartnerWebhookAndFiles = (app: Hono<AuthEnv>) => {
    app.post('/api/webhooks/prodigi', async (c) => {
      const adapter = deps.fulfilment.prodigi;
      if (!adapter?.parseWebhook) return c.json({ error: 'Prodigi is not configured' }, 503);
      const raw = await c.req.text();
      let update;
      try {
        update = adapter.parseWebhook(raw, (n) => c.req.header(n));
      } catch (e) {
        return c.json({ error: `Webhook check failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
      }
      if (!update) return c.json({ received: true });
      if (update.eventId && (await orders.webhookSeen(db, 'prodigi', update.eventId))) return c.json({ received: true, duplicate: true });
      await pipeline.applyFulfilmentUpdate(update);
      if (update.eventId) await orders.markWebhook(db, 'prodigi', update.eventId);
      return c.json({ received: true });
    });

    app.get('/api/files/:orderId/:file', async (c) => {
      const orderId = uuid(c.req.param('orderId'), 'orderId');
      const file = oneOf(c.req.param('file'), PRINT_FILES, 'file');
      const problem = links.check(orderId, file, c.req.query('exp'), c.req.query('sig'));
      if (problem) return c.json({ error: problem }, 403);
      const order = await orders.getOrderById(db, orderId);
      if (order.status === 'refunded' || (order.status === 'cancelled' && order.kind === 'digital')) return c.json({ error: 'This order was cancelled' }, 410);
      const bytes = await storage.get(fileKey(orderId, file));
      if (!bytes) return c.json({ error: 'The print file is not ready yet' }, 404);
      return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
        'Content-Type': CONTENT_TYPES[file],
        'Content-Disposition': `attachment; filename="heritage-map-${order.number}-${order.size}.${file}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; sandbox",
        'Cache-Control': 'private, max-age=3600',
      });
    });
  };

  // ---------- Guests and customers: the order's id is its key ----------

  const mountGuest = (app: Hono<AuthEnv>) => {
    app.get('/api/shop/catalogue', (c) => {
      const country = (c.req.query('country') || 'US').toUpperCase();
      if (!COUNTRY_RE.test(country)) throw badRequest('country must be a two-letter code');
      const currency = c.req.query('currency') as Currency | undefined;
      return c.json({ ...priceList(catalogue, country, currency), paymentsReady: !!deps.payments, paymentMode: deps.payments?.mode });
    });

    /** The order, if the caller owns it or has its link (key); 404 otherwise, like trees. */
    const linkedOrder = async (c: Context<AuthEnv>) => {
      const o = await orders.getOrderById(db, uuid(c.req.param('id'), 'id'));
      if (currentUser(c)?.id === o.ownerId || links.checkOrderKey(o.id, c.req.query('k'))) return o;
      throw notFound('Order');
    };

    app.get('/api/orders/:id', async (c) => {
      const o = await linkedOrder(c);
      // Digital buyers download from here; physical orders' files are for the lab, not the customer.
      return c.json(forViewer(await detail(o, o.kind === 'digital' && o.paid && o.status !== 'refunded'), o, currentUser(c)));
    });

    app.post('/api/orders/:id/checkout', async (c) => {
      const o = await linkedOrder(c);
      if (o.status !== 'created') throw new HttpError(409, `Order ${o.number} is already ${o.status}`);
      if (!deps.payments) throw new HttpError(409, new PaymentsNotConfigured().message);
      const product = productById(catalogue, o.productId);
      const name = product ? `${product.name[o.design.lang]} ${o.size}${o.frameColour ? `, ${o.frameColour}` : ''}` : `${o.productId} ${o.size}`;
      const lines = [{ name, description: o.design.title || undefined, amount: o.unitAmount }];
      const shipping = { pt: 'Envio', en: 'Shipping', es: 'Envío' }[o.design.lang];
      if (o.shippingAmount) lines.push({ name: shipping, description: undefined, amount: o.shippingAmount });
      const session = await deps.payments.createCheckout({
        orderId: o.id,
        orderNumber: o.number,
        email: o.email,
        currency: o.currency,
        lines,
        // The buyer comes back signed in (orders are made by signed-in customers), so no key here.
        successUrl: `${deps.appUrl}/order.html?id=${o.id}&from=checkout`,
        cancelUrl: `${deps.appUrl}/order.html?id=${o.id}&from=cancel`,
        // Stripe Checkout's own page language follows the order's language.
        locale:
          o.design.lang === 'pt' ? (o.country === 'BR' ? 'pt-BR' : 'pt') : o.design.lang === 'es' ? (o.country === 'ES' ? 'es' : 'es-419') : 'en',
      });
      await orders.updateOrder(db, o.id, { stripe_session_id: session.id }, { actor: 'customer', note: 'Went to Stripe Checkout' });
      return c.json({ url: session.url });
    });

    app.post('/api/orders/:id/cancel', async (c) => {
      const o = await linkedOrder(c);
      if (o.status !== 'created') throw new HttpError(409, 'Only unpaid orders can be cancelled here; contact us for a paid order');
      const { order } = await transition(db, o.id, 'cancelled', 'customer', 'Cancelled before payment');
      return c.json(forViewer(await detail(order, false), order, currentUser(c)));
    });
  };

  // ---------- Signed-in customer ----------

  const mountAuthed = (app: Hono<AuthEnv>) => {

    app.post('/api/orders', async (c) => {
      const b = obj(await c.req.json().catch(() => null));
      const treeId = uuid(b.treeId, 'treeId');
      await repo.getTree(db, c.var.user.id, treeId); // must be mine
      const country = str(b.country, 'country', 2).toUpperCase();
      if (!COUNTRY_RE.test(country)) throw badRequest('country must be a two-letter code');
      let q;
      let design;
      try {
        q = quote(catalogue, { productId: str(b.productId, 'productId', 50), size: str(b.size, 'size', 5), country, currency: optStr(b.currency, 'currency', 3) });
        design = parseDesign(b.design, deps.designOptions);
      } catch (e) {
        if (e instanceof QuoteError || e instanceof DesignError) throw badRequest(e.message);
        throw e;
      }
      const product = productById(catalogue, q.productId)!;
      let frameColour: string | undefined;
      if (product.kind === 'framed') {
        frameColour = optStr(b.frameColour, 'frameColour', 40) ?? product.frameColours![0];
        if (!product.frameColours!.includes(frameColour)) throw badRequest(`frameColour must be one of ${product.frameColours!.join(', ')}`);
      }
      const email = str(b.email, 'email', 254);
      if (!isEmail(email)) throw badRequest('email is not a valid address');
      const shippingAddress = product.kind === 'digital' ? undefined : parseAddress(b.shippingAddress, country);
      const order = await orders.createOrder(db, { ownerId: c.var.user.id, treeId, quote: q, country, frameColour, design, email, shippingAddress });
      return c.json(await detail(order, false), 201);
    });

    app.get('/api/orders', async (c) => c.json((await orders.listOrders(db, { ownerId: c.var.user.id })).map(orders.publicOrder)));

    // ---------- Operations ----------

    const operator = (c: Context<AuthEnv>): User => {
      if (!isOperator(currentUser(c))) throw new HttpError(403, 'Operations are for the shop team only');
      return c.var.user;
    };
    // Every operations route, including ones added later, is for operators only. (No user at all
    // has already been answered 401 by requireUser.)
    app.use('/api/ops/*', async (c, next) => {
      operator(c);
      await next();
    });
    const anyOrder = (c: Context<AuthEnv>) => orders.getOrderById(db, uuid(c.req.param('id'), 'id'));

    app.get('/api/ops/orders', async (c) => {
      operator(c);
      const status = c.req.query('status') ? oneOf(c.req.query('status'), ORDER_STATUSES, 'status') : undefined;
      const list = await orders.listOrders(db, { status, limit: 500 });
      return c.json(
        list.map((o) => ({
          ...orders.publicOrder(o),
          next: allowedNext(o.status, o.kind),
          manualNext: o.fulfilment === 'manual' || !o.fulfilment || !deps.fulfilment[o.fulfilment] ? nextManualStep(o.status, o.kind) : undefined,
          fileUrl: o.files.png ? links.url(o.id, 'png', DOWNLOAD_TTL).url : undefined,
          pdfUrl: o.files.pdf ? links.url(o.id, 'pdf', DOWNLOAD_TTL).url : undefined,
        })),
      );
    });

    app.get('/api/ops/orders/:id', async (c) => {
      operator(c);
      return c.json(await detail(await anyOrder(c), true));
    });

    app.post('/api/ops/orders/:id/advance', async (c) => {
      operator(c);
      const o = await anyOrder(c);
      const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const to = b.to === undefined ? nextManualStep(o.status, o.kind) : oneOf(b.to, ORDER_STATUSES, 'to');
      if (!to) throw new HttpError(409, `Nothing to do by hand for an order that is ${o.status}`);
      if (to === 'paid' || to === 'refunded') throw new HttpError(409, `Orders become ${to} through Stripe, not by hand`);
      const note = optStr(b.note, 'note', 500);
      const patch = o.fulfilment === 'manual' && to !== 'cancelled' ? { fulfilment_status: to } : {};
      const { order } = await transition(db, o.id, to, 'operator', note ?? `Marked ${STATUS_LABELS[to].en.toLowerCase()} by ${c.var.user.email}`, patch);
      if (to === 'file_ready') background(() => pipeline.processOrder(order.id));
      return c.json(await detail(order, true));
    });

    app.post('/api/ops/orders/:id/refund', async (c) => {
      operator(c);
      const o = await anyOrder(c);
      if (!deps.payments) throw new HttpError(409, new PaymentsNotConfigured().message);
      if (!o.stripePaymentIntent) throw new HttpError(409, 'This order has no payment to refund');
      if (o.status === 'refunded') throw new HttpError(409, 'Already refunded');
      const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const left = o.totalAmount - o.refundedAmount;
      const amount = b.amount === undefined ? left : Number(b.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > left) throw badRequest(`amount must be between 1 and ${left} (minor units)`);
      const r = await deps.payments.refund(o.stripePaymentIntent, amount === o.totalAmount ? undefined : amount, o.id);
      const refunded = o.refundedAmount + amount;
      if (refunded >= o.totalAmount) {
        await transition(db, o.id, 'refunded', 'operator', `Refund ${r.id} (${r.status}) of ${formatMoney(amount, o.currency)}`, { refunded_amount: refunded });
      } else {
        await orders.updateOrder(db, o.id, { refunded_amount: refunded }, { actor: 'operator', note: `Partial refund ${r.id} (${r.status}) of ${formatMoney(amount, o.currency)}` });
      }
      return c.json(await detail(await orders.getOrderById(db, o.id), true));
    });

    app.post('/api/ops/orders/:id/retry', async (c) => {
      operator(c);
      const o = await anyOrder(c);
      // A failed partner submission left no status: clear nothing, just run again.
      await orders.addEvent(db, o.id, 'operator', `Retry requested by ${c.var.user.email}`);
      await pipeline.processOrder(o.id);
      return c.json(await detail(await orders.getOrderById(db, o.id), true));
    });

    app.post('/api/ops/orders/:id/sync', async (c) => {
      operator(c);
      const o = await anyOrder(c);
      const adapter = o.fulfilment ? deps.fulfilment[o.fulfilment] : undefined;
      if (!o.fulfilmentRef || !adapter?.status) throw new HttpError(409, 'This order is not with a partner that can be asked for its status');
      await pipeline.applyFulfilmentUpdate(await adapter.status(o.fulfilmentRef), o.fulfilment === 'prodigi' ? 'prodigi' : 'operator', o.id);
      return c.json(await detail(await orders.getOrderById(db, o.id), true));
    });

    app.get('/api/ops/orders/:id/sheet', async (c) => {
      operator(c);
      const o = await anyOrder(c);
      const product = productById(catalogue, o.productId);
      const html = productionSheet(o, product, {
        png: o.files.png ? links.url(o.id, 'png', 30 * 24 * 3600).url : undefined,
        pdf: o.files.pdf ? links.url(o.id, 'pdf', 30 * 24 * 3600).url : undefined,
      });
      return c.html(html);
    });

    app.post('/api/ops/quote', async (c) => {
      operator(c);
      const b = obj(await c.req.json().catch(() => null));
      const country = str(b.country, 'country', 2).toUpperCase();
      let q;
      try {
        q = quote(catalogue, { productId: str(b.productId, 'productId', 50), size: str(b.size, 'size', 5), country, currency: optStr(b.currency, 'currency', 3) });
      } catch (e) {
        if (e instanceof QuoteError) throw badRequest(e.message);
        throw e;
      }
      const adapter = q.fulfilment ? deps.fulfilment[q.fulfilment] : undefined;
      if (!q.sku || !adapter?.quote) throw new HttpError(409, `No partner quote for this market (${q.fulfilment ?? 'digital'})`);
      const partner = await adapter.quote({ sku: q.sku, frameColour: optStr(b.frameColour, 'frameColour', 40), country, currency: q.currency });
      return c.json({ price: q, partner });
    });
  };

  return {
    pipeline,
    mountPublic: (app: Hono<AuthEnv>) => {
      deps.devRoutes?.(app);
      mountStripeWebhook(app);
      mountPartnerWebhookAndFiles(app);
    },
    mountGuest,
    mountAuthed,
    /** Whether this user may use the operations routes (OPERATOR_EMAILS). */
    isOperator,
  };
}
