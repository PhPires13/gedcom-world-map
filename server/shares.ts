// Public share links for a family's migration map.
//
//   POST   /api/shares            ShareSnapshot (JSON, ≤ 2 MB)   publish; returns {id, url path…}   (owner)
//   GET    /api/shares                                           my shares                          (owner)
//   DELETE /api/shares/:id                                       unpublish                          (owner only)
//   GET    /api/shares/:id                                       the snapshot, for share.html       (public)
//   GET    /s/:id                                                link preview page (Open Graph tags),
//                                                                redirects people to share.html?id=… (public)
//   GET    /s/:id/og.png                                         the preview picture, cached         (public)
//
// The snapshot is built in the browser (src/share/snapshot.ts) and checked here again with the same
// `validateSnapshot`: nobody flagged living or private, nobody born less than 100 years ago, only
// the map's fields. Ids are 144 random bits, so a share can only be found through its link.

import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PREVIEW_TAGS, previewLang, previewText, type PreviewLang } from '../src/share/preview-text';
import { MAX_SHARE_BYTES, SnapshotError, summarize, validateSnapshot, type ShareInfo, type SharedMap, type ShareSnapshot } from '../src/share/snapshot';
import type { AuthEnv } from './auth';
import type { Db } from './db';
import { badRequest, HttpError, notFound } from './errors';
import type { DocumentStorage } from './storage';

export interface ShareDeps {
  db: Db;
  storage: DocumentStorage;
  now: () => Date;
  /** Where share.html is served (e.g. http://localhost:5173 in dev); default: this server's origin. */
  appUrl?: string;
  /** This server's public address, for absolute og:image / og:url; default: the request's origin. */
  publicUrl?: string;
  /** Makes the preview picture (default: the print renderer, server/share-image.ts). */
  renderImage?: (snapshot: ShareSnapshot, text: { lang: PreviewLang; title: string; subtitle: string }) => Promise<Uint8Array>;
}

/** Most shares one person can have at a time. */
export const MAX_SHARES_PER_USER = 100;

const ID_RE = /^[A-Za-z0-9_-]{24}$/;

/** A new share id: 18 random bytes (144 bits) in base64url, 24 characters. */
export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Buffer.from(bytes).toString('base64url');
}

export const isShareId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

