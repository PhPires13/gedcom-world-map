/**
 * Field-level scoring of a reading against a hand-checked expected sample.
 *
 * Every expected value becomes one observation (correct / not correct), tagged
 * with the sample's century, script and language and the entry's type, so the
 * report can show accuracy overall and per record type / century / script.
 * Missing entries or people count as wrong for all of their fields
 * (end-to-end accuracy).
 */
import { iou } from "../postprocess.js";
import type { Entry, NormBox, Person, ReadResult, Role } from "../schema.js";
import { fold, foldName, nameCer, nameSimilarity } from "../text.js";
import type { ExpectedEntry, ExpectedPerson, ExpectedSampleParsed } from "./expected.js";

export const METRICS = [
  "record_detected",
  "entry_found",
  "entry_type",
  "date",
  "place",
  "person_found",
  "name",
  "role",
  "sex",
  "age",
  "occupation",
  "marital_status",
  "name_box",
  "illegible_flagged",
] as const;
export type Metric = (typeof METRICS)[number];
export const NUMERIC_METRICS = ["name_cer", "name_box_iou"] as const;
export type NumericMetric = (typeof NUMERIC_METRICS)[number];

export interface Tags {
  sample: string;
  entry_type: string;
  century: string;
  script: string;
  language: string;
}

export interface Observation {
  metric: Metric | NumericMetric | "extra_entry" | "extra_person";
  /** For count metrics. */
  correct?: boolean;
  /** For numeric metrics. */
  value?: number;
  tags: Tags;
  detail?: string;
}

const NAME_MATCH = 0.75;
const BOX_IOU = 0.4;

const ROLE_EQUIV: Partial<Record<Role, Role[]>> = {
  godparent: ["godfather", "godmother"],
  godfather: ["godparent"],
  godmother: ["godparent"],
  registrar: ["officiant"],
  officiant: ["registrar"],
  declarant: ["informant"],
  informant: ["declarant"],
  spouse: ["former_spouse"],
  former_spouse: ["spouse"],
};

function roleMatches(expected: Role, predicted: Role[]): boolean {
  return predicted.includes(expected) || (ROLE_EQUIV[expected] ?? []).some((r) => predicted.includes(r));
}

function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const x = fold(a);
  const y = fold(b);
  return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)));
}

function sameAge(expected: string, predicted: string | null | undefined): boolean {
  if (!predicted) return false;
  const e = Number.parseFloat(expected);
  const p = Number.parseFloat(predicted);
  return Number.isFinite(e) && Number.isFinite(p) ? e === p : sameValue(expected, predicted);
}

function personName(p: Person): string {
  return p.name.value ?? p.name.as_written ?? "";
}

function bestName(p: Person, expected: string): number {
  return Math.max(
    ...[p.name.value, p.name.as_written].filter((s): s is string => !!s).map((s) => nameSimilarity(s, expected)),
    0,
  );
}

/** Greedy one-to-one matching by descending score. */
function greedy<A, B>(as: A[], bs: B[], score: (a: A, b: B) => number, min: number): Map<number, number> {
  const pairs: Array<[number, number, number]> = [];
  as.forEach((a, i) => bs.forEach((b, j) => pairs.push([score(a, b), i, j])));
  pairs.sort((x, y) => y[0] - x[0]);
  const out = new Map<number, number>();
  const usedB = new Set<number>();
  for (const [s, i, j] of pairs) {
    if (s < min || out.has(i) || usedB.has(j)) continue;
    out.set(i, j);
    usedB.add(j);
  }
  return out;
}

function personScore(e: ExpectedPerson, p: Person): number {
  const n = bestName(p, e.name);
  if (n < NAME_MATCH) return 0;
  return n + (e.roles.some((r) => roleMatches(r, p.roles)) ? 0.5 : 0);
}

function entryScore(e: ExpectedEntry, p: Entry): number {
  let s = 0;
  if (e.type === p.type) s += 1;
  if (e.date && p.date.value === e.date) s += 1;
  if (e.people.length) {
    const m = greedy(e.people, p.people, personScore, NAME_MATCH);
    s += (2 * m.size) / e.people.length;
  }
  return s;
}

function flagged(box: NormBox, result: ReadResult): boolean {
  const overlaps = (b: NormBox | null) => !!b && (iou(b, box) > 0.05 || contains(b, box) || contains(box, b));
  if (result.illegible_regions.some((r) => overlaps(r.box))) return true;
  const fields = result.entries.flatMap((e) => [
    e.date,
    e.place,
    ...e.people.flatMap((p) => [p.name, p.age, p.occupation, p.residence, p.origin]),
  ]);
  if (fields.some((f) => f && (f.legibility === "illegible" || f.legibility === "partly_illegible") && overlaps(f.box))) return true;
  return result.transcription.some((l) => l.has_illegible && !!l.box && contains(l.box, box, 0.01));
}

