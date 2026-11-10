/**
 * Turns the model's reading into the public result: pixel boxes become
 * normalised boxes (with sanity checks), ids are made unique and consistent,
 * confidences are clamped, and the read gets an overall status.
 */
import type {
  Entry,
  Field,
  Hints,
  IllegibleRegion,
  Line,
  ModelField,
  ModelReading,
  NormBox,
  PageInfo,
  Person,
  PixelBox,
  ReadResult,
} from "./schema.js";
import { queryMatchScore } from "./text.js";

/** Boxes may overshoot the page edge by this fraction before they are rejected. */
const EDGE_TOLERANCE = 0.03;

export interface NormaliseContext {
  pages: PageInfo[];
  warnings: string[];
}

/** Converts a pixel box (in the sent image) into a normalised box, or null with a warning if it is not sane. */
export function normaliseBox(box: PixelBox | null, ctx: NormaliseContext, where: string): NormBox | null {
  if (!box) return null;
  const page = ctx.pages.find((p) => p.page === box.page);
  if (!page) {
    ctx.warnings.push(`${where}: box on page ${box.page}, which does not exist; box dropped.`);
    return null;
  }
  const vals = [box.x0, box.y0, box.x1, box.y1];
  if (vals.some((v) => !Number.isFinite(v))) {
    ctx.warnings.push(`${where}: box has non-numeric coordinates; box dropped.`);
    return null;
  }
  let x0 = Math.min(box.x0, box.x1) / page.sent_width;
  let x1 = Math.max(box.x0, box.x1) / page.sent_width;
  let y0 = Math.min(box.y0, box.y1) / page.sent_height;
  let y1 = Math.max(box.y0, box.y1) / page.sent_height;
  if (box.x0 > box.x1 || box.y0 > box.y1) {
    ctx.warnings.push(`${where}: box corners were swapped; fixed.`);
  }
  if (x0 < -EDGE_TOLERANCE || y0 < -EDGE_TOLERANCE || x1 > 1 + EDGE_TOLERANCE || y1 > 1 + EDGE_TOLERANCE) {
    ctx.warnings.push(`${where}: box lies outside page ${box.page}; box dropped.`);
    return null;
  }
  x0 = clamp01(x0);
  y0 = clamp01(y0);
  x1 = clamp01(x1);
  y1 = clamp01(y1);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) {
    ctx.warnings.push(`${where}: box has no area; box dropped.`);
    return null;
  }
  return { page: box.page, x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/** Converts a normalised box back to pixels of the original page image. */
export function toOriginalPixels(box: NormBox, page: PageInfo): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.round(box.x * page.width),
    y0: Math.round(box.y * page.height),
    x1: Math.round((box.x + box.w) * page.width),
    y1: Math.round((box.y + box.h) * page.height),
  };
}

