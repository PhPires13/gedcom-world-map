// Share links: publish a checked snapshot, read it publicly, preview it for WhatsApp & co.,
// and unpublish it (owner only).

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { originEvent, parseGedcom } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import { buildSnapshot, MAX_SHARE_BYTES, type SharedMap, type ShareInfo, type ShareSnapshot } from '../../src/share/snapshot';
import { createApp } from '../app';
import { DEV_USER, ensureDevUser, type AuthEnv, type User } from '../auth';
import { migrate, openPglite, type Db } from '../db';
import { isShareId, mountPublicShares, mountShareRoutes, newShareId } from '../shares';
import { MemoryStorage } from '../storage';

const NOW = new Date('2026-06-01T00:00:00Z');
const tree = parseGedcom(readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8'));
const places = JSON.parse(readFileSync(new URL('./fixtures/sample-places.json', import.meta.url), 'utf8'));
const located = new Map<string, { lat: number; lon: number; place: string }>();
for (const p of tree.people.values()) {
  const ev = originEvent(p)?.event;
  if (ev?.lat !== undefined && ev.lon !== undefined) located.set(p.id, { lat: ev.lat, lon: ev.lon, place: ev.place ?? '' });
  else if (ev?.place && places[ev.place]) located.set(p.id, { ...places[ev.place], place: ev.place });
}
const SNAPSHOT = buildSnapshot({ tree, located, gens: computeGenerations(tree), family: 'Costa <b>', currentYear: 2026 }).snapshot;

let db: Db;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let renders: number;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  await ensureDevUser(db);
});
afterAll(() => db.close());
beforeEach(() => {
  storage = new MemoryStorage();
  renders = 0;
  app = createApp({
    db,
    storage,
    now: () => NOW,
    shares: {
      appUrl: 'http://localhost:5173',
      renderImage: async () => {
        renders++;
        return PNG;
      },
    },
  });
});

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  return app.request(path, init);
}

async function publish(snapshot: unknown = SNAPSHOT): Promise<ShareInfo> {
  const res = await send('POST', '/api/shares', snapshot);
  expect(res.status, await res.clone().text()).toBe(201);
  return res.json() as Promise<ShareInfo>;
}

const withPerson = (over: Record<string, unknown>): ShareSnapshot => ({
  ...SNAPSHOT,
  people: [{ ...SNAPSHOT.people[0], ...over }, ...SNAPSHOT.people.slice(1)] as ShareSnapshot['people'],
});

describe('share ids', () => {
  it('are 144 random bits in base64url, never repeating', () => {
    const ids = Array.from({ length: 2000 }, newShareId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isShareId(id)).toBe(true);
    // 24 base64url characters = 18 bytes = 144 bits (≥ 128).
    expect(Buffer.from(ids[0], 'base64url').length).toBe(18);
    // Every character position varies (not a counter or a timestamp prefix).
    for (let i = 0; i < 24; i++) expect(new Set(ids.map((id) => id[i])).size).toBeGreaterThan(30);
  });

  it('are refused when not in that shape (no lookups by guessable values)', async () => {
    for (const id of ['1', 'abc', '../etc', `${newShareId()}x`]) expect((await send('GET', `/api/shares/${id}`)).status).toBe(404);
  });
});

describe('publishing', () => {
  it('stores the snapshot and serves it to anyone with the link', async () => {
    const share = await publish();
    expect(isShareId(share.id)).toBe(true);
    expect(share).toMatchObject({ family: 'Costa <b>', peopleCount: SNAPSHOT.people.length, path: `/s/${share.id}` });
    const res = await send('GET', `/api/shares/${share.id}`);
    expect(res.status).toBe(200);
    const shared = (await res.json()) as SharedMap;
    expect(shared.snapshot).toEqual(SNAPSHOT);
    expect(shared.summary.people).toBe(SNAPSHOT.people.length);
    const mine = (await (await send('GET', '/api/shares')).json()) as ShareInfo[];
    expect(mine.map((s) => s.id)).toContain(share.id);
  });

  it('refuses people flagged living, born less than 100 years ago, or with private fields', async () => {
    for (const [over, msg] of [
      [{ living: true }, /living/],
      [{ presumedLiving: true }, /living/],
      [{ birthYear: 1990 }, /less than 100 years/],
      [{ birthYear: 1927 }, /less than 100 years/],
      [{ occupation: 'Engineer' }, /not allowed/],
      [{ death: { date: '3 MAR 1990' } }, /not allowed/],
    ] as const) {
      const res = await send('POST', '/api/shares', withPerson(over));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(msg);
    }
    expect((await send('POST', '/api/shares', '{not json')).status).toBe(400);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from shares where snapshot::text like '%Engineer%' or snapshot::text like '%1990%'");
    expect(n).toBe(0);
  });

  it('refuses oversized payloads', async () => {
    const big = { ...SNAPSHOT, people: SNAPSHOT.people.map((p) => ({ ...p, place: 'x'.repeat(300) })), padding: 'y'.repeat(MAX_SHARE_BYTES) };
    const res = await send('POST', '/api/shares', big);
    expect(res.status).toBe(413);
  });
});

