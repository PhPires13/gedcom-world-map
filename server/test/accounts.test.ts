// Accounts: sign-in by e-mail link, sessions, the open-redirect guard, rate limits, who may use
// the operations routes, and guests following an order by its link. The API runs with
// AUTH_MODE=required here (the other test files use the dev fallback).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderDetail } from '../../src/commerce/order';
import { safeNextPath } from '../accounts';
import { createApp, type AuthSettings } from '../app';
import { DEV_USER, ensureDevUser, hashToken } from '../auth';
import { manualFulfilment } from '../commerce/fulfilment/manual';
import { LinkSigner } from '../commerce/links';
import * as orders from '../commerce/orders';
import { createCommerce } from '../commerce/routes';
import { loadCatalogue, operatorsFromEnv } from '../commerce/setup';
import { migrate, openPglite, type Db } from '../db';
import { ConsoleMailer } from '../mail/console';
import { designOptionIds } from '../print/assets';
import { MemoryStorage } from '../storage';

let db: Db;
let mailer: ConsoleMailer;
let clock: Date;
let app: ReturnType<typeof createApp>;
const links = new LinkSigner('a-long-enough-test-secret', 'http://api.test');

function build(auth: AuthSettings = {}, operators = ['ops@example.com']) {
  mailer = new ConsoleMailer({ log: false });
  const now = () => clock;
  const storage = new MemoryStorage();
  const commerce = createCommerce(db, storage, now, {
    catalogue: loadCatalogue(),
    fulfilment: { manual: manualFulfilment },
    links,
    render: async () => {
      throw new Error('no rendering in these tests');
    },
    designOptions: designOptionIds(),
    appUrl: 'http://app.test',
    operators,
    background: () => undefined,
  });
  app = createApp({
    db,
    storage,
    now,
    commerce,
    mailer,
    auth: {
      mode: 'required',
      apiUrl: 'http://api.test',
      appUrl: 'http://app.test',
      secureCookies: true,
      trustProxy: true,
      limits: { perEmail: { limit: 50, windowMs: 60_000 }, perIp: { limit: 500, windowMs: 60_000 } },
      ...auth,
    },
  });
}

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  await ensureDevUser(db);
});
afterAll(() => db.close());
beforeEach(() => {
  clock = new Date('2026-06-01T12:00:00Z');
  build();
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1', ...headers },
});

/** Asks for a sign-in link and returns the token from the e-mail. */
async function requestLink(email: string, extra: Record<string, unknown> = {}, ip = '203.0.113.1') {
  const res = await app.request('/api/auth/request', json({ email, ...extra }, { 'x-forwarded-for': ip }));
  expect(res.status, await res.clone().text()).toBe(200);
  const mail = mailer.last(email.trim().toLowerCase(), 'magic_link')!;
  const url = new URL(/http:\/\/api\.test\/api\/auth\/verify\?token=\S+/.exec(mail.text)![0]);
  return url.searchParams.get('token')!;
}

/** Follows the sign-in link; returns the redirect and the session cookie set (if any). */
async function verify(token: string, cookie?: string) {
  const res = await app.request(`/api/auth/verify?token=${encodeURIComponent(token)}`, { headers: cookie ? { cookie } : {} });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, location: res.headers.get('location'), setCookie, cookie: /hm_session=([^;]+)/.exec(setCookie)?.[0] };
}

async function signIn(email: string) {
  const v = await verify(await requestLink(email));
  expect(v.cookie).toBeTruthy();
  return v.cookie!;
}

const get = (path: string, cookie?: string, query = '') => app.request(path + query, { headers: cookie ? { cookie } : {} });