function contains(outer: NormBox, inner: NormBox, slack = 0): boolean {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return (
    outer.page === inner.page &&
    cx >= outer.x - slack &&
    cx <= outer.x + outer.w + slack &&
    cy >= outer.y - slack &&
    cy <= outer.y + outer.h + slack
  );
}

export function scoreSample(expected: ExpectedSampleParsed, result: ReadResult): Observation[] {
  const obs: Observation[] = [];
  const base = {
    sample: expected.id,
    century: expected.meta.century == null ? "unknown" : `${expected.meta.century}th c.`,
    script: expected.meta.script,
    language: expected.meta.language ?? "none",
  };
  const sampleTags: Tags = { ...base, entry_type: expected.meta.record_types.join("+") || "none" };
  const add = (metric: Observation["metric"], correct: boolean, tags: Tags, detail?: string) =>
    obs.push({ metric, correct, tags, ...(detail ? { detail } : {}) });

  const isRecord = result.status !== "not_a_record";
  add("record_detected", isRecord === expected.expect_record, sampleTags, `expected ${expected.expect_record ? "record" : "not a record"}, got ${result.status}`);
  if (!expected.expect_record) return obs;

  const entryMap = greedy(expected.entries, result.entries, entryScore, 1);
  const matchedPred = new Set(entryMap.values());

  expected.entries.forEach((ee, ei) => {
    const tags: Tags = { ...base, entry_type: ee.type };
    const pi = entryMap.get(ei);
    const pe = pi === undefined ? null : result.entries[pi];
    const label = `${expected.id} entry ${ei + 1} (${ee.type})`;
    add("entry_found", !!pe, tags, label);
    add("entry_type", pe?.type === ee.type, tags, `${label}: got ${pe?.type ?? "nothing"}`);
    if (ee.date) add("date", pe?.date.value === ee.date, tags, `${label} date: expected ${ee.date}, got ${pe?.date.value ?? "nothing"}`);
    for (const od of ee.other_dates ?? []) {
      const got = pe?.other_dates.find((d) => d.kind === od.kind)?.field.value ?? null;
      add("date", got === od.date, tags, `${label} ${od.kind} date: expected ${od.date}, got ${got ?? "nothing"}`);
    }
    if (ee.place) add("place", sameValue(ee.place, pe?.place?.value) || sameValue(ee.place, pe?.place?.as_written), tags, `${label} place: got ${pe?.place?.value ?? "nothing"}`);

    const people = pe?.people ?? [];
    const pm = greedy(ee.people, people, personScore, NAME_MATCH);
    ee.people.forEach((ep, k) => {
      const pp = pm.has(k) ? people[pm.get(k)!] : null;
      const who = `${label} ${ep.roles.join("/")} "${ep.name}"`;
      add("person_found", !!pp, tags, who);
      const got = pp ? personName(pp) : "";
      add("name", !!pp && foldName(got) === foldName(ep.name), tags, `${who}: got "${got}"`);
      obs.push({ metric: "name_cer", value: pp ? nameCer(ep.name, got) : 1, tags });
      add("role", !!pp && ep.roles.every((r) => roleMatches(r, pp.roles)), tags, `${who}: got ${pp?.roles.join("/") ?? "nothing"}`);
      if (ep.sex) add("sex", pp?.sex === ep.sex, tags, `${who}: sex ${pp?.sex ?? "nothing"}`);
      if (ep.age) add("age", sameAge(ep.age, pp?.age?.value), tags, `${who}: age ${pp?.age?.value ?? "nothing"}`);
      if (ep.occupation) add("occupation", sameValue(ep.occupation, pp?.occupation?.value) || sameValue(ep.occupation, pp?.occupation?.as_written), tags, `${who}: occupation ${pp?.occupation?.value ?? "nothing"}`);
      if (ep.marital_status) add("marital_status", sameValue(ep.marital_status, pp?.marital_status?.as_written) || sameValue(ep.marital_status, pp?.marital_status?.value), tags, `${who}: marital status ${pp?.marital_status?.as_written ?? "nothing"}`);
      if (ep.box) {
        const v = pp?.name.box ? iou(pp.name.box, ep.box) : 0;
        obs.push({ metric: "name_box_iou", value: v, tags });
        add("name_box", v >= BOX_IOU, tags, `${who}: box IoU ${v.toFixed(2)}`);
      }
      if (ep.legibility === "partly_illegible" || ep.legibility === "illegible") {
        const ok = !!pp && (pp.name.legibility === "partly_illegible" || pp.name.legibility === "illegible");
        add("illegible_flagged", ok, tags, `${who}: name legibility ${pp?.name.legibility ?? "nothing"}`);
      }
    });
    people.forEach((p, j) => {
      if (![...pm.values()].includes(j)) obs.push({ metric: "extra_person", tags, detail: `${label}: unexpected person "${personName(p)}" (${p.roles.join("/")})` });
    });
  });

  result.entries.forEach((e, j) => {
    if (!matchedPred.has(j)) obs.push({ metric: "extra_entry", tags: { ...base, entry_type: e.type }, detail: `${expected.id}: unexpected entry ${e.id} (${e.type})` });
  });

  for (const region of expected.illegible) {
    add("illegible_flagged", flagged(region.box, result), sampleTags, `${expected.id}: illegible region ${region.note ?? ""}`.trim());
  }
  return obs;
}