describe('link preview', () => {
  it('has Open Graph tags (escaped) and sends people on to share.html', async () => {
    const share = await publish();
    const res = await send('GET', `/s/${share.id}`, undefined, { 'accept-language': 'pt-BR,pt;q=0.9' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Família Costa &lt;b&gt; — mapa das migrações">');
    expect(html).not.toContain('Costa <b>');
    expect(html).toMatch(new RegExp(`<meta property="og:description" content="${SNAPSHOT.people.length} pessoas em \\d+ gerações`));
    expect(html).toContain(`<meta property="og:image" content="http://localhost/s/${share.id}/og.png">`);
    expect(html).toContain(`url=http://localhost:5173/share.html?id=${share.id}`);
    expect(html).toContain('noindex');
    const en = await (await send('GET', `/s/${share.id}`, undefined, { 'accept-language': 'en-US' })).text();
    expect(en).toContain('The Costa &lt;b&gt; family — migration map');
    expect((await send('GET', `/s/${newShareId()}`)).status).toBe(404);
  });

  it('makes the picture once and serves it from the cache', async () => {
    const share = await publish();
    const [a, b] = await Promise.all([send('GET', `/s/${share.id}/og.png`), send('GET', `/s/${share.id}/og.png`)]);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(PNG);
    await send('GET', `/s/${share.id}/og.png`);
    expect(renders).toBe(1);
    expect(storage.files.has(`shares/${share.id}/preview-png`)).toBe(true);
  });
});

describe('unpublishing', () => {
  /** The share routes with someone else signed in (server/auth.ts always gives the dev user). */
  function appAs(user: User) {
    const other = new Hono<AuthEnv>();
    other.onError((err, c) => c.json({ error: err.message }, (err as { status?: 403 | 404 }).status ?? 500));
    const deps = { db, storage, now: () => NOW };
    mountPublicShares(other, deps);
    other.use('*', async (c, next) => {
      c.set('user', user);
      await next();
    });
    mountShareRoutes(other, deps);
    return other;
  }
  const stranger: User = { id: '00000000-0000-4000-8000-0000000000ff', email: 'x@example.com', displayName: 'Someone else' };

  it('only the owner can stop sharing', async () => {
    const share = await publish();
    const res = await appAs(stranger).request(`/api/shares/${share.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect((await send('GET', `/api/shares/${share.id}`)).status).toBe(200);
    // Nor do they see it among their shares.
    expect(await (await appAs(stranger).request('/api/shares')).json()).toEqual([]);
  });

  it('removes the share and its picture for everyone', async () => {
    const share = await publish();
    await send('GET', `/s/${share.id}/og.png`);
    expect((await appAs(DEV_USER).request(`/api/shares/${share.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await send('GET', `/api/shares/${share.id}`)).status).toBe(404);
    expect((await send('GET', `/s/${share.id}`)).status).toBe(404);
    expect((await send('GET', `/s/${share.id}/og.png`)).status).toBe(404);
    expect(storage.files.has(`shares/${share.id}/preview-png`)).toBe(false);
    expect((await send('DELETE', `/api/shares/${share.id}`)).status).toBe(404);
  });
});

describe('preview picture (real renderer)', () => {
  it('draws the shared people as a 1200×630 PNG', async () => {
    const { renderShareImage, snapshotDetail, OG_WIDTH, OG_HEIGHT } = await import('../share-image');
    const detail = snapshotDetail(SNAPSHOT);
    expect(detail.people.every((p) => !p.isPrivate && !p.presumedLiving)).toBe(true);
    expect(detail.relationships.length).toBe(SNAPSHOT.people.reduce((n, p) => n + p.parents.length, 0));
    const png = renderShareImage(SNAPSHOT, { lang: 'pt', title: 'Família Costa — mapa das migrações', subtitle: '19 pessoas' });
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([OG_WIDTH, OG_HEIGHT]);
    // Light enough for WhatsApp to show it (it drops heavy previews).
    expect(png.length).toBeLessThan(400_000);
  }, 30_000);
});