describe('sign-in by e-mail link', () => {
  it('e-mails a link that starts a session in an httpOnly, Secure, SameSite=Lax cookie', async () => {
    expect((await get('/api/me')).status).toBe(401);
    expect((await get('/api/trees')).status).toBe(401);

    const token = await requestLink('Ana@Example.com', { lang: 'en' });
    const mail = mailer.last('ana@example.com', 'magic_link')!;
    expect(mail.subject).toBe('Your sign-in link');
    expect(mail.html).toContain('http://api.test/api/auth/verify?token=');
    // Only the hash is stored.
    const [row] = await db.query<{ token_hash: string; expires_at: Date }>('select token_hash, expires_at from login_tokens where email = $1', ['ana@example.com']);
    expect(row.token_hash).toBe(hashToken(token));
    expect(row.token_hash).not.toContain(token);
    expect(new Date(row.expires_at).getTime() - clock.getTime()).toBe(15 * 60 * 1000);

    const v = await verify(token);
    expect(v.status).toBe(303);
    expect(v.location).toBe('http://app.test/account.html');
    expect(v.setCookie).toMatch(/HttpOnly/i);
    expect(v.setCookie).toMatch(/Secure/i);
    expect(v.setCookie).toMatch(/SameSite=Lax/i);
    expect(v.setCookie).toMatch(/Path=\//);

    const me = await get('/api/me', v.cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'ana@example.com', operator: false });
    expect((await get('/api/trees', v.cookie)).status).toBe(200);
    // The session id itself is not in the database either.
    const sessions = await db.query<{ id_hash: string }>('select id_hash from sessions');
    expect(sessions.some((s) => v.cookie!.includes(s.id_hash))).toBe(false);
  });

  it('uses each link once', async () => {
    const token = await requestLink('once@example.com');
    expect((await verify(token)).cookie).toBeTruthy();
    const again = await verify(token);
    expect(again.location).toBe('http://app.test/login.html?error=link');
    expect(again.cookie).toBeUndefined();
    expect((await verify('not-a-real-token')).location).toBe('http://app.test/login.html?error=link');
  });

  it('refuses a link after 15 minutes', async () => {
    const token = await requestLink('late@example.com');
    clock = new Date(clock.getTime() + 15 * 60 * 1000 + 1000);
    const v = await verify(token);
    expect(v.location).toBe('http://app.test/login.html?error=link');
    expect(v.cookie).toBeUndefined();
  });

  it('gives a fresh session on every sign-in and ends sessions on logout or expiry', async () => {
    const first = await signIn('rotate@example.com');
    const second = (await verify(await requestLink('rotate@example.com'), first)).cookie!;
    expect(second).not.toBe(first);
    expect((await get('/api/me', first)).status).toBe(401); // the browser's old session was replaced
    expect((await get('/api/me', second)).status).toBe(200);

    const users = await db.query('select id from users where email = $1', ['rotate@example.com']);
    expect(users).toHaveLength(1);

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie: second } });
    expect(out.headers.get('set-cookie')).toMatch(/hm_session=;/);
    expect((await get('/api/me', second)).status).toBe(401);

    const third = await signIn('rotate@example.com');
    clock = new Date(clock.getTime() + 31 * 24 * 3600 * 1000);
    expect((await get('/api/me', third)).status).toBe(401);
  });

  it('only goes back to paths on this site', async () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'evil.example', '/ok\nLocation: x']) {
      const res = await app.request('/api/auth/request', json({ email: 'next@example.com', next: bad }));
      expect(res.status, bad).toBe(400);
    }
    const v = await verify(await requestLink('next@example.com', { next: '/order.html?id=abc#top' }));
    expect(v.location).toBe('http://app.test/order.html?id=abc#top');

    expect(safeNextPath('/ops.html')).toBe('/ops.html');
    expect(safeNextPath('/a/../b?x=1')).toBe('/b?x=1');
    expect(safeNextPath('//evil.example')).toBeUndefined();
    expect(safeNextPath('/\\evil.example')).toBeUndefined();
    expect(safeNextPath('https://app.test/')).toBeUndefined();
    expect(safeNextPath('')).toBeUndefined();
  });

  it('limits link requests per e-mail and per IP', async () => {
    build({ limits: { perEmail: { limit: 3, windowMs: 15 * 60 * 1000 }, perIp: { limit: 5, windowMs: 15 * 60 * 1000 } } });
    for (let i = 0; i < 3; i++) await requestLink('busy@example.com', {}, `198.51.100.${i}`);
    const limited = await app.request('/api/auth/request', json({ email: 'busy@example.com' }, { 'x-forwarded-for': '198.51.100.9' }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mailer.sent.filter((m) => m.to === 'busy@example.com')).toHaveLength(3);

    for (let i = 0; i < 5; i++) await requestLink(`ip${i}@example.com`, {}, '192.0.2.7');
    expect((await app.request('/api/auth/request', json({ email: 'ip9@example.com' }, { 'x-forwarded-for': '192.0.2.7' }))).status).toBe(429);
    // Another address from another IP is not held back.
    await requestLink('fresh@example.com', {}, '192.0.2.8');

    // The window passes.
    clock = new Date(clock.getTime() + 15 * 60 * 1000 + 1);
    await requestLink('busy@example.com', {}, '198.51.100.10');
  });

  it('refuses addresses that are not e-mail addresses', async () => {
    expect((await app.request('/api/auth/request', json({ email: 'not an address' }))).status).toBe(400);
    expect((await app.request('/api/auth/request', json({}))).status).toBe(400);
  });

  it('answers 502 when the e-mail cannot be sent', async () => {
    mailer.failWith = new Error('smtp down');
    const res = await app.request('/api/auth/request', json({ email: 'down@example.com' }));
    expect(res.status).toBe(502);
  });
});

