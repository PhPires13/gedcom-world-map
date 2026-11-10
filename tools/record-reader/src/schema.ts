/**
 * Schemas for the record reader.
 *
 * Two shapes share one tree:
 *  - `ModelReading` is what Claude returns (structured output). Boxes are pixel
 *    coordinates in the page image exactly as it was sent to the model.
 *  - `ReadResult` is what the library/CLI returns. Boxes are normalised to 0..1
 *    of the page, so they stay valid at any resolution, and the result adds
 *    source metadata, usage/cost, proposed claims and warnings.
 *
 * Structured outputs do not support numeric/string-length constraints or
 * recursive schemas, so the model-facing schema uses plain types and the
 * sanity checks (ranges, ids, boxes) live in `postprocess.ts`.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "record-reader/0.1";

// ---------------------------------------------------------------- enums

export const Legibility = z.enum(["clear", "unclear", "partly_illegible", "illegible"]);
export type Legibility = z.infer<typeof Legibility>;

export const EntryType = z.enum([
  "baptism",
  "birth",
  "marriage",
  "banns",
  "death",
  "burial",
  "confirmation",
  "other",
]);
export type EntryType = z.infer<typeof EntryType>;

export const Jurisdiction = z.enum(["parish", "civil", "notarial", "other", "unknown"]);

export const Role = z.enum([
  "subject", // the baptised / born / deceased / confirmed person
  "groom",
  "bride",
  "father",
  "mother",
  "paternal_grandfather",
  "paternal_grandmother",
  "maternal_grandfather",
  "maternal_grandmother",
  "godfather",
  "godmother",
  "godparent", // sex not stated
  "spouse", // e.g. the surviving spouse named in a burial
  "former_spouse", // "viúvo de …", "vedova di …"
  "sibling",
  "child",
  "other_relative",
  "witness",
  "officiant", // priest / curate who performed the act
  "registrar", // civil officer, or priest who only wrote the entry
  "declarant", // person who reported a civil birth/death
  "informant",
  "physician",
  "other",
]);
export type Role = z.infer<typeof Role>;

export const RelationType = z.enum([
  "parent_of",
  "spouse_of",
  "former_spouse_of",
  "grandparent_of",
  "godparent_of",
  "sibling_of",
  "relative_of",
]);
export type RelationType = z.infer<typeof RelationType>;

export const Sex = z.enum(["male", "female", "unknown"]);

export const DocumentKind = z.enum([
  "parish_register",
  "civil_register",
  "civil_certificate",
  "notarial",
  "census",
  "other_record",
  "not_a_record",
  "unknown",
]);

export const Script = z.enum([
  "handwritten",
  "typewritten",
  "printed",
  "printed_form_with_handwriting",
  "mixed",
  "none",
]);

export const OverallLegibility = z.enum(["good", "fair", "poor", "illegible"]);

export const OtherDateKind = z.enum(["birth", "baptism", "death", "burial", "marriage", "banns", "registration", "other"]);

// ---------------------------------------------------------------- boxes

/** Pixel box in the image as sent to the model (page is 1-based). */
export const PixelBox = z.object({
  page: z.number(),
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});
export type PixelBox = z.infer<typeof PixelBox>;

/** Normalised box: fractions of page width/height, origin top-left (page is 1-based). */
export const NormBox = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type NormBox = z.infer<typeof NormBox>;

// ---------------------------------------------------------------- tree builder