// ------------------------------------------------------------ aggregation

export interface MetricSummary {
  correct: number;
  total: number;
  accuracy: number | null;
}

export interface GroupSummary {
  counts: Partial<Record<Metric, MetricSummary>>;
  means: Partial<Record<NumericMetric, number>>;
  extra_entries: number;
  extra_people: number;
}

export type GroupBy = "all" | keyof Omit<Tags, "sample"> | "sample";

export function summarise(obs: Observation[], by: GroupBy): Record<string, GroupSummary> {
  const groups: Record<string, Observation[]> = {};
  for (const o of obs) {
    const key = by === "all" ? "all" : o.tags[by];
    (groups[key] ??= []).push(o);
  }
  const out: Record<string, GroupSummary> = {};
  for (const [key, list] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
    const counts: GroupSummary["counts"] = {};
    for (const m of METRICS) {
      const xs = list.filter((o) => o.metric === m);
      if (!xs.length) continue;
      const correct = xs.filter((o) => o.correct).length;
      counts[m] = { correct, total: xs.length, accuracy: Math.round((correct / xs.length) * 1000) / 1000 };
    }
    const means: GroupSummary["means"] = {};
    for (const m of NUMERIC_METRICS) {
      const xs = list.filter((o) => o.metric === m && typeof o.value === "number");
      if (xs.length) means[m] = Math.round((xs.reduce((s, o) => s + o.value!, 0) / xs.length) * 1000) / 1000;
    }
    out[key] = {
      counts,
      means,
      extra_entries: list.filter((o) => o.metric === "extra_entry").length,
      extra_people: list.filter((o) => o.metric === "extra_person").length,
    };
  }
  return out;
}

export function formatReport(obs: Observation[]): string {
  const lines: string[] = [];
  const cols: Metric[] = ["entry_found", "entry_type", "date", "place", "person_found", "name", "role", "age", "name_box", "illegible_flagged"];
  const short: Record<string, string> = {
    entry_found: "entries",
    entry_type: "type",
    date: "dates",
    place: "places",
    person_found: "people",
    name: "names",
    role: "roles",
    age: "ages",
    name_box: "boxes",
    illegible_flagged: "illeg.",
  };
  for (const by of ["all", "entry_type", "century", "script", "sample"] as GroupBy[]) {
    const s = summarise(obs, by);
    lines.push(`\nBy ${by === "all" ? "overall" : by.replace("_", " ")}:`);
    lines.push(["group".padEnd(26), ...cols.map((c) => short[c].padStart(8)), "  CER".padStart(7), " extra".padStart(7)].join(""));
    for (const [key, g] of Object.entries(s)) {
      const cells = cols.map((c) => {
        const m = g.counts[c];
        return (m ? `${Math.round((m.accuracy ?? 0) * 100)}%` : "–").padStart(8);
      });
      const cerCell = g.means.name_cer === undefined ? "–" : g.means.name_cer.toFixed(2);
      lines.push([key.slice(0, 25).padEnd(26), ...cells, cerCell.padStart(7), `${g.extra_entries}/${g.extra_people}`.padStart(7)].join(""));
    }
  }
  const det = obs.filter((o) => o.metric === "record_detected");
  lines.push(`\nRecord / non-record detection: ${det.filter((o) => o.correct).length}/${det.length}`);
  lines.push("(extra = unexpected entries/people; CER = mean character error rate of names after folding old spellings, lower is better)");
  return lines.join("\n");
}

export function failures(obs: Observation[]): string[] {
  return obs
    .filter((o) => (o.correct === false || o.metric === "extra_entry" || o.metric === "extra_person") && o.detail)
    .map((o) => `${o.metric}: ${o.detail}`);
}
