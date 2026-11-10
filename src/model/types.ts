// The evidence model, following the Genealogical Proof Standard (GPS):
//
//   Source ──makes──▶ Claim ──is about──▶ Person
//                        │
//                        └──supports / contradicts──▶ Relationship ──links──▶ Person, Person
//
// A Source is a document or record (an image or PDF of it, where it is held, and how to find it
// again). A Claim is one statement that a source makes, as read by someone (a person or the AI).
// People and relationships are conclusions built from claims. A relationship's confidence level is
// computed from the claims that support or contradict it (see `confidence.ts`).
//
// These types are the contract shared by the API server (`server/`), the tree view (`src/tree/`)
// and later the AI record reader and the print renderer. They are plain JSON: ids are strings,
// dates are ISO strings, and nothing here depends on the browser or on Node.

import type { LifeEvent } from '../gedcom';

export type { LifeEvent };

/** Every id is an opaque string (a UUID on the server). */
export type Id = string;

// ---------- Confidence ----------

/**
 * How well a relationship is established, from best to worst:
 *
 * - `proven`: a primary document names the link directly, and nothing contradicts it.
 * - `probable`: several independent indirect pieces agree, or one direct statement made by
 *   someone who was not present (secondary information).
 * - `possible`: one indirect piece, or a link proposed by the AI that nobody has confirmed yet.
 * - `conflict`: sources disagree (at least one confirmed claim contradicts the link).
 * - `unsupported`: no source at all. Everything imported from a GEDCOM or typed by hand starts here.
 */
export type ConfidenceLevel = 'proven' | 'probable' | 'possible' | 'conflict' | 'unsupported';

/** Levels in display order (best first), e.g. for legends and health bars. */
export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['proven', 'probable', 'possible', 'conflict', 'unsupported'];

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  proven: 'Proven',
  probable: 'Probable',
  possible: 'Possible',
  conflict: 'In conflict',
  unsupported: 'Unsupported',
};

// ---------- Documents & sources ----------

/** A stored file (scan, photo or PDF of a record). The bytes live in object storage, not the DB. */
export interface DocumentAttachment {
  id: Id;
  fileName: string;
  /** MIME type, e.g. `image/jpeg` or `application/pdf`. */
  mediaType: string;
  sizeBytes: number;
  /** Hex SHA-256 of the bytes, to spot the same scan uploaded twice. */
  sha256: string;
  /** Where to fetch the bytes from (an API path; a signed URL once storage is S3). */
  url: string;
  createdAt: string;
}

/**
 * GPS source classification:
 * - `original`: the record as first made (parish register entry, civil registration).
 * - `derivative`: copied, transcribed, indexed or abstracted from an original (index, extract).
 * - `authored`: a compiled conclusion (family tree, GEDCOM, published genealogy). An authored
 *   source on its own never raises a relationship's confidence.
 */
export type SourceKind = 'original' | 'derivative' | 'authored';

/** How the source got into the tree. `gedcom` sources are created by an import. */
export type SourceOrigin = 'upload' | 'gedcom' | 'manual';

/** Where a record is held and how to find it again (book / folio / entry). */
export interface SourceCitation {
  /** Holding archive, e.g. "Arquivo Distrital de Braga" or "Cartório do 1º Ofício, Campinas". */
  archive?: string;
  /** Collection or record series, e.g. "Paróquia de São Vicente, Baptismos". */
  collection?: string;
  /** Book (livro) identifier. */
  book?: string;
  /** Folio or page (folha), e.g. "23v". */
  folio?: string;
  /** Entry (assento / termo) number. */
  entry?: string;
  /** Online location of the image, if any (FamilySearch, Tombo, etc.). */
  url?: string;
}

export interface Source {
  id: Id;
  treeId: Id;
  /** Short human title, e.g. "Baptism of Miguel Costa, Braga 1898". */
  title: string;
  kind: SourceKind;
  origin: SourceOrigin;
  citation: SourceCitation;
  /** Date of the record itself (when the event was written down), as written: "12 MAR 1898". */
  recordDate?: string;
  /** Year extracted from `recordDate`, for sorting on a timeline. */
  recordYear?: number;
  /** BCP 47 language code of the record, e.g. `pt`, `la`, `it`. */
  language?: string;
  /** Full transcription, in the record's language. */
  transcription?: string;
  /** The scan / PDF, if one was uploaded. */
  document?: DocumentAttachment;
  createdAt: string;
}

// ---------- Claims ----------

/** Who read the source and wrote the claim down. */
export interface Extractor {
  kind: 'person' | 'ai';
  /** User id or display name for people; model id for the AI. */
  name: string;
}

/**
 * GPS information quality, judged per claim (one record can hold both):
 * - `primary`: given by someone with first-hand knowledge (the priest at the baptism, the parents).
 * - `secondary`: given by someone repeating what they heard (ages and parents on a death record).
 * - `undetermined`: cannot tell who supplied it.
 */
export type InformationQuality = 'primary' | 'secondary' | 'undetermined';

/** How sure the reader is that they read the handwriting correctly. */
export type ReadingConfidence = 'clear' | 'likely' | 'uncertain';

/** Review state of an AI-extracted claim. Claims typed by a person are always `accepted`. */
export type ReviewStatus = 'proposed' | 'accepted' | 'rejected';

