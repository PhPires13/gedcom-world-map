// The HTTP API. `createApp` takes its dependencies so tests can run it in memory.
//
// Routes (all JSON unless noted; every tree route is scoped to the current user):
//
//   GET    /api/health
//   GET    /api/me
//   GET    /api/trees                                         list my trees
//   POST   /api/trees                      {name}              create a tree
//   GET    /api/trees/:t[?view=public]                         people, relationships (with confidence), health
//   DELETE /api/trees/:t
//   POST   /api/trees/:t/import            multipart file | {fileName, text}   import a GEDCOM
//   POST   /api/trees/:t/recompute                             recompute every link's confidence
//   GET    /api/trees/:t/sources
//   POST   /api/trees/:t/sources           multipart (file + fields) | JSON     add a source / upload a document
//   GET    /api/trees/:t/sources/:s                            source with its claims
//   GET    /api/trees/:t/documents/:d/content                  the document bytes (inline)
//   POST   /api/trees/:t/sources/:s/claims {statement, …, persons[], relationships[]}
//   PATCH  /api/trees/:t/claims/:c         {review?, statement?, information?, reading?}
//   DELETE /api/trees/:t/claims/:c
//   PUT    /api/trees/:t/claims/:c/relationships/:r {stance, evidence, note?}  link a claim to a link
//   DELETE /api/trees/:t/claims/:c/relationships/:r
//   GET    /api/trees/:t/people/:p/evidence                    the person's claims and sources (timeline)
//   PUT    /api/trees/:t/people/:p/privacy {privacy: private|public|auto}
//   GET    /api/trees/:t/relationships/:r/evidence             claims, sources, confidence explanation
//   PATCH  /api/trees/:t/relationships/:r {argument}
//   POST   /api/trees/:t/relationships/:r/recompute
//
// Commerce (orders, checkout, webhooks, print files, operations): see server/commerce/routes.ts.
// Public share links (/api/shares…, /s/:id link previews): see server/shares.ts.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  ClaimKind,
  ClaimRelationshipLink,
  ClaimRole,
  EvidenceType,
  InformationQuality,
  ReadingConfidence,
  ReviewStatus,
  SourceKind,
  Stance,
} from '../src/model';
import { authenticate, type AuthEnv } from './auth';
import type { Commerce } from './commerce/routes';
import type { Db } from './db';
import { badRequest, HttpError } from './errors';
import * as repo from './repo';
import { mountPublicShares, mountShareRoutes, type ShareDeps } from './shares';
import type { DocumentStorage } from './storage';
import { arr, obj, oneOf, optStr, str, uuid } from './validate';

export interface AppDeps {
  db: Db;
  storage: DocumentStorage;
  /** Injectable clock, for the living rule in tests. */
  now?: () => Date;
  /** Origins allowed to call the API from a browser. Defaults to any localhost port (dev). */
  corsOrigin?: (origin: string) => string | null;
  /** The shop (createCommerce); without it the commerce routes are absent. */
  commerce?: Commerce;
  /** Share links: where share.html is served, this server's public address, the preview picture renderer. */
  shares?: Pick<ShareDeps, 'appUrl' | 'publicUrl' | 'renderImage'>;
}

const CLAIM_KINDS: readonly ClaimKind[] = [
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'parentage',
  'residence',
  'occupation',
  'name',
  'other',
];
const ROLES: readonly ClaimRole[] = ['subject', 'father', 'mother', 'parent', 'spouse', 'child', 'godparent', 'witness', 'grandparent', 'other'];
const SOURCE_KINDS: readonly SourceKind[] = ['original', 'derivative', 'authored'];
const INFORMATION: readonly InformationQuality[] = ['primary', 'secondary', 'undetermined'];
const READING: readonly ReadingConfidence[] = ['clear', 'likely', 'uncertain'];
const REVIEW: readonly ReviewStatus[] = ['proposed', 'accepted', 'rejected'];
const STANCES: readonly Stance[] = ['supports', 'contradicts'];
const EVIDENCE: readonly EvidenceType[] = ['direct', 'indirect'];

const localhostOrigin = (origin: string) => (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? origin : null);

function parseLink(v: unknown, field: string, relationshipId?: string): ClaimRelationshipLink {
  const o = obj(v, field);
  return {
    relationshipId: relationshipId ?? uuid(o.relationshipId, `${field}.relationshipId`),
    stance: oneOf(o.stance, STANCES, `${field}.stance`, 'supports'),
    evidence: oneOf(o.evidence, EVIDENCE, `${field}.evidence`),
    note: optStr(o.note, `${field}.note`, 2000),
  };
}

