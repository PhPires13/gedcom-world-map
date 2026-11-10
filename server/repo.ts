// Data access: SQL rows ⇄ model objects, and the operations the routes need.
// Every function takes the tree id it works in and only touches rows of that tree; routes check
// the tree belongs to the current user first (`getTree`).

import { createHash, randomUUID } from 'node:crypto';
import { decodeGedcom, extractYear, parseGedcom, type LifeEvent } from '../src/gedcom';
import {
  computeConfidence,
  gedcomToDrafts,
  isPrivate,
  presumedLivingAll,
  redactPerson,
  treeHealth,
  type Claim,
  type ClaimKind,
  type ClaimPersonLink,
  type ClaimRelationshipLink,
  type ClaimRole,
  type ConfidenceLevel,
  type DocumentAttachment,
  type EvidenceItem,
  type EvidenceType,
  type Extractor,
  type InformationQuality,
  type Person,
  type PersonEvidence,
  type PrivacyOverride,
  type ReadingConfidence,
  type Relationship,
  type RelationshipEvidence,
  type ReviewStatus,
  type Source,
  type SourceCitation,
  type SourceKind,
  type SourceOrigin,
  type Stance,
  type TreeDetail,
  type TreeSummary,
} from '../src/model';
import type { Db } from './db';
import { badRequest, notFound } from './errors';
import type { DocumentStorage } from './storage';

type Row = Record<string, unknown>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));

// ---------- Trees ----------

const TREE_SELECT = `
  select t.*,
    (select count(*) from persons p where p.tree_id = t.id and p.merged_into is null)::int as people_count,
    (select count(*) from relationships r where r.tree_id = t.id)::int as relationship_count
  from trees t`;

