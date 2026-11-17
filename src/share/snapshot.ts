// The public snapshot of a family's map, shared by link (share.html?id=…).
//
// Built in the browser from the loaded tree, checked again by the server (`validateSnapshot`), and
// read back by the public viewer. Pure, so it runs the same in the browser, the server and tests.
//
// Privacy: a share is public, so it is stricter than the tree's own "public view" (`redactPerson`,
// which keeps private people as anonymous "Private" nodes). Here private people are not anonymised
// but removed entirely, and only what the map draws is kept:
//
//   - Who: people born at least LIVING_YEARS (100) years ago, by their own birth / baptism year or,
//     when unknown, as estimated from close relatives (`presumedLivingAll`, the same living rule
//     as everywhere else). A death record does NOT make someone publishable here: recently deceased
//     people stay out too. People the owner marked private are always left out.
//   - Only people with a birthplace on the map (the snapshot is a map, not a tree).
//   - What: a fresh id (never the GEDCOM xref), name, sex, birth year, birthplace and its
//     coordinates, generation, and links to parents who are themselves published. No full dates,
//     deaths, burials, occupations, spouses, notes or sources.

import type { Tree } from '../gedcom';
import { LIVING_YEARS, presumedLivingAll, type LivingLink } from '../model/living';

export const SHARE_VERSION = 1;
/** Most people in one snapshot. */
export const MAX_SHARE_PEOPLE = 20_000;
/** Largest snapshot body the server accepts, in bytes (JSON). */
export const MAX_SHARE_BYTES = 2_000_000;
export const MAX_FAMILY_LENGTH = 80;
const MAX_NAME = 200;
const MAX_PLACE = 300;
const MAX_GEN = 500;
const MAX_PARENTS = 4;

export interface SharePerson {
  id: string;
  name: string;
  sex?: 'M' | 'F';
  birthYear?: number;
  place: string;
  lat: number;
  lon: number;
  /** 0 = the most recent generation in the snapshot (computed on the whole tree, then shifted so the youngest published one is 0). */
  gen: number;
  /** Parents who are also in the snapshot. */
  parents: string[];
}

export interface ShareSnapshot {
  version: typeof SHARE_VERSION;
  /** The family's name as the owner wants it shown: "Silva" → "Família Silva". */
  family: string;
  people: SharePerson[];
}

/** Counts shown on the page and in the link preview. */
export interface ShareSummary {
  people: number;
  places: number;
  generations: number;
  fromYear?: number;
  toYear?: number;
}

/** A share as its owner sees it in their list (GET /api/shares, POST /api/shares). */
export interface ShareInfo {
  id: string;
  family: string;
  peopleCount: number;
  createdAt: string;
  /** The link to send: the preview page (Open Graph tags) on the API server, which redirects to share.html. */
  path: string;
}

/** A share as anyone with the link gets it (GET /api/shares/:id). */
export interface SharedMap extends ShareInfo {
  snapshot: ShareSnapshot;
  summary: ShareSummary;
}

/** A place on the map, as the map app keeps them (coordinates from the file or geocoded). */
export interface SnapshotPlace {
  lat: number;
  lon: number;
  place: string;
}

export interface SnapshotInput {
  tree: Tree;
  located: ReadonlyMap<string, SnapshotPlace>;
  gens: ReadonlyMap<string, number>;
  family: string;
  currentYear: number;
  /** People the owner marked private (privacy overrides): always left out. */
  privateIds?: ReadonlySet<string>;
}

export interface SnapshotResult {
  snapshot: ShareSnapshot;
  /** People left out because they are, or may be, living (or born less than 100 years ago, or marked private). */
  withheld: number;
  /** Publishable people left out because they have no birthplace on the map. */
  unplaced: number;
}

/**
 * Who may appear on a public map: born at least LIVING_YEARS ago, by the shared living rule
 * applied to births, baptisms and relatives only (death records are ignored on purpose, see above).
 */
export function publishableIds(tree: Tree, currentYear: number, privateIds: ReadonlySet<string> = new Set()): Set<string> {
  const people = [...tree.people.values()].map((p) => ({ id: p.id, birth: p.birth, baptism: p.baptism }));
  const links: LivingLink[] = [];
  for (const p of tree.people.values()) {
    for (const parent of p.parents) links.push({ kind: 'parent', from: parent, to: p.id });
    for (const s of p.spouses) if (p.id < s) links.push({ kind: 'spouse', from: p.id, to: s });
  }
  const living = presumedLivingAll(people, links, currentYear);
  return new Set(people.filter((p) => living.get(p.id) === false && !privateIds.has(p.id)).map((p) => p.id));
}