function parseClaim(body: unknown): repo.ClaimInput {
  const o = obj(body);
  const by = obj(o.extractedBy ?? { kind: 'person', name: 'Dev user' }, 'extractedBy');
  const extractedBy = { kind: oneOf(by.kind, ['person', 'ai'] as const, 'extractedBy.kind'), name: str(by.name, 'extractedBy.name', 200) };
  return {
    kind: oneOf(o.kind, CLAIM_KINDS, 'kind', 'other'),
    statement: str(o.statement, 'statement', 5000),
    eventDate: optStr(o.eventDate, 'eventDate', 100),
    eventPlace: optStr(o.eventPlace, 'eventPlace', 500),
    information: oneOf(o.information, INFORMATION, 'information', 'undetermined'),
    reading: oneOf(o.reading, READING, 'reading', 'clear'),
    extractedBy,
    // What a person types is accepted; what the AI extracts waits for review.
    review: oneOf(o.review, REVIEW, 'review', extractedBy.kind === 'ai' ? 'proposed' : 'accepted'),
    persons: arr(o.persons, 'persons').map((p, i) => {
      const x = obj(p, `persons[${i}]`);
      return { personId: uuid(x.personId, `persons[${i}].personId`), role: oneOf(x.role, ROLES, `persons[${i}].role`, 'subject') };
    }),
    relationships: arr(o.relationships, 'relationships').map((r, i) => parseLink(r, `relationships[${i}]`)),
  };
}

/** Reads a JSON body, or a multipart / urlencoded form as a flat record. */
async function readBody(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    return (await c.req.parseBody()) as Record<string, unknown>;
  }
  try {
    return obj(await c.req.json());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest('Body must be JSON');
  }
}