const toTree = (r: Row): TreeSummary => ({
  id: r.id as string,
  name: r.name as string,
  ownerId: r.owner_id as string,
  peopleCount: Number(r.people_count),
  relationshipCount: Number(r.relationship_count),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export async function listTrees(db: Db, ownerId: string): Promise<TreeSummary[]> {
  const rows = await db.query(`${TREE_SELECT} where t.owner_id = $1 order by t.updated_at desc`, [ownerId]);
  return rows.map(toTree);
}

/** The tree, if it exists and belongs to `ownerId`; otherwise 404 (never reveal other users' trees). */
export async function getTree(db: Db, ownerId: string, treeId: string): Promise<TreeSummary> {
  const [row] = await db.query(`${TREE_SELECT} where t.id = $1 and t.owner_id = $2`, [treeId, ownerId]);
  if (!row) throw notFound('Tree');
  return toTree(row);
}

export async function createTree(db: Db, ownerId: string, name: string): Promise<TreeSummary> {
  const id = randomUUID();
  await db.query('insert into trees (id, owner_id, name) values ($1, $2, $3)', [id, ownerId, name]);
  return getTree(db, ownerId, id);
}

/** Deletes a tree and everything in it, including stored document bytes. */
export async function deleteTree(db: Db, storage: DocumentStorage, treeId: string) {
  const docs = await db.query<{ storage_key: string }>('select storage_key from documents where tree_id = $1', [treeId]);
  await db.query('delete from trees where id = $1', [treeId]);
  await Promise.all(docs.map((d) => storage.delete(d.storage_key)));
}

const touch = (db: Db, treeId: string) => db.query('update trees set updated_at = now() where id = $1', [treeId]);

// ---------- People ----------

function toPerson(r: Row, presumedLiving: boolean): Person {
  const givenName = r.given_name as string;
  const surname = r.surname as string;
  const privacyOverride = (r.privacy_override as PrivacyOverride) ?? null;
  return {
    id: r.id as string,
    treeId: r.tree_id as string,
    givenName,
    surname,
    name: [givenName, surname].filter(Boolean).join(' ') || '(unnamed)',
    sex: opt(r.sex),
    birth: opt<LifeEvent>(r.birth),
    baptism: opt<LifeEvent>(r.baptism),
    death: opt<LifeEvent>(r.death),
    burial: opt<LifeEvent>(r.burial),
    occupation: opt(r.occupation),
    origin: r.origin as Person['origin'],
    originSourceId: opt(r.origin_source_id),
    originRef: opt(r.origin_ref),
    mergedInto: opt(r.merged_into),
    privacyOverride,
    presumedLiving,
    isPrivate: isPrivate(privacyOverride, presumedLiving),
    createdAt: iso(r.created_at),
  };
}

const lifeFacts = (r: Row) => ({
  id: r.id as string,
  birth: opt<LifeEvent>(r.birth),
  baptism: opt<LifeEvent>(r.baptism),
  death: opt<LifeEvent>(r.death),
  burial: opt<LifeEvent>(r.burial),
});

/**
 * Loads people (all of the tree, or just `ids`) with the living rule applied. The rule may need
 * relatives' birth years, so their links and years are loaded too.
 */
export async function loadPeople(db: Db, treeId: string, currentYear: number, ids?: string[]): Promise<Person[]> {
  const rows = ids
    ? await db.query('select * from persons where tree_id = $1 and id = any($2::uuid[])', [treeId, ids])
    : await db.query('select * from persons where tree_id = $1 order by created_at, id', [treeId]);
  if (!rows.length) return [];
  const links = (
    ids
      ? await db.query(
          'select kind, from_person, to_person from relationships where tree_id = $1 and (from_person = any($2::uuid[]) or to_person = any($2::uuid[]))',
          [treeId, ids],
        )
      : await db.query('select kind, from_person, to_person from relationships where tree_id = $1', [treeId])
  ).map((l) => ({ kind: l.kind as 'parent' | 'spouse', from: l.from_person as string, to: l.to_person as string }));
  const facts = new Map(rows.map((r) => [r.id as string, lifeFacts(r)]));
  const missing = [...new Set(links.flatMap((l) => [l.from, l.to]))].filter((id) => !facts.has(id));
  if (missing.length) {
    for (const r of await db.query('select id, birth, baptism, death, burial from persons where id = any($1::uuid[])', [missing])) {
      facts.set(r.id as string, lifeFacts(r));
    }
  }
  const living = presumedLivingAll([...facts.values()], links, currentYear);
  return rows.map((r) => toPerson(r, living.get(r.id as string) ?? true));
}

export async function setPrivacy(db: Db, treeId: string, personId: string, override: PrivacyOverride) {
  const rows = await db.query('update persons set privacy_override = $3 where tree_id = $1 and id = $2 returning id', [
    treeId,
    personId,
    override,
  ]);
  if (!rows.length) throw notFound('Person');
  await touch(db, treeId);
}

// ---------- Relationships ----------

const toRelationship = (r: Row): Relationship => ({
  id: r.id as string,
  treeId: r.tree_id as string,
  kind: r.kind as Relationship['kind'],
  from: r.from_person as string,
  to: r.to_person as string,
  origin: r.origin as Relationship['origin'],
  originSourceId: opt(r.origin_source_id),
  confidence: r.confidence as ConfidenceLevel,
  argument: opt(r.argument),
  confidenceUpdatedAt: iso(r.confidence_updated_at),
  createdAt: iso(r.created_at),
});

export async function loadRelationships(db: Db, treeId: string, ids?: string[]): Promise<Relationship[]> {
  const rows = ids
    ? await db.query('select * from relationships where tree_id = $1 and id = any($2::uuid[])', [treeId, ids])
    : await db.query('select * from relationships where tree_id = $1 order by created_at, id', [treeId]);
  return rows.map(toRelationship);
}

export async function getRelationship(db: Db, treeId: string, id: string): Promise<Relationship> {
  const [r] = await loadRelationships(db, treeId, [id]);
  if (!r) throw notFound('Relationship');
  return r;
}

export async function updateRelationship(db: Db, treeId: string, id: string, argument: string | null) {
  const rows = await db.query('update relationships set argument = $3 where tree_id = $1 and id = $2 returning id', [
    treeId,
    id,
    argument,
  ]);
  if (!rows.length) throw notFound('Relationship');
  await touch(db, treeId);
  return getRelationship(db, treeId, id);
}

async function evidenceItems(db: Db, treeId: string, relIds?: string[]): Promise<(EvidenceItem & { relationshipId: string })[]> {
  const rows = await db.query(
    `select cr.relationship_id, cr.stance, cr.evidence, c.id as claim_id, c.source_id, c.information, c.reading,
            c.extracted_by_kind, c.review, s.kind as source_kind
       from claim_relationships cr
       join claims c on c.id = cr.claim_id
       join sources s on s.id = c.source_id
      where c.tree_id = $1 ${relIds ? 'and cr.relationship_id = any($2::uuid[])' : ''}`,
    relIds ? [treeId, relIds] : [treeId],
  );
  return rows.map((r) => ({
    relationshipId: r.relationship_id as string,
    claimId: r.claim_id as string,
    sourceId: r.source_id as string,
    sourceKind: r.source_kind as SourceKind,
    stance: r.stance as Stance,
    evidence: r.evidence as EvidenceType,
    information: r.information as InformationQuality,
    reading: r.reading as ReadingConfidence,
    extractedBy: r.extracted_by_kind as Extractor['kind'],
    review: r.review as ReviewStatus,
  }));
}

/**
 * Recomputes and stores the confidence of the given relationships (all of the tree when `relIds`
 * is omitted). Returns the relationships whose level changed.
 */
export async function recompute(db: Db, treeId: string, relIds?: string[]): Promise<Relationship[]> {
  if (relIds && !relIds.length) return [];
  const rels = await loadRelationships(db, treeId, relIds);
  const byRel = new Map<string, EvidenceItem[]>();
  for (const item of await evidenceItems(db, treeId, relIds)) {
    const list = byRel.get(item.relationshipId) ?? [];
    list.push(item);
    byRel.set(item.relationshipId, list);
  }
  const updates = rels.map((r) => ({ id: r.id, c: computeConfidence(byRel.get(r.id) ?? []).level }));
  const changed = await db.query(
    `update relationships r set confidence = x.c, confidence_updated_at = now()
       from jsonb_to_recordset($2::jsonb) as x(id uuid, c text)
      where r.id = x.id and r.tree_id = $1 and r.confidence is distinct from x.c
      returning r.*`,
    [treeId, JSON.stringify(updates)],
  );
  if (changed.length) await touch(db, treeId);
  return changed.map(toRelationship);
}

// ---------- Tree detail ----------

export async function treeDetail(
  db: Db,
  tree: TreeSummary,
  currentYear: number,
  view: 'owner' | 'public' = 'owner',
): Promise<TreeDetail> {
  const [people, relationships] = await Promise.all([loadPeople(db, tree.id, currentYear), loadRelationships(db, tree.id)]);
  return {
    tree,
    people: view === 'public' ? people.map(redactPerson) : people,
    relationships,
    health: treeHealth(relationships.map((r) => r.confidence)),
  };
}

// ---------- Documents & sources ----------

/** File types accepted for upload: record images, PDFs and plain-text transcriptions. */
export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'application/pdf',
  'text/plain',
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const documentUrl = (treeId: string, documentId: string) => `/api/trees/${treeId}/documents/${documentId}/content`;

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export async function createDocument(db: Db, storage: DocumentStorage, treeId: string, file: UploadedFile): Promise<string> {
  const id = randomUUID();
  const key = `trees/${treeId}/${id}`;
  await storage.put(key, file.bytes);
  try {
    await db.query(
      `insert into documents (id, tree_id, storage_key, file_name, media_type, size_bytes, sha256)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, treeId, key, file.name.slice(0, 255), file.type, file.bytes.byteLength, createHash('sha256').update(file.bytes).digest('hex')],
    );
  } catch (e) {
    await storage.delete(key);
    throw e;
  }
  return id;
}

export async function documentContent(db: Db, storage: DocumentStorage, treeId: string, documentId: string) {
  const [row] = await db.query('select * from documents where tree_id = $1 and id = $2', [treeId, documentId]);
  if (!row) throw notFound('Document');
  const bytes = await storage.get(row.storage_key as string);
  if (!bytes) throw notFound('Document file');
  return { bytes, mediaType: row.media_type as string, fileName: row.file_name as string };
}

const SOURCE_SELECT = `
  select s.*, d.id as d_id, d.file_name as d_file_name, d.media_type as d_media_type,
         d.size_bytes as d_size_bytes, d.sha256 as d_sha256, d.created_at as d_created_at
    from sources s left join documents d on d.id = s.document_id`;

function toSource(r: Row): Source {
  const treeId = r.tree_id as string;
  const document: DocumentAttachment | undefined = r.d_id
    ? {
        id: r.d_id as string,
        fileName: r.d_file_name as string,
        mediaType: r.d_media_type as string,
        sizeBytes: Number(r.d_size_bytes),
        sha256: r.d_sha256 as string,
        url: documentUrl(treeId, r.d_id as string),
        createdAt: iso(r.d_created_at),
      }
    : undefined;
  return {
    id: r.id as string,
    treeId,
    title: r.title as string,
    kind: r.kind as SourceKind,
    origin: r.origin as SourceOrigin,
    citation: (r.citation as SourceCitation) ?? {},
    recordDate: opt(r.record_date),
    recordYear: opt(r.record_year),
    language: opt(r.language),
    transcription: opt(r.transcription),
    document,
    createdAt: iso(r.created_at),
  };
}

export async function loadSources(db: Db, treeId: string, ids?: string[]): Promise<Source[]> {
  const rows = ids
    ? await db.query(`${SOURCE_SELECT} where s.tree_id = $1 and s.id = any($2::uuid[]) order by s.record_year nulls last, s.created_at`, [treeId, ids])
    : await db.query(`${SOURCE_SELECT} where s.tree_id = $1 order by s.created_at desc`, [treeId]);
  return rows.map(toSource);
}

export async function getSource(db: Db, treeId: string, id: string): Promise<Source> {
  const [s] = await loadSources(db, treeId, [id]);
  if (!s) throw notFound('Source');
  return s;
}

export interface SourceInput {
  title: string;
  kind: SourceKind;
  origin: SourceOrigin;
  citation: SourceCitation;
  recordDate?: string;
  language?: string;
  transcription?: string;
}

export async function createSource(db: Db, treeId: string, input: SourceInput, documentId?: string): Promise<Source> {
  const id = randomUUID();
  await db.query(
    `insert into sources (id, tree_id, title, kind, origin, citation, record_date, record_year, language, transcription, document_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      id,
      treeId,
      input.title,
      input.kind,
      input.origin,
      JSON.stringify(input.citation),
      input.recordDate ?? null,
      extractYear(input.recordDate) ?? null,
      input.language ?? null,
      input.transcription ?? null,
      documentId ?? null,
    ],
  );
  await touch(db, treeId);
  return getSource(db, treeId, id);
}

// ---------- GEDCOM import ----------

export interface ImportResult {
  source: Source;
  peopleCreated: number;
  relationshipsCreated: number;
}

/**
 * Imports a GEDCOM file into a tree. The file is stored as a document behind an `authored` Source;
 * every person and relationship points at that source and starts `unsupported`. People already in
 * the tree are left alone (importing twice creates duplicates, to be merged later).
 */
export async function importGedcom(db: Db, storage: DocumentStorage, treeId: string, file: UploadedFile): Promise<ImportResult> {
  const ged = parseGedcom(decodeGedcom(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer));
  if (!ged.people.size) throw badRequest('No people found. Is it a GEDCOM file?');
  const { people, links } = gedcomToDrafts(ged);

  const documentId = await createDocument(db, storage, treeId, { ...file, type: 'text/plain' });
  try {
    return await db.transaction(async (tx) => {
      const source = await createSource(
        tx,
        treeId,
        { title: `GEDCOM import: ${file.name}`, kind: 'authored', origin: 'gedcom', citation: {} },
        documentId,
      );
      const ids = new Map(people.map((p) => [p.ref, randomUUID()]));
      await tx.query(
        `insert into persons (id, tree_id, given_name, surname, sex, birth, baptism, death, burial, occupation, origin, origin_source_id, origin_ref)
         select x.id, $1, x.given_name, x.surname, x.sex, x.birth, x.baptism, x.death, x.burial, x.occupation, 'gedcom', $2, x.origin_ref
           from jsonb_to_recordset($3::jsonb) as x(id uuid, given_name text, surname text, sex text, birth jsonb, baptism jsonb,
                                                  death jsonb, burial jsonb, occupation text, origin_ref text)`,
        [
          treeId,
          source.id,
          JSON.stringify(
            people.map((p) => ({
              id: ids.get(p.ref),
              given_name: p.givenName,
              surname: p.surname,
              sex: p.sex ?? null,
              birth: p.birth ?? null,
              baptism: p.baptism ?? null,
              death: p.death ?? null,
              burial: p.burial ?? null,
              occupation: p.occupation ?? null,
              origin_ref: p.ref,
            })),
          ),
        ],
      );
      const relRows = links
        .filter((l) => ids.has(l.fromRef) && ids.has(l.toRef))
        .map((l) => ({ id: randomUUID(), kind: l.kind, from_person: ids.get(l.fromRef), to_person: ids.get(l.toRef) }));
      await tx.query(
        `insert into relationships (id, tree_id, kind, from_person, to_person, origin, origin_source_id, confidence)
         select x.id, $1, x.kind, x.from_person, x.to_person, 'gedcom', $2, 'unsupported'
           from jsonb_to_recordset($3::jsonb) as x(id uuid, kind text, from_person uuid, to_person uuid)`,
        [treeId, source.id, JSON.stringify(relRows)],
      );
      await touch(tx, treeId);
      return { source, peopleCreated: people.length, relationshipsCreated: relRows.length };
    });
  } catch (e) {
    await db.query('delete from documents where id = $1', [documentId]);
    await storage.delete(`trees/${treeId}/${documentId}`);
    throw e;
  }
}

// ---------- Claims ----------

function toClaim(r: Row, persons: ClaimPersonLink[], relationships: ClaimRelationshipLink[]): Claim {
  return {
    id: r.id as string,
    treeId: r.tree_id as string,
    sourceId: r.source_id as string,
    kind: r.kind as ClaimKind,
    statement: r.statement as string,
    eventDate: opt(r.event_date),
    eventYear: opt(r.event_year),
    eventPlace: opt(r.event_place),
    information: r.information as InformationQuality,
    reading: r.reading as ReadingConfidence,
    extractedBy: { kind: r.extracted_by_kind as Extractor['kind'], name: r.extracted_by_name as string },
    review: r.review as ReviewStatus,
    persons,
    relationships,
    createdAt: iso(r.created_at),
  };
}

/** Loads claims by id, with their person and relationship links. */
export async function loadClaims(db: Db, treeId: string, ids: string[]): Promise<Claim[]> {
  if (!ids.length) return [];
  const rows = await db.query(
    'select * from claims where tree_id = $1 and id = any($2::uuid[]) order by event_year nulls last, created_at',
    [treeId, ids],
  );
  const persons = await db.query('select * from claim_persons where claim_id = any($1::uuid[])', [ids]);
  const rels = await db.query('select * from claim_relationships where claim_id = any($1::uuid[])', [ids]);
  return rows.map((r) =>
    toClaim(
      r,
      persons.filter((p) => p.claim_id === r.id).map((p) => ({ personId: p.person_id as string, role: p.role as ClaimRole })),
      rels
        .filter((x) => x.claim_id === r.id)
        .map((x) => ({
          relationshipId: x.relationship_id as string,
          stance: x.stance as Stance,
          evidence: x.evidence as EvidenceType,
          note: opt(x.note),
        })),
    ),
  );
}

export async function getClaim(db: Db, treeId: string, id: string): Promise<Claim> {
  const [c] = await loadClaims(db, treeId, [id]);
  if (!c) throw notFound('Claim');
  return c;
}

export interface ClaimInput {
  kind: ClaimKind;
  statement: string;
  eventDate?: string;
  eventPlace?: string;
  information: InformationQuality;
  reading: ReadingConfidence;
  extractedBy: Extractor;
  review: ReviewStatus;
  persons: ClaimPersonLink[];
  relationships: ClaimRelationshipLink[];
}

/** Throws 400 unless every id belongs to the tree. */
async function checkInTree(db: Db, table: 'persons' | 'relationships', treeId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await db.query(`select id from ${table} where tree_id = $1 and id = any($2::uuid[])`, [treeId, unique]);
  if (rows.length !== unique.length) throw badRequest(`Unknown ${table === 'persons' ? 'person' : 'relationship'} in this tree`);
}

export async function createClaim(db: Db, treeId: string, sourceId: string, input: ClaimInput) {
  await getSource(db, treeId, sourceId);
  await checkInTree(db, 'persons', treeId, input.persons.map((p) => p.personId));
  await checkInTree(db, 'relationships', treeId, input.relationships.map((r) => r.relationshipId));
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into claims (id, tree_id, source_id, kind, statement, event_date, event_year, event_place, information, reading,
                           extracted_by_kind, extracted_by_name, review)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        treeId,
        sourceId,
        input.kind,
        input.statement,
        input.eventDate ?? null,
        extractYear(input.eventDate) ?? null,
        input.eventPlace ?? null,
        input.information,
        input.reading,
        input.extractedBy.kind,
        input.extractedBy.name,
        input.review,
      ],
    );
    if (input.persons.length) {
      await tx.query(
        `insert into claim_persons (claim_id, person_id, role)
         select $1, x.person_id, x.role from jsonb_to_recordset($2::jsonb) as x(person_id uuid, role text)
         on conflict do nothing`,
        [id, JSON.stringify(input.persons.map((p) => ({ person_id: p.personId, role: p.role })))],
      );
    }
    for (const link of input.relationships) await upsertLink(tx, id, link);
  });
  const changed = await recompute(db, treeId, input.relationships.map((r) => r.relationshipId));
  return { claim: await getClaim(db, treeId, id), changed };
}

