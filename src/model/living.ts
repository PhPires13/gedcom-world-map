// The living rule: who is presumed alive, and so private by default (LGPD / GDPR).
// Pure functions shared by the server and the browser.

import type { LifeEvent, Person, PrivacyOverride } from './types';

/** People born less than this many years ago, with no death record, are presumed living. */
export const LIVING_YEARS = 100;

/** The facts the rule looks at. A model `Person` and a parsed GEDCOM person both fit. */
export interface LivingFacts {
  birth?: LifeEvent;
  baptism?: LifeEvent;
  death?: LifeEvent;
  burial?: LifeEvent;
}

/** Birth years of close relatives, used when the person's own birth year is unknown. */
export interface RelativeYears {
  parents?: (number | undefined)[];
  children?: (number | undefined)[];
  spouses?: (number | undefined)[];
}

const known = (ys: (number | undefined)[] | undefined) => (ys ?? []).filter((y): y is number => y !== undefined);

/**
 * The latest year the person could plausibly have been born, judging from relatives.
 * Leans young on purpose (so the guess errs towards "living"): a parent was at least 15 at a
 * child's birth, a child was born at most 50 years after a parent, a spouse at most 20 years apart.
 */
export function latestPlausibleBirthYear(rel: RelativeYears): number | undefined {
  // A child's birth is a hard upper bound; parents and spouses only a soft one, so take the
  // loosest of those.
  const fromChildren = known(rel.children).map((y) => y - 15);
  if (fromChildren.length) return Math.min(...fromChildren);
  const others = [...known(rel.parents).map((y) => y + 50), ...known(rel.spouses).map((y) => y + 20)];
  return others.length ? Math.max(...others) : undefined;
}

/**
 * Whether someone is presumed living:
 *
 * 1. Any death or burial record (even an undated one) → not living.
 * 2. Known birth (or baptism) year → living if born less than `LIVING_YEARS` ago.
 * 3. Otherwise, estimate from relatives (`latestPlausibleBirthYear`) and apply the same test.
 * 4. Nothing to go on → presumed living. Privacy is the safe default.
 */
export function isPresumedLiving(p: LivingFacts, currentYear: number, relatives: RelativeYears = {}): boolean {
  if (p.death || p.burial) return false;
  const year = p.birth?.year ?? p.baptism?.year ?? latestPlausibleBirthYear(relatives);
  if (year === undefined) return true;
  return currentYear - year < LIVING_YEARS;
}

/** A person is private when marked so, or when presumed living and not explicitly made public. */
export function isPrivate(override: PrivacyOverride, presumedLiving: boolean): boolean {
  return override === 'private' || (override !== 'public' && presumedLiving);
}

/**
 * What anyone but the tree's owners may see of a private person: that someone is there (so the
 * tree's shape stays intact), but no name, dates, places or occupation.
 */
export function redactPerson(p: Person): Person {
  if (!p.isPrivate) return p;
  return {
    id: p.id,
    treeId: p.treeId,
    givenName: '',
    surname: '',
    name: 'Private',
    origin: p.origin,
    privacyOverride: p.privacyOverride,
    presumedLiving: p.presumedLiving,
    isPrivate: true,
    createdAt: p.createdAt,
  };
}

/** Minimal shapes `presumedLivingAll` needs, so it works on DB rows and model objects alike. */
export interface LivingPerson extends LivingFacts {
  id: string;
}
export interface LivingLink {
  kind: 'parent' | 'spouse';
  from: string;
  to: string;
}

/** Applies `isPresumedLiving` to a whole tree, using relatives' birth years where needed. */
export function presumedLivingAll(
  people: readonly LivingPerson[],
  links: readonly LivingLink[],
  currentYear: number,
): Map<string, boolean> {
  const year = new Map(people.map((p) => [p.id, p.birth?.year ?? p.baptism?.year]));
  const rel = new Map<string, Required<RelativeYears>>();
  const of = (id: string) => {
    let r = rel.get(id);
    if (!r) rel.set(id, (r = { parents: [], children: [], spouses: [] }));
    return r;
  };
  for (const l of links) {
    if (l.kind === 'parent') {
      of(l.to).parents.push(year.get(l.from));
      of(l.from).children.push(year.get(l.to));
    } else {
      of(l.from).spouses.push(year.get(l.to));
      of(l.to).spouses.push(year.get(l.from));
    }
  }
  return new Map(people.map((p) => [p.id, isPresumedLiving(p, currentYear, rel.get(p.id))]));
}
