// The shop through its HTTP API: orders, Stripe Checkout and webhooks, print files, Prodigi and
// manual fulfilment, operations. Stripe and Prodigi are mocked: the Stripe SDK with its network
// calls replaced (fake-stripe.ts) and a fake fetch for Prodigi. Webhooks are signed for real.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DesignSpec } from '../../src/commerce/design';
import type { OrderDetail } from '../../src/commerce/order';
import type { TreeDetail, TreeSummary } from '../../src/model';
import { createApp } from '../app';
import { ensureDevUser } from '../auth';
import { fakeStripe } from '../commerce/fake-stripe';
import { manualFulfilment } from '../commerce/fulfilment/manual';
import { mapProdigiStatus, prodigiFulfilment } from '../commerce/fulfilment/prodigi';
import { LinkSigner } from '../commerce/links';
import * as orders from '../commerce/orders';
import { stripePayments } from '../commerce/payments';
import type { RenderFiles } from '../commerce/pipeline';
import { createCommerce, type CommerceDeps } from '../commerce/routes';
import { loadCatalogue } from '../commerce/setup';
import { designOptionIds } from '../print/assets';
import { migrate, openPglite, type Db } from '../db';
import { MemoryStorage } from '../storage';

const SAMPLE = readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8');
const PLACES = (() => {
  const p = JSON.parse(readFileSync(new URL('./fixtures/sample-places.json', import.meta.url), 'utf8'));
  delete p._comment;
  return p as Record<string, { lat: number; lon: number }>;
})();
const STRIPE_SECRET = 'whsec_test_secret_for_tests';
const PRODIGI_SECRET = 'prodigi_webhook_secret';
const API = 'http://api.test';

let db: Db;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let fake: ReturnType<typeof fakeStripe>;
let tasks: Promise<void>[];
let rendered: TreeDetail[];
let renderedDesigns: DesignSpec[];
let prodigiCalls: { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }[];

const settle = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
};

/** A fast stand-in for the real renderer that records what it was given. */
const fakeRender: RenderFiles = async (detail, design) => {
  rendered.push(detail as TreeDetail);
  renderedDesigns.push(design);
  return { png: new Uint8Array([137, 80, 78, 71]), pdf: new TextEncoder().encode('%PDF-1.7 test'), svg: '<svg/>', widthPx: 7016, heightPx: 4961, peopleOnMap: 21 };
};

let prodigiIds = 0;
let lastProdigiId = '';
const prodigiFetch: typeof fetch = async (input, init) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  prodigiCalls.push({ method: init?.method ?? 'GET', url: String(input), headers: init?.headers as Record<string, string>, body });
  if (String(input).endsWith('/orders')) return Response.json({ data: { id: (lastProdigiId = `ord_prodigi_${++prodigiIds}`), status: 'submitted' } }, { status: 202 });
  if (String(input).includes('/orders/')) return Response.json({ data: { id: String(input).split('/').pop(), status: 'shipped', shipments: [{ carrier: { name: 'DPD' }, tracking: { number: 'TRK1', url: 'https://track/TRK1' } }] } });
  if (String(input).endsWith('/quotes/order'))
    return Response.json({ data: { shippingOptions: [{ method: 'standard', items: { amount: '21.50', currency: 'EUR' }, cost: { amount: '6.00', currency: 'EUR' }, tax: { amount: '6.33', currency: 'EUR' }, total: { amount: '33.83', currency: 'EUR' } }] } });
  return new Response('not found', { status: 404 });
};

function build(over: Partial<CommerceDeps> = {}) {
  fake = fakeStripe(API, STRIPE_SECRET, async (body, sig) => app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, body }));
  const commerce = createCommerce(db, storage, () => new Date('2026-06-01T00:00:00Z'), {
    catalogue: loadCatalogue(),
    payments: stripePayments(fake.stripe, 'sk_test_x', STRIPE_SECRET),
    fulfilment: { manual: manualFulfilment, prodigi: prodigiFulfilment({ apiKey: 'sandbox_test', webhookSecret: PRODIGI_SECRET, fetch: prodigiFetch }) },
    links: new LinkSigner('a-long-enough-test-secret', API),
    render: fakeRender,
    designOptions: designOptionIds(),
    appUrl: 'http://app.test',
    operators: ['dev@localhost'],
    background: (t) => void tasks.push(t()),
    ...over,
  });
  app = createApp({ db, storage, now: () => new Date('2026-06-01T00:00:00Z'), commerce });
  return commerce;
}

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  await ensureDevUser(db);
});
afterAll(() => db.close());
beforeEach(() => {
  storage = new MemoryStorage();
  tasks = [];
  rendered = [];
  renderedDesigns = [];
  prodigiCalls = [];
  build();
});