/** What a claim is about, to group it on timelines and to suggest relationship links. */
export type ClaimKind =
  | 'birth'
  | 'baptism'
  | 'marriage'
  | 'death'
  | 'burial'
  | 'parentage'
  | 'residence'
  | 'occupation'
  | 'name'
  | 'other';

/** Role a person plays in a claim, e.g. the baptised child, the father, a godparent. */
export type ClaimRole =
  | 'subject'
  | 'father'
  | 'mother'
  | 'parent'
  | 'spouse'
  | 'child'
  | 'godparent'
  | 'witness'
  | 'grandparent'
  | 'other';

export interface ClaimPersonLink {
  personId: Id;
  role: ClaimRole;
}

/** Whether a claim argues for or against a relationship. */
export type Stance = 'supports' | 'contradicts';

/**
 * GPS evidence type, judged against one relationship (the same claim can be direct for one link
 * and indirect for another):
 * - `direct`: the claim states the link outright ("son of Manuel and Rosa").
 * - `indirect`: the link follows only when combined with other facts (same godparent, same street).
 */
export type EvidenceType = 'direct' | 'indirect';

export interface ClaimRelationshipLink {
  relationshipId: Id;
  stance: Stance;
  evidence: EvidenceType;
  /** Why this claim bears on the link, in a sentence. */
  note?: string;
}

export interface Claim {
  id: Id;
  treeId: Id;
  sourceId: Id;
  kind: ClaimKind;
  /** The statement, in the researcher's words: "Miguel, son of Manuel Costa and Rosa Lima, baptised 3 Jan 1898". */
  statement: string;
  /** Date the claim gives for the event, as written. */
  eventDate?: string;
  eventYear?: number;
  eventPlace?: string;
  information: InformationQuality;
  reading: ReadingConfidence;
  extractedBy: Extractor;
  review: ReviewStatus;
  persons: ClaimPersonLink[];
  relationships: ClaimRelationshipLink[];
  createdAt: string;
}

// ---------- People & relationships ----------

/** How a person or relationship entered the tree. */
export type Origin = 'gedcom' | 'manual' | 'ai';

/** Explicit privacy choice for a person; `null` means "decide from the living rule". */
export type PrivacyOverride = 'private' | 'public' | null;

export interface Person {
  id: Id;
  treeId: Id;
  givenName: string;
  surname: string;
  /** Display name: given name + surname. */
  name: string;
  sex?: 'M' | 'F' | 'U';
  birth?: LifeEvent;
  baptism?: LifeEvent;
  death?: LifeEvent;
  burial?: LifeEvent;
  occupation?: string;
  origin: Origin;
  /** The Source this person was imported from (the GEDCOM), if any. */
  originSourceId?: Id;
  /** The person's id in that source (the GEDCOM xref, e.g. `@I12@`). */
  originRef?: string;
  /**
   * When two records turn out to describe the same person they are merged: the absorbed person
   * keeps its row (so claims and history stay intact) and points at the surviving one.
   * Splitting is the reverse: claims are moved to a new person.
   */
  mergedInto?: Id;
  privacyOverride: PrivacyOverride;
  /** Computed by the living rule (`isPresumedLiving`). */
  presumedLiving: boolean;
  /** Hidden from anyone but the tree's owners: override if set, otherwise `presumedLiving`. */
  isPrivate: boolean;
  createdAt: string;
}

/**
 * - `parent`: `from` is the parent, `to` is the child.
 * - `spouse`: `from` and `to` are the two partners (order carries no meaning).
 */
export type RelationshipKind = 'parent' | 'spouse';

export interface Relationship {
  id: Id;
  treeId: Id;
  kind: RelationshipKind;
  from: Id;
  to: Id;
  origin: Origin;
  originSourceId?: Id;
  /** Computed by `computeConfidence` from the linked claims; stored so lists are cheap. */
  confidence: ConfidenceLevel;
  /** The researcher's proof argument, in a few sentences. */
  argument?: string;
  confidenceUpdatedAt: string;
  createdAt: string;
}

// ---------- Trees ----------

export interface TreeSummary {
  id: Id;
  name: string;
  ownerId: Id;
  peopleCount: number;
  relationshipCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Share of links at each confidence level. */
export interface TreeHealth {
  total: number;
  counts: Record<ConfidenceLevel, number>;
  /** proven / total, 0 when there are no links. */
  provenShare: number;
}

/** Everything needed to draw a tree. Claims and sources are fetched per person or link. */
export interface TreeDetail {
  tree: TreeSummary;
  people: Person[];
  relationships: Relationship[];
  health: TreeHealth;
}

/** The evidence behind one relationship, for the link panel. */
export interface RelationshipEvidence {
  relationship: Relationship;
  /** Claims linked to the relationship, each with its stance. */
  claims: Claim[];
  sources: Source[];
  explanation: ConfidenceExplanation;
}

/** The documents behind one person, for their timeline. */
export interface PersonEvidence {
  person: Person;
  claims: Claim[];
  sources: Source[];
}

/** Why a relationship got its level, as computed by `computeConfidence`. */
export interface ConfidenceExplanation {
  level: ConfidenceLevel;
  /** Plain-language reasons, most important first. */
  reasons: string[];
  supporting: number;
  contradicting: number;
  /** AI proposals not yet reviewed; they count only towards `possible`. */
  pendingProposals: number;
}