async function readFile(v: unknown, allowed?: readonly string[]): Promise<repo.UploadedFile | undefined> {
  if (!(v instanceof File)) return undefined;
  if (v.size > repo.MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (max 25 MB)');
  const type = (v.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (allowed && !allowed.includes(type)) throw new HttpError(415, `Unsupported file type ${type}. Use an image, a PDF or a text file.`);
  return { name: v.name || 'document', type, bytes: new Uint8Array(await v.arrayBuffer()) };
}

export function createApp({ db, storage, now = () => new Date(), corsOrigin = localhostOrigin, commerce, shares }: AppDeps) {
  const app = new Hono<AuthEnv>();
  const year = () => now().getUTCFullYear();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.use('/api/*', cors({ origin: (o) => corsOrigin(o), allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use('/api/*', bodyLimit({ maxSize: repo.MAX_UPLOAD_BYTES + 1024 * 1024, onError: (c) => c.json({ error: 'Request is too large' }, 413) }));
  app.get('/api/health', (c) => c.json({ ok: true }));
  // Webhooks and signed file links prove themselves; they must not need a login.
  commerce?.mountPublic(app);
  const shareDeps: ShareDeps = { db, storage, now, ...shares };
  mountPublicShares(app, shareDeps);
  app.use('/api/*', authenticate);
  commerce?.mountAuthed(app);
  mountShareRoutes(app, shareDeps);

  app.get('/api/me', (c) => c.json(c.var.user));

  // ----- Trees -----

  app.get('/api/trees', async (c) => c.json(await repo.listTrees(db, c.var.user.id)));

  app.post('/api/trees', async (c) => {
    const name = str((await readBody(c)).name, 'name', 200);
    return c.json(await repo.createTree(db, c.var.user.id, name), 201);
  });

  /** Every route below works inside one tree that must belong to the current user. */
  const tree = (c: Context<AuthEnv>) => repo.getTree(db, c.var.user.id, uuid(c.req.param('treeId'), 'treeId'));

  app.get('/api/trees/:treeId', async (c) => {
    const view = oneOf(c.req.query('view'), ['owner', 'public'] as const, 'view', 'owner');
    return c.json(await repo.treeDetail(db, await tree(c), year(), view));
  });

  app.delete('/api/trees/:treeId', async (c) => {
    await repo.deleteTree(db, storage, (await tree(c)).id);
    return c.body(null, 204);
  });

  app.post('/api/trees/:treeId/import', async (c) => {
    const t = await tree(c);
    const body = await readBody(c);
    const file =
      (await readFile(body.file)) ??
      (typeof body.text === 'string'
        ? { name: optStr(body.fileName, 'fileName', 255) ?? 'import.ged', type: 'text/plain', bytes: new TextEncoder().encode(body.text) }
        : undefined);
    if (!file) throw badRequest('Send a GEDCOM as a "file" field or as {fileName, text}');
    return c.json(await repo.importGedcom(db, storage, t.id, file), 201);
  });

  app.post('/api/trees/:treeId/recompute', async (c) => {
    const t = await tree(c);
    const changed = await repo.recompute(db, t.id);
    return c.json({ changed, health: (await repo.treeDetail(db, t, year())).health });
  });

  // ----- Sources & documents -----

  app.get('/api/trees/:treeId/sources', async (c) => c.json(await repo.loadSources(db, (await tree(c)).id)));

  app.post('/api/trees/:treeId/sources', async (c) => {
    const t = await tree(c);
    const b = await readBody(c);
    const file = await readFile(b.file, repo.ALLOWED_MEDIA_TYPES);
    const title = optStr(b.title, 'title', 300) ?? file?.name;
    if (!title) throw badRequest('title is required');
    const citation = Object.fromEntries(
      (['archive', 'collection', 'book', 'folio', 'entry', 'url'] as const)
        .map((k) => [k, optStr(b[k], k, 1000)])
        .filter(([, v]) => v !== undefined),
    );
    const input: repo.SourceInput = {
      title,
      kind: oneOf(b.kind, SOURCE_KINDS, 'kind', 'original'),
      origin: file ? 'upload' : 'manual',
      citation,
      recordDate: optStr(b.recordDate, 'recordDate', 100),
      language: optStr(b.language, 'language', 35),
      transcription: optStr(b.transcription, 'transcription', 100_000),
    };
    const documentId = file ? await repo.createDocument(db, storage, t.id, file) : undefined;
    return c.json(await repo.createSource(db, t.id, input, documentId), 201);
  });

  app.get('/api/trees/:treeId/sources/:sourceId', async (c) => {
    const t = await tree(c);
    const source = await repo.getSource(db, t.id, uuid(c.req.param('sourceId'), 'sourceId'));
    const ids = (await db.query<{ id: string }>('select id from claims where source_id = $1', [source.id])).map((r) => r.id);
    return c.json({ source, claims: await repo.loadClaims(db, t.id, ids) });
  });

  app.get('/api/trees/:treeId/documents/:documentId/content', async (c) => {
    const t = await tree(c);
    const doc = await repo.documentContent(db, storage, t.id, uuid(c.req.param('documentId'), 'documentId'));
    return c.body(doc.bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': doc.mediaType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      // Uploaded files are never allowed to run scripts on the API's origin. (Chrome's PDF viewer
      // does not open in a sandbox, so PDFs rely on nosniff and the strict allow-list instead.)
      ...(doc.mediaType === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // ----- Claims -----

  app.post('/api/trees/:treeId/sources/:sourceId/claims', async (c) => {
    const t = await tree(c);
    const input = parseClaim(await readBody(c));
    return c.json(await repo.createClaim(db, t.id, uuid(c.req.param('sourceId'), 'sourceId'), input), 201);
  });

  app.patch('/api/trees/:treeId/claims/:claimId', async (c) => {
    const t = await tree(c);
    const b = await readBody(c);
    return c.json(
      await repo.updateClaim(db, t.id, uuid(c.req.param('claimId'), 'claimId'), {
        statement: b.statement === undefined ? undefined : str(b.statement, 'statement', 5000),
        review: b.review === undefined ? undefined : oneOf(b.review, REVIEW, 'review'),
        information: b.information === undefined ? undefined : oneOf(b.information, INFORMATION, 'information'),
        reading: b.reading === undefined ? undefined : oneOf(b.reading, READING, 'reading'),
      }),
    );
  });

  app.delete('/api/trees/:treeId/claims/:claimId', async (c) => {
    const t = await tree(c);
    return c.json(await repo.deleteClaim(db, t.id, uuid(c.req.param('claimId'), 'claimId')));
  });

  app.put('/api/trees/:treeId/claims/:claimId/relationships/:relId', async (c) => {
    const t = await tree(c);
    const link = parseLink(await readBody(c), 'body', uuid(c.req.param('relId'), 'relId'));
    return c.json(await repo.linkClaim(db, t.id, uuid(c.req.param('claimId'), 'claimId'), link));
  });

  app.delete('/api/trees/:treeId/claims/:claimId/relationships/:relId', async (c) => {
    const t = await tree(c);
    return c.json(await repo.unlinkClaim(db, t.id, uuid(c.req.param('claimId'), 'claimId'), uuid(c.req.param('relId'), 'relId')));
  });

  // ----- People -----

  app.get('/api/trees/:treeId/people/:personId/evidence', async (c) => {
    const t = await tree(c);
    return c.json(await repo.personEvidence(db, t.id, uuid(c.req.param('personId'), 'personId'), year()));
  });

  app.put('/api/trees/:treeId/people/:personId/privacy', async (c) => {
    const t = await tree(c);
    const personId = uuid(c.req.param('personId'), 'personId');
    const privacy = oneOf((await readBody(c)).privacy, ['private', 'public', 'auto'] as const, 'privacy');
    await repo.setPrivacy(db, t.id, personId, privacy === 'auto' ? null : privacy);
    const [person] = await repo.loadPeople(db, t.id, year(), [personId]);
    return c.json(person);
  });

  // ----- Relationships -----

  app.get('/api/trees/:treeId/relationships/:relId/evidence', async (c) => {
    const t = await tree(c);
    return c.json(await repo.relationshipEvidence(db, t.id, uuid(c.req.param('relId'), 'relId')));
  });

  app.patch('/api/trees/:treeId/relationships/:relId', async (c) => {
    const t = await tree(c);
    const b = await readBody(c);
    if (!('argument' in b)) throw badRequest('Nothing to update');
    const argument = optStr(b.argument, 'argument', 10_000) ?? null;
    return c.json(await repo.updateRelationship(db, t.id, uuid(c.req.param('relId'), 'relId'), argument));
  });

  app.post('/api/trees/:treeId/relationships/:relId/recompute', async (c) => {
    const t = await tree(c);
    const relId = uuid(c.req.param('relId'), 'relId');
    await repo.recompute(db, t.id, [relId]);
    return c.json(await repo.getRelationship(db, t.id, relId));
  });

  return app;
}