interface ShareRow {
  id: string;
  owner_id: string;
  family: string;
  snapshot: ShareSnapshot;
  people_count: number;
  created_at: string | Date;
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const info = (r: Pick<ShareRow, 'id' | 'family' | 'people_count' | 'created_at'>): ShareInfo => ({
  id: r.id,
  family: r.family,
  peopleCount: r.people_count,
  createdAt: iso(r.created_at),
  path: `/s/${r.id}`,
});

/** Storage keys have no dots (server/storage.ts). */
const imageKey = (id: string) => `shares/${id}/preview-png`;

async function findShare(db: Db, id: string | undefined): Promise<ShareRow> {
  if (!isShareId(id)) throw notFound('Share');
  const [row] = await db.query<ShareRow>('select * from shares where id = $1', [id]);
  if (!row) throw notFound('Share');
  return row;
}

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function previewPage(o: { lang: PreviewLang; title: string; description: string; open: string; url: string; image: string; viewer: string }) {
  const e = escHtml;
  return `<!doctype html>
<html lang="${PREVIEW_TAGS[o.lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(o.title)}</title>
<meta name="description" content="${e(o.description)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:locale" content="${PREVIEW_TAGS[o.lang].replace('-', '_')}">
<meta property="og:title" content="${e(o.title)}">
<meta property="og:description" content="${e(o.description)}">
<meta property="og:url" content="${e(o.url)}">
<meta property="og:image" content="${e(o.image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(o.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(o.title)}">
<meta name="twitter:description" content="${e(o.description)}">
<meta name="twitter:image" content="${e(o.image)}">
<meta http-equiv="refresh" content="0; url=${e(o.viewer)}">
</head>
<body>
<p><a href="${e(o.viewer)}">${e(o.open)}</a></p>
<script>location.replace(${JSON.stringify(o.viewer).replace(/</g, '\\u003c')})</script>
</body>
</html>`;
}

// ---------- Routes ----------

const defaultRenderImage: NonNullable<ShareDeps['renderImage']> = async (snapshot, text) => {
  const { renderShareImage } = await import('./share-image');
  return renderShareImage(snapshot, text);
};

/** Routes anyone may call (mount before authentication). */
export function mountPublicShares(app: Hono<AuthEnv>, deps: ShareDeps) {
  const { db, storage } = deps;
  const renderImage = deps.renderImage ?? defaultRenderImage;
  const rendering = new Map<string, Promise<Uint8Array>>();
  const origin = (c: Context) => (deps.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, '');

  app.get('/api/shares/:id', async (c) => {
    const row = await findShare(db, c.req.param('id'));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ ...info(row), snapshot: row.snapshot, summary: summarize(row.snapshot) } satisfies SharedMap);
  });

  app.get('/s/:id', async (c) => {
    const row = await findShare(db, c.req.param('id'));
    const lang = previewLang(c.req.header('accept-language'));
    const text = previewText(lang, row.family, summarize(row.snapshot));
    const base = origin(c);
    const viewer = `${(deps.appUrl ?? base).replace(/\/$/, '')}/share.html?id=${row.id}`;
    c.header('Cache-Control', 'public, max-age=300');
    c.header('X-Robots-Tag', 'noindex');
    return c.html(previewPage({ lang, ...text, url: `${base}/s/${row.id}`, image: `${base}/s/${row.id}/og.png`, viewer }));
  });

  app.get('/s/:id/og.png', async (c) => {
    const row = await findShare(db, c.req.param('id'));
    let png = await storage.get(imageKey(row.id));
    if (!png) {
      // One render per share, even when several crawlers ask at once.
      let job = rendering.get(row.id);
      if (!job) {
        const text = previewText('pt', row.family, summarize(row.snapshot));
        job = renderImage(row.snapshot, { lang: 'pt', title: text.title, subtitle: text.counts })
          .then(async (bytes) => {
            // Unpublished while rendering? Don't leave the picture behind.
            const [still] = await db.query('select 1 from shares where id = $1', [row.id]);
            if (still) await storage.put(imageKey(row.id), bytes);
            return bytes;
          })
          .finally(() => rendering.delete(row.id));
        rendering.set(row.id, job);
      }
      png = await job;
    }
    return c.body(png as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
  });
}

/** Routes for the signed-in owner (mount after authentication; the user is `c.var.user`). */
export function mountShareRoutes(app: Hono<AuthEnv>, deps: ShareDeps) {
  const { db, storage, now } = deps;

  app.get('/api/shares', async (c) => {
    const rows = await db.query<ShareRow>(
      'select id, family, people_count, created_at from shares where owner_id = $1 order by created_at desc',
      [c.var.user.id],
    );
    return c.json(rows.map(info));
  });

  app.post(
    '/api/shares',
    bodyLimit({ maxSize: MAX_SHARE_BYTES, onError: (c) => c.json({ error: `The shared map is too large (max ${MAX_SHARE_BYTES / 1_000_000} MB)` }, 413) }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw badRequest('Body must be JSON');
      }
      let snapshot: ShareSnapshot;
      try {
        snapshot = validateSnapshot(body, now().getUTCFullYear());
      } catch (e) {
        if (e instanceof SnapshotError) throw badRequest(e.message);
        throw e;
      }
      const owner = c.var.user.id;
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from shares where owner_id = $1', [owner]);
      if (n >= MAX_SHARES_PER_USER) throw new HttpError(409, `You already have ${MAX_SHARES_PER_USER} shared maps; stop sharing one first`);
      const id = newShareId();
      const [row] = await db.query<ShareRow>(
        `insert into shares (id, owner_id, family, snapshot, people_count) values ($1, $2, $3, $4::jsonb, $5)
         returning id, family, people_count, created_at`,
        [id, owner, snapshot.family, JSON.stringify(snapshot), snapshot.people.length],
      );
      return c.json(info(row), 201);
    },
  );

  app.delete('/api/shares/:id', async (c) => {
    const row = await findShare(db, c.req.param('id'));
    if (row.owner_id !== c.var.user.id) throw new HttpError(403, 'Only the person who shared this map can stop sharing it');
    await db.query('delete from shares where id = $1 and owner_id = $2', [row.id, c.var.user.id]);
    await storage.delete(imageKey(row.id));
    return c.body(null, 204);
  });
}
