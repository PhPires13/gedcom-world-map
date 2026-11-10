import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  Claim,
  Person,
  PersonEvidence,
  Relationship,
  RelationshipEvidence,
  Source,
  TreeDetail,
  TreeSummary,
} from '../../src/model';
import { createApp } from '../app';
import { ensureDevUser } from '../auth';
import { migrate, openPglite, type Db } from '../db';
import { MemoryStorage } from '../storage';

const SAMPLE = readFileSync(new URL('../../public/sample.ged', import.meta.url), 'utf8');
// A 1×1 PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
);

let db: Db;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  await ensureDevUser(db);
});
afterAll(() => db.close());
beforeEach(() => {
  storage = new MemoryStorage();
  app = createApp({ db, storage, now: () => new Date('2026-06-01T00:00:00Z') });
});

async function call<T>(method: string, path: string, body?: unknown, expectStatus?: number): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await app.request(path, init);
  const text = await res.text();
  if (expectStatus !== undefined) expect(res.status, text).toBe(expectStatus);
  else expect(res.ok, `${method} ${path} → ${res.status} ${text}`).toBe(true);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A new tree with the sample GEDCOM imported. */
async function sampleTree() {
  const tree = await call<TreeSummary>('POST', '/api/trees', { name: 'Costa family' });
  await call('POST', `/api/trees/${tree.id}/import`, { fileName: 'sample.ged', text: SAMPLE });
  const detail = await call<TreeDetail>('GET', `/api/trees/${tree.id}`);
  const byRef = (ref: string) => detail.people.find((p) => p.originRef === ref)!;
  const parentLink = (parentRef: string, childRef: string) =>
    detail.relationships.find((r) => r.kind === 'parent' && r.from === byRef(parentRef).id && r.to === byRef(childRef).id)!;
  return { tree, detail, byRef, parentLink, base: `/api/trees/${tree.id}` };
}

async function uploadSource(base: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set('file', new File([PNG], 'baptism.png', { type: 'image/png' }));
  form.set('title', 'Baptism of Miguel Costa');
  form.set('archive', 'Arquivo Distrital do Porto');
  form.set('book', 'B-12');
  form.set('folio', '23v');
  form.set('entry', '41');
  form.set('recordDate', '28 JUN 1965');
  form.set('language', 'pt');
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return call<Source>('POST', `${base}/sources`, form, 201);
}

const proofClaim = (relationshipId: string, over: Record<string, unknown> = {}) => ({
  kind: 'baptism',
  statement: 'Miguel, son of António Costa and Maria Ferreira, baptised 28 June 1965.',
  eventDate: '28 JUN 1965',
  information: 'primary',
  reading: 'clear',
  relationships: [{ relationshipId, stance: 'supports', evidence: 'direct' }],
  ...over,
});