function buildTree<B extends z.ZodTypeAny>(Box: B) {
  /** One extracted value with its evidence on the page. */
  const Field = z.object({
    as_written: z
      .string()
      .nullable()
      .describe("Exactly as on the page: original spelling and abbreviations, '[illegible]' where unreadable."),
    value: z
      .string()
      .nullable()
      .describe("Interpreted value: abbreviations expanded, spelling modernised; dates as ISO 8601 (YYYY, YYYY-MM or YYYY-MM-DD); ages as a number of years or e.g. '6 months'. Null when unreadable."),
    box: Box.nullable().describe("Where this value is written on the page."),
    confidence: z.number().describe("Reading confidence 0..1 for this value."),
    legibility: Legibility,
    note: z.string().nullable(),
  });

  const Relation = z.object({
    type: RelationType,
    to: z.string().describe("id of the other person in the same entry"),
    evidence: Field.nullable().describe("The words that state the relationship, e.g. 'sua mulher', 'neto paterno de'."),
  });

  const Person = z.object({
    id: z.string(),
    roles: z.array(Role),
    name: Field.describe("Full name as stated. value = normalised spelling of what is written; never add surnames that are not written."),
    given_names: z.string().nullable(),
    surnames: z.string().nullable(),
    sex: Sex,
    is_real_person: z
      .boolean()
      .describe("False for devotional figures, e.g. 'Nossa Senhora' as godmother."),
    age: Field.nullable(),
    marital_status: Field.nullable(),
    occupation: Field.nullable(),
    residence: Field.nullable(),
    origin: Field.nullable().describe("Birthplace / naturalidade / parish of origin."),
    other_facts: z.array(z.object({ key: z.string(), field: Field })),
    relations: z.array(Relation),
  });

  const Entry = z.object({
    id: z.string(),
    type: EntryType,
    jurisdiction: Jurisdiction,
    box: Box.nullable(),
    line_ids: z.array(z.string()),
    margin_note: Field.nullable(),
    date: Field.describe("Date of the event this entry records (baptism date for a baptism, birth date for a civil birth, burial date for a burial, …)."),
    other_dates: z.array(z.object({ kind: OtherDateKind, field: Field })),
    place: Field.nullable().describe("Church / parish / municipality where the event took place."),
    people: z.array(Person),
    facts: z.array(
      z.object({
        key: z.string().describe("e.g. legitimacy, cause_of_death, burial_place, sacraments, testament, foundling, entry_number"),
        field: Field,
      }),
    ),
    summary_en: z.string(),
    confidence: z.number(),
  });

  const Line = z.object({
    id: z.string(),
    page: z.number(),
    text: z.string(),
    box: Box.nullable(),
    confidence: z.number(),
    has_illegible: z.boolean(),
  });

  const IllegibleRegion = z.object({
    page: z.number(),
    box: Box.nullable(),
    context: z.string().describe("Readable text around the gap, to locate it."),
    reason: z.string(),
    candidate_readings: z.array(z.string()),
  });

  const Document = z.object({
    is_record: z.boolean(),
    not_record_reason: z.string().nullable(),
    kind: DocumentKind,
    languages: z.array(z.string()).describe("ISO 639-1 codes, e.g. pt, la, it, es."),
    script: Script,
    period_estimate: z.string().nullable(),
    legibility: OverallLegibility,
    repository_marks: z.string().nullable().describe("Folio numbers, stamps, register titles, archive references visible on the page."),
  });

  const Reading = z.object({
    document: Document,
    transcription: z.array(Line),
    expanded_text: z.string(),
    translation_en: z.string(),
    illegible_regions: z.array(IllegibleRegion),
    entries: z.array(Entry),
    reader_notes: z.array(z.string()),
  });

  return { Field, Relation, Person, Entry, Line, IllegibleRegion, Document, Reading };
}

const modelTree = buildTree(PixelBox);
const outTree = buildTree(NormBox);

/** Schema Claude must answer with (structured output). */
export const ModelReading = modelTree.Reading;
export type ModelReading = z.infer<typeof ModelReading>;
export type ModelField = z.infer<typeof modelTree.Field>;
export type ModelEntry = z.infer<typeof modelTree.Entry>;
export type ModelPerson = z.infer<typeof modelTree.Person>;

export const Field = outTree.Field;
export type Field = z.infer<typeof Field>;
export const Person = outTree.Person;
export type Person = z.infer<typeof Person>;
export const Entry = outTree.Entry;
export type Entry = z.infer<typeof Entry>;
export type Line = z.infer<typeof outTree.Line>;
export type IllegibleRegion = z.infer<typeof outTree.IllegibleRegion>;