async function upsertLink(db: Db, claimId: string, link: ClaimRelationshipLink) {
  await db.query(
    `insert into claim_relationships (claim_id, relationship_id, stance, evidence, note) values ($1, $2, $3, $4, $5)
     on conflict (claim_id, relationship_id) do update set stance = excluded.stance, evidence = excluded.evidence, note = excluded.note`,
    [claimId, link.relationshipId, link.stance, link.evidence, link.note ?? null],
  );
}

const linkedRelationships = async (db: Db, claimId: string) =>
  (await db.query<{ relationship_id: string }>('select relationship_id from claim_relationships where claim_id = $1', [claimId])).map(
    (r) => r.relationship_id,
  );

export interface ClaimPatch {
  statement?: string;
  review?: ReviewStatus;
  information?: InformationQuality;
  reading?: ReadingConfidence;
}

export async function updateClaim(db: Db, treeId: string, claimId: string, patch: ClaimPatch) {
  await getClaim(db, treeId, claimId);
  const cols = { statement: patch.statement, review: patch.review, information: patch.information, reading: patch.reading };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (set.length) {
    await db.query(
      `update claims set ${set.map(([k], i) => `${k} = $${i + 3}`).join(', ')} where tree_id = $1 and id = $2`,
      [treeId, claimId, ...set.map(([, v]) => v)],
    );
  }
  const changed = await recompute(db, treeId, await linkedRelationships(db, claimId));
  return { claim: await getClaim(db, treeId, claimId), changed };
}

