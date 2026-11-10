/**
 * Hand-checked expectations for one evaluation sample (eval/samples/<id>/expected.json).
 * Only what a checker wrote down is scored; leave a field out (or null) to skip it.
 */
import { z } from "zod";
import { EntryType, Hints, Legibility, NormBox, OtherDateKind, Role, Sex } from "../schema.js";

export const ExpectedPerson = z.object({
  roles: z.array(Role).min(1),
  /** Name as a checker would write it (normalised spelling is fine; accents/case/old spellings are folded). */
  name: z.string(),
  sex: Sex.optional(),
  age: z.string().nullable().optional(),
  occupation: z.string().nullable().optional(),
  marital_status: z.string().nullable().optional(),
  /** Where the name is written, normalised 0..1 (optional; enables box scoring). */
  box: NormBox.nullable().optional(),
  /** Set when the name is (partly) unreadable on the page: the reader should flag it. */
  legibility: Legibility.optional(),
});
export type ExpectedPerson = z.infer<typeof ExpectedPerson>;

export const ExpectedEntry = z.object({
  type: EntryType,
  date: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  other_dates: z.array(z.object({ kind: OtherDateKind, date: z.string() })).optional(),
  people: z.array(ExpectedPerson),
});
export type ExpectedEntry = z.infer<typeof ExpectedEntry>;

export const ExpectedSample = z.object({
  id: z.string(),
  meta: z.object({
    /** "synthetic", or the archive reference (e.g. "ADP, Paróquia de Rates, Baptismos 1840-1850, fl. 23"). */
    origin: z.string(),
    description: z.string().optional(),
    record_types: z.array(EntryType),
    century: z.number().int().nullable(),
    year: z.number().int().nullable().optional(),
    language: z.string().nullable(),
    script: z.string(),
    jurisdiction: z.string().nullable().optional(),
  }),
  hints: Hints.optional(),
  /** Page files in reading order (default: all images/PDFs in the folder, sorted). */
  files: z.array(z.string()).optional(),
  expect_record: z.boolean().default(true),
  entries: z.array(ExpectedEntry),
  /** Regions the reader should flag as illegible. */
  illegible: z.array(z.object({ box: NormBox, note: z.string().optional() })).default([]),
});
export type ExpectedSample = z.input<typeof ExpectedSample>;
export type ExpectedSampleParsed = z.output<typeof ExpectedSample>;