describe('operations need an operator', () => {
  it('401 without a session, 403 for a customer, 200 for an operator', async () => {
    expect((await get('/api/ops/orders')).status).toBe(401);
    expect((await app.request('/api/ops/orders/00000000-0000-4000-8000-000000000009/refund', json({}))).status).toBe(401);
    const customer = await signIn('customer@example.com');
    expect((await get('/api/ops/orders', customer)).status).toBe(403);
    expect((await app.request('/api/ops/orders/00000000-0000-4000-8000-000000000009/refund', json({}, { cookie: customer }))).status).toBe(403);
    const ops = await signIn('OPS@example.com');
    expect((await get('/api/ops/orders', ops)).status).toBe(200);
    expect(await (await get('/api/me', ops)).json()).toMatchObject({ operator: true });
  });

  it('in dev mode the dev user is an operator without signing in', async () => {
    expect(operatorsFromEnv({}, 'dev')).toEqual(['dev@localhost']);
    expect(operatorsFromEnv({}, 'required')).toEqual([]);
    expect(operatorsFromEnv({ OPERATOR_EMAILS: ' A@x.com, b@y.com ' }, 'required')).toEqual(['a@x.com', 'b@y.com']);
    build({ mode: 'dev' }, operatorsFromEnv({}, 'dev'));
    expect((await get('/api/ops/orders')).status).toBe(200);
    expect(await (await get('/api/me')).json()).toMatchObject({ id: DEV_USER.id, operator: true });
    // A real session still wins over the dev fallback.
    const someone = await signIn('someone@example.com');
    expect(await (await get('/api/me', someone)).json()).toMatchObject({ email: 'someone@example.com' });
    expect((await get('/api/ops/orders', someone)).status).toBe(403);
  });
});

describe('orders and accounts', () => {
  async function orderFor(ownerEmail: string) {
    const cookie = await signIn(ownerEmail);
    const me = (await (await get('/api/me', cookie)).json()) as { id: string };
    const [{ id: treeId }] = await db.query<{ id: string }>("insert into trees (id, owner_id, name) values (gen_random_uuid(), $1, 'Mine') returning id", [me.id]);
    const order = await orders.createOrder(db, {
      ownerId: me.id,
      treeId,
      quote: { productId: 'print', kind: 'print', size: 'A3', currency: 'BRL', market: 'BR', fulfilment: 'manual', unitAmount: 1000, shippingAmount: 0, totalAmount: 1000 },
      country: 'BR',
      lang: 'pt',
      design: { styleId: 'antique', orientation: 'landscape', area: 'family', lang: 'pt', title: '', subtitle: '', dedication: '', layoutId: 'accurate', flagScale: 1, show: { dates: true, placeNames: true, flags: 'origins', countryNames: true, oceanNames: true, compass: true, scaleBar: true, legend: true, graticule: true, surnames: true }, selection: { branch: 'all' }, places: {} },
      email: ownerEmail,
      shippingAddress: { name: 'Ana', line1: 'Rua A 1', city: 'São Paulo', postalCode: '01000-000', country: 'BR', phone: '+55 11 99999-0000', taxId: '12345678909' },
    });
    return { cookie, order };
  }

  it('lists a signed-in customer’s orders in their account, and only theirs', async () => {
    const { cookie, order } = await orderFor('buyer@example.com');
    const mine = (await (await get('/api/orders', cookie)).json()) as OrderDetail[];
    expect(mine.map((o) => o.id)).toEqual([order.id]);
    const other = await signIn('nosy@example.com');
    expect(await (await get('/api/orders', other)).json()).toEqual([]);
    expect((await get(`/api/orders/${order.id}`, other)).status).toBe(404);
    expect((await get('/api/orders')).status).toBe(401);
  });

  it('opens an order for a guest with the order link’s key, without phone and tax id', async () => {
    const { cookie, order } = await orderFor('guestlink@example.com');
    expect((await get(`/api/orders/${order.id}`)).status).toBe(404);
    expect((await get(`/api/orders/${order.id}`, undefined, '?k=wrong')).status).toBe(404);
    const res = await get(`/api/orders/${order.id}`, undefined, `?k=${links.orderKey(order.id)}`);
    expect(res.status).toBe(200);
    const seen = (await res.json()) as OrderDetail;
    expect(seen.number).toBe(order.number);
    expect(seen.shippingAddress).toMatchObject({ city: 'São Paulo' });
    expect(seen.shippingAddress?.taxId).toBeUndefined();
    expect(seen.shippingAddress?.phone).toBeUndefined();
    // The owner sees everything.
    const own = (await (await get(`/api/orders/${order.id}`, cookie)).json()) as OrderDetail;
    expect(own.shippingAddress?.taxId).toBe('12345678909');
    // A guest with the key can cancel the unpaid order; one without can't touch it.
    expect((await app.request(`/api/orders/${order.id}/cancel`, { method: 'POST' })).status).toBe(404);
    expect((await app.request(`/api/orders/${order.id}/cancel?k=${links.orderKey(order.id)}`, { method: 'POST' })).status).toBe(200);
  });

  it('keeps creating orders for signed-in customers (their tree)', async () => {
    const res = await app.request('/api/orders', json({ treeId: '00000000-0000-4000-8000-0000000000aa', productId: 'digital', size: 'A3', country: 'PT', email: 'x@example.com', design: {} }));
    expect(res.status).toBe(401);
    expect((await get('/api/shop/catalogue?country=PT')).status).toBe(200);
  });
});