export async function deleteClaim(db: Db, treeId: string, claimId: string) {
  await getClaim(db, treeId, claimId);
  const rels = await linkedRelationships(db, claimId);
  await db.query('delete from claims where tree_id = $1 and id = $2', [treeId, claimId]);
  return { changed: await recompute(db, treeId, rels) };
}

export async function linkClaim(db: Db, treeId: string, claimId: string, link: ClaimRelationshipLink) {
  await getClaim(db, treeId, claimId);
  await checkInTree(db, 'relationships', treeId, [link.relationshipId]);
  await upsertLink(db, claimId, link);
  const changed = await recompute(db, treeId, [link.relationshipId]);
  return { claim: await getClaim(db, treeId, claimId), changed };
}

export async function unlinkClaim(db: Db, treeId: string, claimId: string, relationshipId: string) {
  await getClaim(db, treeId, claimId);
  await db.query('delete from claim_relationships where claim_id = $1 and relationship_id = $2', [claimId, relationshipId]);
  const changed = await recompute(db, treeId, [relationshipId]);
  return { claim: await getClaim(db, treeId, claimId), changed };
}

// ---------- Evidence views ----------

export async function relationshipEvidence(db: Db, treeId: string, relId: string): Promise<RelationshipEvidence> {
  const relationship = await getRelationship(db, treeId, relId);
  const claimIds = (
    await db.query<{ claim_id: string }>('select claim_id from claim_relationships where relationship_id = $1', [relId])
  ).map((r) => r.claim_id);
  const claims = await loadClaims(db, treeId, claimIds);
  const sources = await loadSources(db, treeId, [...new Set(claims.map((c) => c.sourceId))]);
  const explanation = computeConfidence(await evidenceItems(db, treeId, [relId]));
  return { relationship, claims, sources, explanation };
}

/** Claims that mention the person, plus claims about their relationships, with their sources. */
export async function personEvidence(db: Db, treeId: string, personId: string, currentYear: number): Promise<PersonEvidence> {
  const [person] = await loadPeople(db, treeId, currentYear, [personId]);
  if (!person) throw notFound('Person');
  const claimIds = (
    await db.query<{ id: string }>(
      `select claim_id as id from claim_persons where person_id = $1
       union
       select cr.claim_id from claim_relationships cr join relationships r on r.id = cr.relationship_id
        where r.from_person = $1 or r.to_person = $1`,
      [personId],
    )
  ).map((r) => r.id);
  const claims = await loadClaims(db, treeId, claimIds);
  const sourceIds = new Set(claims.map((c) => c.sourceId));
  if (person.originSourceId) sourceIds.add(person.originSourceId);
  const sources = await loadSources(db, treeId, [...sourceIds]);
  return { person, claims, sources };
}