async function call<T>(method: string, path: string, body?: unknown, expectStatus?: number): Promise<T> {
  const res = await app.request(path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
  const text = await res.text();
  if (expectStatus !== undefined) expect(res.status, text).toBe(expectStatus);
  else expect(res.ok, `${method} ${path} → ${res.status} ${text}`).toBe(true);
  try {
    return (text ? JSON.parse(text) : undefined) as T;
  } catch {
    return text as T;
  }
}

let treeId: string;
async function sampleTree() {
  if (treeId) return treeId;
  const tree = await call<TreeSummary>('POST', '/api/trees', { name: 'Costa family' });
  await call('POST', `/api/trees/${tree.id}/import`, { fileName: 'sample.ged', text: SAMPLE });
  return (treeId = tree.id);
}

const BR_ADDRESS = { name: 'Ana Costa', line1: 'Rua Augusta 100', city: 'São Paulo', state: 'SP', postalCode: '01304-000', country: 'BR', taxId: '123.456.789-09' };
const PT_ADDRESS = { name: 'Rui Costa', line1: 'Rua de Santa Catarina 1', city: 'Porto', postalCode: '4000-447', country: 'PT' };

async function newOrder(over: Record<string, unknown> = {}) {
  return call<OrderDetail>(
    'POST',
    '/api/orders',
    { treeId: await sampleTree(), productId: 'digital', size: 'A1', country: 'PT', email: 'ana@example.com', design: { styleId: 'antique', places: PLACES }, ...over },
    201,
  );
}

/** Sends a signed Stripe event to the webhook. */
async function stripeEvent(type: string, object: Record<string, unknown>, secret = STRIPE_SECRET) {
  const e = secret === STRIPE_SECRET ? fake.event(type, object) : fakeStripe(API, secret).event(type, object);
  return app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': e.signature, 'content-type': 'application/json' }, body: e.payload });
}

/** Creates the Checkout Session and pays it (checkout.session.completed), then lets background work finish. */
async function checkoutAndPay(orderId: string) {
  const { url } = await call<{ url: string }>('POST', `/api/orders/${orderId}/checkout`);
  const id = url.split('/').pop()!;
  const res = await stripeEvent('checkout.session.completed', fake.sessionObject(fake.sessions.get(id)!, true));
  expect(res.status, await res.clone().text()).toBe(200);
  await settle();
  return call<OrderDetail>('GET', `/api/orders/${orderId}`);
}

const statuses = (o: OrderDetail) => o.events.filter((e) => e.toStatus).map((e) => e.toStatus);

describe('shop catalogue', () => {
  it('prices products for the visitor’s country', async () => {
    const list = await call<{ currency: string; placeholderPrices: boolean; paymentsReady: boolean; products: { id: string }[] }>('GET', '/api/shop/catalogue?country=BR');
    expect(list).toMatchObject({ currency: 'BRL', placeholderPrices: true, paymentsReady: true });
    expect(list.products.map((p) => p.id)).toEqual(['digital', 'print', 'framed']);
  });
});

describe('creating orders', () => {
  it('prices the order on the server, whatever the browser says', async () => {
    const o = await newOrder({ productId: 'framed', size: 'A2', country: 'BR', shippingAddress: BR_ADDRESS, totalAmount: 1, frameColour: 'natural' });
    expect(o).toMatchObject({ status: 'created', currency: 'BRL', unitAmount: 64990, shippingAmount: 3990, totalAmount: 68980, fulfilment: 'manual', frameColour: 'natural', number: expect.stringMatching(/^HM-\d+$/) });
    expect(o.shippingAddress?.taxId).toBe('12345678909');
    expect(statuses(o)).toEqual(['created']);
  });

  it('refuses bad orders', async () => {
    const t = await sampleTree();
    const base = { treeId: t, productId: 'print', size: 'A2', country: 'BR', email: 'a@b.co', design: {} };
    await call('POST', '/api/orders', { ...base, productId: 'mug' }, 400);
    await call('POST', '/api/orders', { ...base, size: 'A0' }, 400);
    await call('POST', '/api/orders', base, 400); // no address for a print
    await call('POST', '/api/orders', { ...base, shippingAddress: { ...BR_ADDRESS, taxId: undefined } }, 400); // Brazil needs a CPF
    await call('POST', '/api/orders', { ...base, shippingAddress: PT_ADDRESS }, 400); // address in another country than the price
    await call('POST', '/api/orders', { ...base, productId: 'framed', frameColour: 'pink', shippingAddress: BR_ADDRESS }, 400);
    await call('POST', '/api/orders', { ...base, email: 'not-an-email', shippingAddress: BR_ADDRESS }, 400);
    await call('POST', '/api/orders', { ...base, design: { styleId: 'neon' }, shippingAddress: BR_ADDRESS }, 400);
    await call('POST', '/api/orders', { ...base, treeId: '00000000-0000-4000-8000-000000000099', shippingAddress: BR_ADDRESS }, 404);
  });

  it('keeps every design option and renders the file with them', async () => {
    const design = { styleId: 'nautical', layoutId: 'vignette', borderId: 'rope', finishId: 'deckled', flagScale: 1.6, show: { surnames: false, flags: 'both' }, places: PLACES };
    const o = await newOrder({ design });
    expect(o.design).toMatchObject({ styleId: 'nautical', layoutId: 'vignette', borderId: 'rope', finishId: 'deckled', flagScale: 1.6, show: { surnames: false, flags: 'both' } });
    await checkoutAndPay(o.id);
    expect(renderedDesigns.at(-1)).toMatchObject({ layoutId: 'vignette', borderId: 'rope', finishId: 'deckled', flagScale: 1.6, show: { surnames: false } });
    const t = await sampleTree();
    for (const bad of [{ layoutId: 'globe' }, { borderId: 'baroque' }, { finishId: 'glossy' }, { flagScale: 9 }])
      await call('POST', '/api/orders', { treeId: t, productId: 'digital', size: 'A1', country: 'PT', email: 'a@b.co', design: bad }, 400);
  });

  it('keeps orders private to their owner', async () => {
    await db.query("insert into users (id, email, display_name) values ('00000000-0000-4000-8000-000000000002', 'other@example.com', 'Other') on conflict do nothing");
    const [{ id: otherTree }] = await db.query<{ id: string }>("insert into trees (id, owner_id, name) values (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'Theirs') returning id");
    const theirs = await orders.createOrder(db, {
      ownerId: '00000000-0000-4000-8000-000000000002',
      treeId: otherTree,
      quote: { productId: 'digital', kind: 'digital', size: 'A1', currency: 'EUR', market: 'EU', unitAmount: 1490, shippingAmount: 0, totalAmount: 1490 },
      country: 'PT',
      design: { styleId: 'antique', orientation: 'landscape', area: 'family', lang: 'pt', title: '', subtitle: '', dedication: '', layoutId: 'accurate', flagScale: 1, show: { dates: true, placeNames: true, flags: 'origins', countryNames: true, oceanNames: true, compass: true, scaleBar: true, legend: true, graticule: true, surnames: true }, selection: { branch: 'all' }, places: {} },
      email: 'other@example.com',
    });
    await call('GET', `/api/orders/${theirs.id}`, undefined, 404);
    await call('POST', `/api/orders/${theirs.id}/checkout`, undefined, 404);
    const mine = await call<OrderDetail[]>('GET', '/api/orders');
    expect(mine.some((o) => o.id === theirs.id)).toBe(false);
  });

  it('lets the customer cancel an unpaid order only', async () => {
    const o = await newOrder();
    expect((await call<OrderDetail>('POST', `/api/orders/${o.id}/cancel`)).status).toBe('cancelled');
    await call('POST', `/api/orders/${o.id}/checkout`, undefined, 409);
  });
});

describe('Stripe Checkout and webhooks', () => {
  it('creates a Checkout Session with the server’s price', async () => {
    const o = await newOrder({ productId: 'print', size: 'A3', country: 'PT', shippingAddress: PT_ADDRESS, design: { lang: 'pt', title: 'Família Costa' } });
    const { url } = await call<{ url: string }>('POST', `/api/orders/${o.id}/checkout`);
    expect(url).toMatch(/^http:\/\/api\.test\/api\/dev\/checkout\/cs_test_fake_/);
    const params = fake.created.at(-1)!;
    expect(params).toMatchObject({
      mode: 'payment',
      client_reference_id: o.id,
      customer_email: 'ana@example.com',
      metadata: { order_id: o.id, order_number: o.number },
      success_url: `http://app.test/order.html?id=${o.id}&from=checkout`,
      locale: 'pt',
    });
    expect(params.line_items).toEqual([{ quantity: 1, price_data: { currency: 'eur', unit_amount: 3900, product_data: { name: 'Impressão fine-art (sem moldura) A3', description: 'Família Costa' } } }]);
    expect(params).not.toHaveProperty('payment_method_types'); // removed from the Stripe API in 2026-09
  });

  it('offers Pix for BRL orders when enabled', async () => {
    const f = fake;
    build({ payments: stripePayments(f.stripe, 'sk_test_x', STRIPE_SECRET, { pixForBrl: true }) });
    const o = await newOrder({ country: 'BR' });
    await call('POST', `/api/orders/${o.id}/checkout`);
    expect(f.created.at(-1)).toMatchObject({ allowed_payment_method_types: ['card', 'pix'], payment_method_options: { pix: { expires_after_seconds: 3600 } } });
  });

  it('takes a digital order from payment to download, rendering only the public view', async () => {
    const o = await newOrder();
    const done = await checkoutAndPay(o.id);
    expect(done.status).toBe('delivered');
    expect(statuses(done)).toEqual(['created', 'paid', 'file_ready', 'delivered']);
    expect(done.files).toMatchObject({ png: true, pdf: true, widthPx: 7016, heightPx: 4961 });

    // The renderer never saw a living person's name or places.
    expect(rendered).toHaveLength(1);
    const privates = rendered[0].people.filter((p) => p.isPrivate);
    expect(privates.length).toBeGreaterThan(0);
    for (const p of privates) {
      expect(p.name).toBe('Private');
      expect(p.birth ?? p.baptism ?? p.death).toBeUndefined();
    }

    // Signed links work, and only as signed.
    expect(done.downloads?.png).toMatch(/^http:\/\/api\.test\/api\/files\/.+\/png\?exp=\d+&sig=/);
    const path = done.downloads!.png!.replace(API, '');
    const file = await app.request(path);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect((await app.request(path.replace('sig=', 'sig=x'))).status).toBe(403);
    expect((await app.request(path.replace('/png?', '/pdf?'))).status).toBe(403);
    expect((await app.request(path.replace(/exp=\d+/, 'exp=9999999999'))).status).toBe(403);
  });

  it('expires download links', async () => {
    const links = new LinkSigner('a-long-enough-test-secret', API, () => Date.parse('2026-01-01'));
    const { url } = links.url('00000000-0000-4000-8000-000000000123', 'png', 60);
    const q = new URL(url).searchParams;
    const later = new LinkSigner('a-long-enough-test-secret', API, () => Date.parse('2026-01-01') + 61_000);
    expect(links.check('00000000-0000-4000-8000-000000000123', 'png', q.get('exp')!, q.get('sig')!)).toBeUndefined();
    expect(later.check('00000000-0000-4000-8000-000000000123', 'png', q.get('exp')!, q.get('sig')!)).toMatch(/expired/);
  });

  it('rejects events with a bad signature and changes nothing', async () => {
    const o = await newOrder();
    await call('POST', `/api/orders/${o.id}/checkout`);
    const s = fake.sessions.values().next().value!;
    const res = await stripeEvent('checkout.session.completed', fake.sessionObject(s, true), 'whsec_wrong_secret');
    expect(res.status).toBe(400);
    const unsigned = await app.request('/api/webhooks/stripe', { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(400);
    expect((await call<OrderDetail>('GET', `/api/orders/${o.id}`)).status).toBe('created');
  });

  it('handles a redelivered event once', async () => {
    const o = await newOrder();
    await call('POST', `/api/orders/${o.id}/checkout`);
    const s = [...fake.sessions.values()].at(-1)!;
    const e = fake.event('checkout.session.completed', fake.sessionObject(s, true));
    const send = () => app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': e.signature }, body: e.payload });
    expect(await (await send()).json()).toEqual({ received: true });
    expect(await (await send()).json()).toEqual({ received: true, duplicate: true });
    await settle();
    const done = await call<OrderDetail>('GET', `/api/orders/${o.id}`);
    expect(statuses(done).filter((s) => s === 'paid')).toHaveLength(1);
    expect(rendered).toHaveLength(1);
  });

  it('does not mark an order paid when the amount does not match', async () => {
    const o = await newOrder();
    await call('POST', `/api/orders/${o.id}/checkout`);
    const s = [...fake.sessions.values()].at(-1)!;
    await stripeEvent('checkout.session.completed', { ...fake.sessionObject(s, true), amount_total: 100 });
    const after = await call<OrderDetail>('GET', `/api/orders/${o.id}`);
    expect(after.status).toBe('created');
    expect(after.events.at(-1)?.note).toMatch(/does not match/);
  });

  it('waits for Pix to clear, then fulfils on async_payment_succeeded', async () => {
    const o = await newOrder({ country: 'BR' });
    await call('POST', `/api/orders/${o.id}/checkout`);
    const s = [...fake.sessions.values()].at(-1)!;
    await stripeEvent('checkout.session.completed', fake.sessionObject(s, false));
    expect((await call<OrderDetail>('GET', `/api/orders/${o.id}`)).status).toBe('created');
    await stripeEvent('checkout.session.async_payment_succeeded', fake.sessionObject(s, true));
    await settle();
    expect((await call<OrderDetail>('GET', `/api/orders/${o.id}`)).status).toBe('delivered');
  });

  it('cancels an order whose Checkout expired', async () => {
    const o = await newOrder();
    await call('POST', `/api/orders/${o.id}/checkout`);
    const s = [...fake.sessions.values()].at(-1)!;
    await stripeEvent('checkout.session.expired', fake.sessionObject(s, false));
    expect((await call<OrderDetail>('GET', `/api/orders/${o.id}`)).status).toBe('cancelled');
  });

  it('refunds through Stripe and accepts the charge.refunded event afterwards', async () => {
    const o = await newOrder();
    await checkoutAndPay(o.id);
    const refunded = await call<OrderDetail>('POST', `/api/ops/orders/${o.id}/refund`, {});
    expect(refunded).toMatchObject({ status: 'refunded', refundedAmount: o.totalAmount });
    expect(fake.refunds.at(-1)).toMatchObject({ payment_intent: expect.stringMatching(/^pi_fake_/), metadata: { order_id: o.id } });
    const pi = fake.refunds.at(-1)!.payment_intent;
    const res = await stripeEvent('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: pi, amount_refunded: o.totalAmount, refunded: true });
    expect(res.status).toBe(200);
    const after = await call<OrderDetail>('GET', `/api/orders/${o.id}`);
    expect(statuses(after).filter((s) => s === 'refunded')).toHaveLength(1);
    expect(after.downloads).toBeUndefined();
    await call('POST', `/api/ops/orders/${o.id}/refund`, {}, 409);
  });

  it('records a partial refund without changing the status', async () => {
    const o = await newOrder();
    await checkoutAndPay(o.id);
    const r = await call<OrderDetail>('POST', `/api/ops/orders/${o.id}/refund`, { amount: 500 });
    expect(r).toMatchObject({ status: 'delivered', refundedAmount: 500 });
    expect(fake.refunds.at(-1)).toMatchObject({ amount: 500 });
    await call('POST', `/api/ops/orders/${o.id}/refund`, { amount: o.totalAmount }, 400);
  });

  it('answers 409 at checkout when payments are not configured', async () => {
    build({ payments: undefined });
    const o = await newOrder();
    await call('POST', `/api/orders/${o.id}/checkout`, undefined, 409);
    expect((await app.request('/api/webhooks/stripe', { method: 'POST', body: '{}' })).status).toBe(503);
  });
});

describe('Prodigi fulfilment (Portugal)', () => {
  const prodigiEvent = (body: unknown, secret = PRODIGI_SECRET, t = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return app.request('/api/webhooks/prodigi', { method: 'POST', headers: { 'x-prodigi-signature': `t=${t}, v1=${sig}`, 'content-type': 'application/json' }, body: raw });
  };

  it('sends the paid order with its SKU and a signed file link, then follows Prodigi’s webhooks', async () => {
    const o = await newOrder({ productId: 'framed', size: 'A2', frameColour: 'black', shippingAddress: PT_ADDRESS });
    const sent = await checkoutAndPay(o.id);
    const ref = lastProdigiId;
    expect(sent).toMatchObject({ status: 'sent_to_production', fulfilmentRef: ref, fulfilmentStatus: 'submitted' });

    const post = prodigiCalls.find((c) => c.method === 'POST' && c.url === 'https://api.prodigi.com/v5/orders')!;
    expect(post.headers).toMatchObject({ 'X-API-Key': 'sandbox_test', 'Idempotency-Key': `order-${o.id}` });
    expect(post.body).toMatchObject({
      merchantReference: o.number,
      submit: true,
      recipient: { name: 'Rui Costa', email: 'ana@example.com', address: { line1: 'Rua de Santa Catarina 1', townOrCity: 'Porto', postalOrZipCode: '4000-447', countryCode: 'PT' } },
      items: [{ sku: 'GLOBAL-CFPM-A2', quantity: 1, attributes: { color: 'black' }, recipientCost: { amount: '169.00', currency: 'EUR' } }],
    });
    const asset = (post.body!.items as { assets: { url: string }[] }[])[0].assets[0].url;
    expect(asset).toMatch(new RegExp(`^${API}/api/files/${o.id}/png\\?exp=\\d+&sig=`));
    expect((await app.request(asset.replace(API, ''))).status).toBe(200);

    // A wrong signature changes nothing.
    expect((await prodigiEvent({ id: 'evt_x', type: 'shipment.dispatched', data: { orderId: ref } }, 'wrong')).status).toBe(400);
    expect((await prodigiEvent({ id: 'evt_old', type: 'shipment.dispatched', data: { orderId: ref } }, PRODIGI_SECRET, 1_000_000)).status).toBe(400);

    const shipped = { id: 'evt_1', type: 'shipment.dispatched', data: { orderId: ref, shipment: { carrier: { name: 'CTT' }, tracking: { number: 'RR123PT', url: 'https://ctt/RR123PT' } } } };
    expect((await prodigiEvent(shipped)).status).toBe(200);
    expect(await (await prodigiEvent(shipped)).json()).toEqual({ received: true, duplicate: true });
    let now = await call<OrderDetail>('GET', `/api/orders/${o.id}`);
    expect(now).toMatchObject({ status: 'shipped', tracking: [{ carrier: 'CTT', number: 'RR123PT', url: 'https://ctt/RR123PT' }] });

    await prodigiEvent({ id: 'evt_2', type: 'shipment.delivered', data: { orderId: ref } });
    now = await call<OrderDetail>('GET', `/api/orders/${o.id}`);
    expect(statuses(now)).toEqual(['created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered']);
    // Physical orders don't hand the print file to the customer.
    expect(now.downloads).toBeUndefined();
  });

  it('polls Prodigi for the status from the operations page', async () => {
    const o = await newOrder({ productId: 'print', size: 'A3', shippingAddress: PT_ADDRESS });
    await checkoutAndPay(o.id);
    const synced = await call<OrderDetail>('POST', `/api/ops/orders/${o.id}/sync`);
    expect(synced).toMatchObject({ status: 'shipped', fulfilmentStatus: 'shipped', tracking: [{ carrier: 'DPD', number: 'TRK1' }] });
  });

  it('notes a failed submission and retries it', async () => {
    let fail = true;
    const flaky: typeof fetch = async (input, init) => (fail ? new Response(JSON.stringify({ message: 'Unknown SKU', issues: [{ path: 'items[0].sku', message: 'not found' }] }), { status: 400 }) : prodigiFetch(input, init));
    build({ fulfilment: { manual: manualFulfilment, prodigi: prodigiFulfilment({ apiKey: 'sandbox_test', fetch: flaky }) } });
    const o = await newOrder({ productId: 'print', size: 'A2', shippingAddress: PT_ADDRESS });
    const stuck = await checkoutAndPay(o.id);
    expect(stuck.status).toBe('file_ready');
    expect(stuck.events.at(-1)?.note).toMatch(/Sending to prodigi failed: .*Unknown SKU.*items\[0\]\.sku/);
    fail = false;
    expect((await call<OrderDetail>('POST', `/api/ops/orders/${o.id}/retry`)).status).toBe('sent_to_production');
  });

  it('gets the partner’s cost for a product', async () => {
    const q = await call<{ price: { totalAmount: number }; partner: { total: number; currency: string }[] }>('POST', '/api/ops/quote', { productId: 'print', size: 'A2', country: 'PT' });
    expect(q.price.totalAmount).toBe(5500);
    expect(q.partner).toEqual([{ method: 'standard', currency: 'EUR', items: 2150, shipping: 600, tax: 633, total: 3383 }]);
  });

  it('maps Prodigi statuses', () => {
    expect(mapProdigiStatus('in_production')).toEqual({ status: 'sent_to_production' });
    expect(mapProdigiStatus('completed')).toEqual({ status: 'shipped' });
    expect(mapProdigiStatus('shipment.delivered')).toEqual({ status: 'delivered' });
    expect(mapProdigiStatus('order.failed').problem).toMatch(/failed/);
    expect(mapProdigiStatus('draft')).toEqual({});
    expect(() => prodigiFulfilment({ apiKey: 'live_abc' })).toThrow(/sandbox/);
  });
});

describe('manual fulfilment (Brazil) and operations', () => {
  it('waits for an operator, who moves it on step by step with a production sheet', async () => {
    const o = await newOrder({ productId: 'framed', size: 'A3', country: 'BR', frameColour: 'antique gold', shippingAddress: BR_ADDRESS });
    const ready = await checkoutAndPay(o.id);
    expect(ready).toMatchObject({ status: 'file_ready', fulfilmentStatus: 'awaiting_operator' });
    expect(prodigiCalls).toHaveLength(0);

    const list = await call<(OrderDetail & { manualNext?: string; fileUrl?: string })[]>('GET', '/api/ops/orders?status=file_ready');
    const row = list.find((r) => r.id === o.id)!;
    expect(row.manualNext).toBe('sent_to_production');
    expect(row.fileUrl).toMatch(/\/api\/files\/.+\/png\?/);

    const sheet = await call<string>('GET', `/api/ops/orders/${o.id}/sheet`);
    expect(sheet).toContain(o.number);
    expect(sheet).toContain('420 × 297 mm, paisagem');
    expect(sheet).toContain('CPF/CNPJ 12345678909');
    expect(sheet).toContain('antique gold');
    expect(sheet).toMatch(/href="http:\/\/api\.test\/api\/files\/[^"]+\/png\?exp=/);

    await call('POST', `/api/ops/orders/${o.id}/advance`, {});
    await call('POST', `/api/ops/orders/${o.id}/advance`, { note: 'Correios AA123456789BR' });
    const done = await call<OrderDetail>('POST', `/api/ops/orders/${o.id}/advance`, {});
    expect(statuses(done)).toEqual(['created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered']);
    expect(done.events.find((e) => e.toStatus === 'shipped')?.note).toBe('Correios AA123456789BR');
    expect(done.fulfilmentStatus).toBe('delivered');
    await call('POST', `/api/ops/orders/${o.id}/advance`, {}, 409);
    await call('POST', `/api/ops/orders/${o.id}/advance`, { to: 'paid' }, 409);
  });

  it('keeps operations to operators', async () => {
    build({ operators: ['someone@else'] });
    await call('GET', '/api/ops/orders', undefined, 403);
  });

  it('records a render failure and resumes unfinished orders', async () => {
    let broken = true;
    const flakyRender: RenderFiles = async (d, design, paper) => {
      if (broken) throw new Error('out of memory');
      return fakeRender(d, design, paper);
    };
    const c = build({ render: flakyRender });
    const o = await newOrder();
    const stuck = await checkoutAndPay(o.id);
    expect(stuck).toMatchObject({ status: 'paid', fileError: 'out of memory' });
    broken = false;
    expect(await c.pipeline.resume()).toBeGreaterThanOrEqual(1);
    expect((await call<OrderDetail>('GET', `/api/orders/${o.id}`)).status).toBe('delivered');
  });
});
