import { formatDate, formatNumber } from '../i18n/core';
import type { ConfidenceLevel, Person, Relationship, Source } from '../model';
import { levelLabel, t } from './i18n';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A person's name as shown; someone redacted for privacy (named "Private" by the model) gets the local word. */
export const nameOf = (p: Pick<Person, 'name' | 'givenName' | 'surname' | 'isPrivate'>) =>
  p.isPrivate && !p.givenName && !p.surname && p.name === 'Private' ? t('person.private') : p.name;

/** Given name for sentences such as "Add a document about Miguel". */
export const shortNameOf = (p: Pick<Person, 'name' | 'givenName' | 'surname' | 'isPrivate'>) => p.givenName || nameOf(p);

export function lifespan(p: Pick<Person, 'birth' | 'baptism' | 'death' | 'burial'>): string {
  const b = p.birth?.year ?? (p.baptism?.year !== undefined ? t('lifespan.baptism', { year: p.baptism.year }) : undefined);
  const d = p.death?.year ?? p.burial?.year;
  if (b === undefined && d === undefined) return '';
  return `${b ?? '?'}–${d ?? ''}`;
}

export const badge = (level: ConfidenceLevel) => `<span class="conf-badge conf-${level}">${esc(levelLabel(level))}</span>`;

/** "Father", "Mother", "Son", "Spouse"… as seen from `personId`. */
export function roleOf(r: Relationship, personId: string, people: Map<string, Person>): string {
  if (r.kind === 'spouse') return t('role.spouse');
  if (r.to === personId) {
    const sex = people.get(r.from)?.sex;
    return t(sex === 'M' ? 'role.father' : sex === 'F' ? 'role.mother' : 'role.parent');
  }
  const sex = people.get(r.to)?.sex;
  return t(sex === 'M' ? 'role.son' : sex === 'F' ? 'role.daughter' : 'role.child');
}

export function citationLine(s: Source): string {
  const c = s.citation;
  return [
    c.archive,
    c.collection,
    c.book && t('cite.book', { v: c.book }),
    c.folio && t('cite.folio', { v: c.folio }),
    c.entry && t('cite.entry', { v: c.entry }),
    s.recordDate && gedcomDate(s.recordDate),
    s.language && s.language.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');
}

export const percent = (x: number) => formatNumber(x, { style: 'percent', maximumFractionDigits: 0 });

// ---------- GEDCOM dates ----------

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const QUALIFIERS = {
  ABT: 'date.about', CAL: 'date.about', EST: 'date.about', BEF: 'date.before', AFT: 'date.after', FROM: 'date.from', TO: 'date.to',
} as const;

/** "3 JAN 1898", "JAN 1898" or "1898" in the visitor's conventions; null for anything else. */
function simpleDate(s: string): string | null {
  const m = /^(?:(\d{1,2}) )?(?:([A-Z]{3}) )?(\d{3,4})$/.exec(s);
  if (!m || (m[1] && !m[2])) return null;
  const month = m[2] ? MONTHS[m[2]] : undefined;
  if (m[2] && month === undefined) return null;
  const day = m[1] ? Number(m[1]) : undefined;
  const date = new Date(Date.UTC(2000, month ?? 0, day ?? 1));
  date.setUTCFullYear(Number(m[3]));
  if (day !== undefined && date.getUTCDate() !== day) return null;
  const opts: Intl.DateTimeFormatOptions =
    day !== undefined ? { day: 'numeric', month: 'short', year: 'numeric' } : month !== undefined ? { month: 'short', year: 'numeric' } : { year: 'numeric' };
  return formatDate(date, { ...opts, timeZone: 'UTC' });
}

/**
 * A GEDCOM date ("3 JAN 1898", "ABT 1850", "BET 1850 AND 1860"…) in the visitor's language and
 * conventions. Anything it does not recognise (free text, other calendars) is shown as written.
 */
export function gedcomDate(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  let m = /^(BET|FROM) (.+) (AND|TO) (.+)$/.exec(s);
  if (m && (m[1] === 'BET') === (m[3] === 'AND')) {
    const a = simpleDate(m[2]);
    const b = simpleDate(m[4]);
    if (a && b) return t(m[1] === 'BET' ? 'date.between' : 'date.fromTo', { a, b });
  }
  m = /^(ABT|CAL|EST|BEF|AFT|FROM|TO) (.+)$/.exec(s);
  if (m) {
    const date = simpleDate(m[2]);
    if (date) return t(QUALIFIERS[m[1] as keyof typeof QUALIFIERS], { date });
  }
  return simpleDate(s) ?? raw;
}