describe('basics', () => {
  it('answers health and me', async () => {
    expect(await call('GET', '/api/health')).toEqual({ ok: true });
    expect(await call<{ email: string }>('GET', '/api/me')).toMatchObject({ email: 'dev@localhost' });
  });

  it('creates and lists trees', async () => {
    const t = await call<TreeSummary>('POST', '/api/trees', { name: 'My tree' }, 201);
    expect(t).toMatchObject({ name: 'My tree', peopleCount: 0 });
    const list = await call<TreeSummary[]>('GET', '/api/trees');
    expect(list.map((x) => x.id)).toContain(t.id);
  });

  it('rejects bad input and unknown trees', async () => {
    await call('POST', '/api/trees', { name: '' }, 400);
    await call('GET', '/api/trees/not-an-id', undefined, 400);
    await call('GET', '/api/trees/00000000-0000-4000-8000-00000000abcd', undefined, 404);
  });

  it('does not re-apply migrations', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe('GEDCOM import', () => {
  it('imports every person and link as unsupported, with the GEDCOM as an authored source', async () => {
    const { detail, byRef, base } = await sampleTree();
    expect(detail.people).toHaveLength(34);
    expect(detail.tree.peopleCount).toBe(34);
    expect(detail.relationships.length).toBeGreaterThan(30);
    expect(detail.relationships.every((r) => r.confidence === 'unsupported' && r.origin === 'gedcom')).toBe(true);
    expect(detail.health).toMatchObject({ provenShare: 0, total: detail.relationships.length });

    const miguel = byRef('@I3@');
    expect(miguel).toMatchObject({ name: 'Miguel Costa', birth: { place: 'Porto, Portugal', year: 1965 } });

    const sources = await call<Source[]>('GET', `${base}/sources`);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: 'authored', origin: 'gedcom', title: 'GEDCOM import: sample.ged' });
    expect(sources[0].document?.fileName).toBe('sample.ged');
    expect(miguel.originSourceId).toBe(sources[0].id);
  });

  it('accepts a multipart upload and refuses a file with no people', async () => {
    const t = await call<TreeSummary>('POST', '/api/trees', { name: 'Upload' });
    const form = new FormData();
    form.set('file', new File([SAMPLE], 'family.ged'));
    expect(await call('POST', `/api/trees/${t.id}/import`, form, 201)).toMatchObject({ peopleCreated: 34 });
    await call('POST', `/api/trees/${t.id}/import`, { text: 'hello' }, 400);
  });
});

describe('living people', () => {
  it('marks people presumed living as private, and redacts them in the public view', async () => {
    const { detail, byRef, base } = await sampleTree();
    expect(byRef('@I1@')).toMatchObject({ presumedLiving: true, isPrivate: true }); // born 1995
    const dead = detail.people.find((p) => p.death)!;
    expect(dead).toMatchObject({ presumedLiving: false, isPrivate: false });

    const pub = await call<TreeDetail>('GET', `${base}?view=public`);
    const sofia = pub.people.find((p) => p.id === byRef('@I1@').id)!;
    expect(sofia.name).toBe('Private');
    expect(sofia.birth).toBeUndefined();
    expect(pub.people.find((p) => p.id === dead.id)!.name).toBe(dead.name);
  });

  it('can be overridden either way and reset', async () => {
    const { byRef, base } = await sampleTree();
    const id = byRef('@I1@').id;
    expect(await call<Person>('PUT', `${base}/people/${id}/privacy`, { privacy: 'public' })).toMatchObject({
      isPrivate: false,
      privacyOverride: 'public',
    });
    expect(await call<Person>('PUT', `${base}/people/${id}/privacy`, { privacy: 'auto' })).toMatchObject({
      isPrivate: true,
      privacyOverride: null,
    });
    await call('PUT', `${base}/people/${id}/privacy`, { privacy: 'maybe' }, 400);
  });
});

describe('documents and claims', () => {
  it('stores an uploaded document and serves it back', async () => {
    const { base } = await sampleTree();
    const s = await uploadSource(base);
    expect(s).toMatchObject({
      title: 'Baptism of Miguel Costa',
      kind: 'original',
      origin: 'upload',
      recordYear: 1965,
      language: 'pt',
      citation: { archive: 'Arquivo Distrital do Porto', book: 'B-12', folio: '23v', entry: '41' },
      document: { fileName: 'baptism.png', mediaType: 'image/png', sizeBytes: PNG.byteLength },
    });
    const res = await app.request(s.document!.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('refuses file types that are not records', async () => {
    const { base } = await sampleTree();
    const form = new FormData();
    form.set('file', new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }));
    await call('POST', `${base}/sources`, form, 415);
  });

  it('raises a link to proven with a direct primary claim, and shows the evidence', async () => {
    const { base, parentLink, byRef } = await sampleTree();
    const link = parentLink('@I5@', '@I3@');
    const s = await uploadSource(base);
    const { claim, changed } = await call<{ claim: Claim; changed: Relationship[] }>(
      'POST',
      `${base}/sources/${s.id}/claims`,
      proofClaim(link.id, { persons: [{ personId: byRef('@I3@').id, role: 'subject' }] }),
      201,
    );
    expect(claim).toMatchObject({ review: 'accepted', extractedBy: { kind: 'person' }, eventYear: 1965 });
    expect(changed).toEqual([expect.objectContaining({ id: link.id, confidence: 'proven' })]);

    const ev = await call<RelationshipEvidence>('GET', `${base}/relationships/${link.id}/evidence`);
    expect(ev.relationship.confidence).toBe('proven');
    expect(ev.claims.map((c) => c.id)).toEqual([claim.id]);
    expect(ev.sources.map((x) => x.id)).toEqual([s.id]);
    expect(ev.explanation).toMatchObject({ level: 'proven', supporting: 1 });

    const detail = await call<TreeDetail>('GET', base);
    expect(detail.health.counts.proven).toBe(1);

    const pe = await call<PersonEvidence>('GET', `${base}/people/${byRef('@I3@').id}/evidence`);
    expect(pe.claims.map((c) => c.id)).toEqual([claim.id]);
    expect(pe.sources.map((x) => x.kind).sort()).toEqual(['authored', 'original']);
  });

  it('goes into conflict on a contradiction and back when it is rejected or removed', async () => {
    const { base, parentLink } = await sampleTree();
    const link = parentLink('@I5@', '@I3@');
    const s = await uploadSource(base);
    await call('POST', `${base}/sources/${s.id}/claims`, proofClaim(link.id), 201);
    const other = await uploadSource(base, { title: 'Census 1970' });
    const { claim } = await call<{ claim: Claim }>(
      'POST',
      `${base}/sources/${other.id}/claims`,
      {
        statement: 'Miguel listed in another household as son of João Costa.',
        information: 'secondary',
        relationships: [{ relationshipId: link.id, stance: 'contradicts', evidence: 'indirect' }],
      },
      201,
    );
    const level = async () => (await call<RelationshipEvidence>('GET', `${base}/relationships/${link.id}/evidence`)).relationship.confidence;
    expect(await level()).toBe('conflict');

    await call('PATCH', `${base}/claims/${claim.id}`, { review: 'rejected' });
    expect(await level()).toBe('proven');

    await call('PATCH', `${base}/claims/${claim.id}`, { review: 'accepted' });
    expect(await level()).toBe('conflict');
    await call('DELETE', `${base}/claims/${claim.id}/relationships/${link.id}`);
    expect(await level()).toBe('proven');

    await call('PUT', `${base}/claims/${claim.id}/relationships/${link.id}`, { stance: 'contradicts', evidence: 'direct' });
    expect(await level()).toBe('conflict');
    await call('DELETE', `${base}/claims/${claim.id}`);
    expect(await level()).toBe('proven');
  });

  it('treats an AI proposal as possible until someone accepts it', async () => {
    const { base, parentLink } = await sampleTree();
    const link = parentLink('@I6@', '@I3@');
    const s = await uploadSource(base);
    const { claim, changed } = await call<{ claim: Claim; changed: Relationship[] }>(
      'POST',
      `${base}/sources/${s.id}/claims`,
      proofClaim(link.id, { extractedBy: { kind: 'ai', name: 'record-reader' } }),
      201,
    );
    expect(claim.review).toBe('proposed');
    expect(changed[0].confidence).toBe('possible');
    const { changed: after } = await call<{ changed: Relationship[] }>('PATCH', `${base}/claims/${claim.id}`, { review: 'accepted' });
    expect(after[0].confidence).toBe('proven');
  });

  it('refuses claims about people or links from another tree', async () => {
    const a = await sampleTree();
    const b = await sampleTree();
    const s = await uploadSource(a.base);
    await call('POST', `${a.base}/sources/${s.id}/claims`, proofClaim(b.parentLink('@I5@', '@I3@').id), 400);
    await call(
      'POST',
      `${a.base}/sources/${s.id}/claims`,
      { statement: 'x', persons: [{ personId: b.byRef('@I3@').id, role: 'subject' }] },
      400,
    );
    // And sources of another tree are not reachable through this one.
    await call('POST', `${b.base}/sources/${s.id}/claims`, { statement: 'x' }, 404);
  });
});

describe('relationships', () => {
  it('stores the written argument', async () => {
    const { base, parentLink } = await sampleTree();
    const link = parentLink('@I5@', '@I3@');
    const r = await call<Relationship>('PATCH', `${base}/relationships/${link.id}`, { argument: 'Baptism names both parents.' });
    expect(r.argument).toBe('Baptism names both parents.');
    expect((await call<Relationship>('PATCH', `${base}/relationships/${link.id}`, { argument: '' })).argument).toBeUndefined();
  });

  it('recomputes stored levels from the claims', async () => {
    const { base, parentLink, tree } = await sampleTree();
    const link = parentLink('@I5@', '@I3@');
    await db.query("update relationships set confidence = 'proven' where tree_id = $1", [tree.id]);
    expect((await call<Relationship>('POST', `${base}/relationships/${link.id}/recompute`)).confidence).toBe('unsupported');
    const res = await call<{ changed: Relationship[]; health: TreeDetail['health'] }>('POST', `${base}/recompute`);
    expect(res.changed.length).toBe(res.health.total - 1);
    expect(res.health.counts.unsupported).toBe(res.health.total);
  });
});

describe('deleting a tree', () => {
  it('removes its rows and stored documents', async () => {
    const { base, tree } = await sampleTree();
    await uploadSource(base);
    expect(storage.files.size).toBe(2); // the GEDCOM and the scan
    await call('DELETE', base, undefined, 204);
    expect(storage.files.size).toBe(0);
    expect(await db.query('select 1 from persons where tree_id = $1', [tree.id])).toEqual([]);
  });
});