export function boxContains(outer: NormBox, inner: NormBox, slack = 0.02): boolean {
  return (
    outer.page === inner.page &&
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

export function iou(a: NormBox, b: NormBox): number {
  if (a.page !== b.page) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function clampConfidence(v: number): number {
  return Number.isFinite(v) ? Math.round(clamp01(v) * 1000) / 1000 : 0;
}

function field(f: ModelField, ctx: NormaliseContext, where: string): Field {
  const legibility = f.legibility;
  let confidence = clampConfidence(f.confidence);
  // An illegible value cannot be a confident reading.
  if (legibility === "illegible") confidence = Math.min(confidence, 0.2);
  return {
    as_written: f.as_written,
    value: legibility === "illegible" ? null : f.value,
    box: normaliseBox(f.box, ctx, where),
    confidence,
    legibility,
    note: f.note,
  };
}

function optField(f: ModelField | null, ctx: NormaliseContext, where: string): Field | null {
  return f ? field(f, ctx, where) : null;
}

export interface Normalised {
  document: ReadResult["document"];
  transcription: Line[];
  expanded_text: string;
  translation_en: string;
  illegible_regions: IllegibleRegion[];
  entries: Entry[];
  reader_notes: string[];
  warnings: string[];
  status: ReadResult["status"];
}

export function normaliseReading(reading: ModelReading, pages: PageInfo[]): Normalised {
  const ctx: NormaliseContext = { pages, warnings: [] };

  const transcription: Line[] = reading.transcription.map((l, i) => ({
    id: l.id || `l${i + 1}`,
    page: l.page,
    text: l.text,
    box: normaliseBox(l.box, ctx, `transcription line ${l.id}`),
    confidence: clampConfidence(l.confidence),
    has_illegible: l.has_illegible || /\[illegible/i.test(l.text),
  }));

  const illegible_regions: IllegibleRegion[] = reading.illegible_regions.map((r, i) => ({
    page: r.page,
    box: normaliseBox(r.box, ctx, `illegible region ${i + 1}`),
    context: r.context,
    reason: r.reason,
    candidate_readings: r.candidate_readings,
  }));

  const entries: Entry[] = reading.entries.map((e, ei) => {
    const entryId = `e${ei + 1}`;
    const where = (s: string) => `${entryId} ${s}`;
    // Map model person ids → canonical ids "e1.p1".
    const idMap = new Map<string, string>();
    e.people.forEach((p, pi) => idMap.set(p.id, `${entryId}.p${pi + 1}`));

    const people: Person[] = e.people.map((p, pi) => {
      const pid = `${entryId}.p${pi + 1}`;
      const relations = p.relations.flatMap((r) => {
        const to = idMap.get(r.to);
        if (!to) {
          ctx.warnings.push(`${pid}: relation ${r.type} points to unknown person "${r.to}"; dropped.`);
          return [];
        }
        if (to === pid) {
          ctx.warnings.push(`${pid}: relation ${r.type} points to itself; dropped.`);
          return [];
        }
        return [{ type: r.type, to, evidence: optField(r.evidence, ctx, where(`${pid} relation evidence`)) }];
      });
      if (p.roles.length === 0) ctx.warnings.push(`${pid}: no role given.`);
      return {
        id: pid,
        roles: p.roles.length ? [...new Set(p.roles)] : ["other"],
        name: field(p.name, ctx, where(`${pid} name`)),
        given_names: p.given_names,
        surnames: p.surnames,
        sex: p.sex,
        is_real_person: p.is_real_person,
        age: optField(p.age, ctx, where(`${pid} age`)),
        marital_status: optField(p.marital_status, ctx, where(`${pid} marital status`)),
        occupation: optField(p.occupation, ctx, where(`${pid} occupation`)),
        residence: optField(p.residence, ctx, where(`${pid} residence`)),
        origin: optField(p.origin, ctx, where(`${pid} origin`)),
        other_facts: p.other_facts.map((f) => ({ key: f.key, field: field(f.field, ctx, where(`${pid} ${f.key}`)) })),
        relations,
      };
    });

    const entry: Entry = {
      id: entryId,
      type: e.type,
      jurisdiction: e.jurisdiction,
      box: normaliseBox(e.box, ctx, where("box")),
      line_ids: e.line_ids,
      margin_note: optField(e.margin_note, ctx, where("margin note")),
      date: field(e.date, ctx, where("date")),
      other_dates: e.other_dates.map((d) => ({ kind: d.kind, field: field(d.field, ctx, where(`${d.kind} date`)) })),
      place: optField(e.place, ctx, where("place")),
      people,
      facts: e.facts.map((f) => ({ key: f.key, field: field(f.field, ctx, where(f.key)) })),
      summary_en: e.summary_en,
      confidence: clampConfidence(e.confidence),
    };
    checkEntry(entry, ctx);
    return entry;
  });

  const status = readStatus(reading, entries, illegible_regions);
  return {
    document: reading.document,
    transcription,
    expanded_text: reading.expanded_text,
    translation_en: reading.translation_en,
    illegible_regions,
    entries,
    reader_notes: reading.reader_notes,
    warnings: ctx.warnings,
    status,
  };
}

const ISO_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** Plausibility checks that do not change data, only warn. */
function checkEntry(e: Entry, ctx: NormaliseContext): void {
  // Place is left out: it is often taken from the page heading, outside the entry.
  const fieldsWithBoxes: Array<[string, Field | null]> = [
    ["date", e.date],
    ...e.people.map((p): [string, Field | null] => [`${p.id} name`, p.name]),
  ];
  if (e.box) {
    for (const [label, f] of fieldsWithBoxes) {
      if (f?.box && f.box.page === e.box.page && !boxContains(e.box, f.box, 0.05)) {
        ctx.warnings.push(`${e.id}: ${label} box lies outside the entry box; check the location.`);
      }
    }
  }
  const dates = [e.date, ...e.other_dates.map((d) => d.field)];
  for (const d of dates) {
    if (d.value && !ISO_DATE.test(d.value)) {
      ctx.warnings.push(`${e.id}: date value "${d.value}" is not ISO 8601 (YYYY[-MM[-DD]]).`);
    }
  }
  for (const p of e.people) {
    const age = p.age?.value;
    if (age) {
      const years = Number.parseFloat(age);
      if (Number.isFinite(years) && (years < 0 || years > 120)) {
        ctx.warnings.push(`${p.id}: implausible age "${age}".`);
      }
    }
  }
  const principals = e.people.filter((p) => p.roles.some((r) => r === "subject" || r === "groom" || r === "bride"));
  if (e.people.length > 0 && principals.length === 0) {
    ctx.warnings.push(`${e.id}: no subject/groom/bride identified.`);
  }
}

function readStatus(
  reading: ModelReading,
  entries: Entry[],
  regions: IllegibleRegion[],
): ReadResult["status"] {
  if (!reading.document.is_record || reading.document.kind === "not_a_record") return "not_a_record";
  if (entries.length === 0 || reading.document.legibility === "illegible") return "illegible";
  const anyIllegible =
    regions.length > 0 ||
    entries.some((e) =>
      [e.date, e.place, ...e.people.map((p) => p.name)].some(
        (f) => f && (f.legibility === "illegible" || f.legibility === "partly_illegible"),
      ),
    );
  return anyIllegible ? "partly_illegible" : "ok";
}

export function matchHints(hints: Hints | null, entries: Entry[]): ReadResult["hint_matches"] {
  if (!hints?.names?.length) return [];
  const out: ReadResult["hint_matches"] = [];
  for (const query of hints.names) {
    for (const e of entries) {
      for (const p of e.people) {
        const candidates = [p.name.value, p.name.as_written].filter((s): s is string => !!s);
        const score = Math.max(0, ...candidates.map((c) => queryMatchScore(query, c)));
        if (score >= 0.8) {
          out.push({ query, persona: p.id, name: p.name.value ?? p.name.as_written ?? "", score: Math.round(score * 100) / 100 });
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