// ---------------------------------------------------------------- hints

export const Hints = z.object({
  parish: z.string().optional(),
  place: z.string().optional(),
  year_from: z.number().int().optional(),
  year_to: z.number().int().optional(),
  language: z.string().optional(),
  record_type: z.string().optional(),
  names: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type Hints = z.infer<typeof Hints>;

// ---------------------------------------------------------------- claims

export const EvidenceRef = z.object({
  entry_id: z.string(),
  path: z.string().describe("Path of the field in the result, e.g. entries[0].people[1].name"),
  as_written: z.string().nullable(),
  box: NormBox.nullable(),
  reading_confidence: z.number(),
  legibility: Legibility,
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const ClaimValue = z.object({
  value: z.string().nullable(),
  as_written: z.string().nullable(),
});

export const Claim = z.object({
  id: z.string(),
  entry_id: z.string(),
  kind: z.enum(["event", "name", "person_fact", "relationship", "record_fact"]),
  /** Persona the claim is about (persona ids are local to this read: `e1.p2`). */
  subject: z.string(),
  /** For kind=event: event type; person_fact/record_fact: the fact key; relationship: relation type; name: "name". */
  predicate: z.string(),
  /** The claim in plain English, e.g. "Joaquim Ferreira is a parent of Maria." */
  statement: z.string(),
  object: z.object({
    persona: z.string().nullable(),
    value: z.string().nullable(),
    as_written: z.string().nullable(),
    date: ClaimValue.nullable(),
    place: ClaimValue.nullable(),
    participants: z.array(z.object({ persona: z.string(), role: Role })).nullable(),
  }),
  evidence: z.array(EvidenceRef),
  /** Lowest reading confidence among the evidence. */
  reading_confidence: z.number(),
  /** True when the claim follows from the record's wording rather than being stated outright (e.g. grandparent → parent of the father). */
  inferred: z.boolean(),
  note: z.string().nullable(),
  status: z.literal("proposed"),
});
export type Claim = z.infer<typeof Claim>;

export const Persona = z.object({
  id: z.string(),
  entry_id: z.string(),
  name: z.string().nullable(),
  name_as_written: z.string().nullable(),
  roles: z.array(Role),
  sex: Sex,
  is_real_person: z.boolean(),
});
export type Persona = z.infer<typeof Persona>;

// ---------------------------------------------------------------- result

export const PageInfo = z.object({
  page: z.number().int(),
  file: z.string(),
  file_page: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  sent_width: z.number().int(),
  sent_height: z.number().int(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const Usage = z.object({
  requests: z.number().int(),
  zooms: z.number().int(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type Usage = z.infer<typeof Usage>;

export const ReadStatus = z.enum(["ok", "partly_illegible", "illegible", "not_a_record"]);

export const ReadResult = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  status: ReadStatus,
  source: z.object({
    files: z.array(z.object({ path: z.string(), sha256: z.string(), media_type: z.string() })),
    pages: z.array(PageInfo),
    hints: Hints.nullable(),
  }),
  reader: z.object({
    version: z.string(),
    model_requested: z.string(),
    model_served: z.string(),
    fallback_used: z.boolean(),
    effort: z.string(),
    read_at: z.string(),
  }),
  usage: Usage,
  document: outTree.Document,
  transcription: z.array(outTree.Line),
  expanded_text: z.string(),
  translation_en: z.string(),
  illegible_regions: z.array(outTree.IllegibleRegion),
  entries: z.array(Entry),
  personas: z.array(Persona),
  claims: z.array(Claim),
  hint_matches: z.array(
    z.object({ query: z.string(), persona: z.string(), name: z.string(), score: z.number() }),
  ),
  reader_notes: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ReadResult = z.infer<typeof ReadResult>;