/** The most common surname among `ids`, for the default title ("Família Silva"). */
export function defaultFamilyName(tree: Tree, ids: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const s = tree.people.get(id)?.surname.trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Builds the public snapshot from the map app's tree (see the rules at the top of this file). */
export function buildSnapshot({ tree, located, gens, family, currentYear, privateIds }: SnapshotInput): SnapshotResult {
  const allowed = publishableIds(tree, currentYear, privateIds);
  const placed = [...tree.people.values()].filter((p) => allowed.has(p.id) && located.has(p.id));
  // Fresh ids, so nothing of the file (its xrefs) leaks.
  const idOf = new Map(placed.map((p, i) => [p.id, `p${i + 1}`]));
  // Generations are counted from the youngest one published (the withheld recent ones don't show).
  const youngest = Math.min(...placed.map((p) => gens.get(p.id) ?? 0));
  const people: SharePerson[] = placed.map((p) => {
    const loc = located.get(p.id)!;
    const year = p.birth?.year ?? p.baptism?.year;
    const out: SharePerson = {
      id: idOf.get(p.id)!,
      name: p.name.slice(0, MAX_NAME),
      place: loc.place.slice(0, MAX_PLACE),
      lat: round(loc.lat),
      lon: round(loc.lon),
      gen: (gens.get(p.id) ?? 0) - youngest,
      parents: p.parents.filter((x) => idOf.has(x)).map((x) => idOf.get(x)!).slice(0, MAX_PARENTS),
    };
    if (p.sex === 'M' || p.sex === 'F') out.sex = p.sex;
    if (year !== undefined) out.birthYear = year;
    return out;
  });
  return {
    snapshot: { version: SHARE_VERSION, family: family.trim().slice(0, MAX_FAMILY_LENGTH), people },
    withheld: tree.people.size - allowed.size,
    unplaced: allowed.size - placed.length,
  };
}

export function summarize(s: Pick<ShareSnapshot, 'people'>): ShareSummary {
  const years = s.people.map((p) => p.birthYear).filter((y): y is number => y !== undefined);
  return {
    people: s.people.length,
    places: new Set(s.people.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`)).size,
    generations: new Set(s.people.map((p) => p.gen)).size,
    fromYear: years.length ? Math.min(...years) : undefined,
    toYear: years.length ? Math.max(...years) : undefined,
  };
}

// ---------- Checking a snapshot (server side, and before sending) ----------

export class SnapshotError extends Error {}

const ALLOWED_KEYS = new Set(['id', 'name', 'sex', 'birthYear', 'place', 'lat', 'lon', 'gen', 'parents']);
/** Flags a client might send for someone private: a snapshot carrying any of them is refused. */
const LIVING_FLAGS = ['living', 'presumedLiving', 'isPrivate', 'private'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, field: string, max: number, required: boolean): string {
  if (typeof v !== 'string') throw new SnapshotError(`${field} must be text`);
  const s = v.trim();
  if (required && !s) throw new SnapshotError(`${field} is required`);
  if (s.length > max) throw new SnapshotError(`${field} is too long (max ${max} characters)`);
  return s;
}

function num(v: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new SnapshotError(`${field} must be a ${integer ? 'whole ' : ''}number between ${min} and ${max}`);
  }
  return v;
}

/**
 * Checks a snapshot sent by a browser and returns a clean copy with only the allowed fields.
 * Refuses anyone flagged living or private, anyone born less than LIVING_YEARS before
 * `currentYear`, unknown fields (so no private detail can ride along), and anything malformed.
 */
export function validateSnapshot(v: unknown, currentYear: number): ShareSnapshot {
  if (!isObj(v)) throw new SnapshotError('The snapshot must be an object');
  if (v.version !== SHARE_VERSION) throw new SnapshotError(`version must be ${SHARE_VERSION}`);
  const family = text(v.family, 'family', MAX_FAMILY_LENGTH, true);
  if (!Array.isArray(v.people) || v.people.length === 0) throw new SnapshotError('people must be a non-empty list');
  if (v.people.length > MAX_SHARE_PEOPLE) throw new SnapshotError(`Too many people (max ${MAX_SHARE_PEOPLE})`);
  const latestBirth = currentYear - LIVING_YEARS;

  const ids = new Set<string>();
  for (const [i, p] of v.people.entries()) {
    if (!isObj(p)) throw new SnapshotError(`people[${i}] must be an object`);
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) throw new SnapshotError(`people[${i}].id is not a valid id`);
    if (ids.has(p.id)) throw new SnapshotError(`people[${i}].id is repeated`);
    ids.add(p.id);
  }

  const people = v.people.map((raw, i): SharePerson => {
    const p = raw as Record<string, unknown>;
    const at = `people[${i}]`;
    for (const flag of LIVING_FLAGS) {
      if (flag in p && p[flag] !== false) throw new SnapshotError(`${at} is marked living or private: living people are never shared`);
    }
    for (const key of Object.keys(p)) {
      if (!ALLOWED_KEYS.has(key) && !LIVING_FLAGS.includes(key)) throw new SnapshotError(`${at}.${key} is not allowed in a shared map`);
    }
    const out: SharePerson = {
      id: p.id as string,
      name: text(p.name, `${at}.name`, MAX_NAME, true),
      place: text(p.place, `${at}.place`, MAX_PLACE, false),
      lat: num(p.lat, `${at}.lat`, -90, 90),
      lon: num(p.lon, `${at}.lon`, -180, 180),
      gen: num(p.gen, `${at}.gen`, 0, MAX_GEN, true),
      parents: [],
    };
    if (p.sex !== undefined) {
      if (p.sex !== 'M' && p.sex !== 'F') throw new SnapshotError(`${at}.sex must be M or F`);
      out.sex = p.sex;
    }
    if (p.birthYear !== undefined) {
      const year = num(p.birthYear, `${at}.birthYear`, -10_000, currentYear, true);
      if (year > latestBirth) {
        throw new SnapshotError(`${at} was born less than ${LIVING_YEARS} years ago (${year}): they may be living and cannot be shared`);
      }
      out.birthYear = year;
    }
    if (p.parents !== undefined) {
      if (!Array.isArray(p.parents) || p.parents.length > MAX_PARENTS) throw new SnapshotError(`${at}.parents must be a list of at most ${MAX_PARENTS} ids`);
      for (const parent of p.parents) {
        if (typeof parent !== 'string' || !ids.has(parent) || parent === out.id) throw new SnapshotError(`${at}.parents must name other people in the snapshot`);
        if (!out.parents.includes(parent)) out.parents.push(parent);
      }
    }
    return out;
  });

  for (const key of Object.keys(v)) {
    if (!['version', 'family', 'people'].includes(key)) throw new SnapshotError(`${key} is not allowed in a shared map`);
  }
  return { version: SHARE_VERSION, family, people };
}
