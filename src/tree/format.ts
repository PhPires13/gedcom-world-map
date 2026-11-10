import { CONFIDENCE_LABELS, type ConfidenceLevel, type Person, type Relationship, type Source } from '../model';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function lifespan(p: Pick<Person, 'birth' | 'baptism' | 'death' | 'burial'>): string {
  const b = p.birth?.year ?? (p.baptism?.year !== undefined ? `bap. ${p.baptism.year}` : undefined);
  const d = p.death?.year ?? p.burial?.year;
  if (b === undefined && d === undefined) return '';
  return `${b ?? '?'}–${d ?? ''}`;
}

export const badge = (level: ConfidenceLevel) => `<span class="conf-badge conf-${level}">${CONFIDENCE_LABELS[level]}</span>`;

/** "Father", "Mother", "Son", "Spouse"… as seen from `personId`. */
export function roleOf(r: Relationship, personId: string, people: Map<string, Person>): string {
  if (r.kind === 'spouse') return 'Spouse';
  if (r.to === personId) {
    const sex = people.get(r.from)?.sex;
    return sex === 'M' ? 'Father' : sex === 'F' ? 'Mother' : 'Parent';
  }
  const sex = people.get(r.to)?.sex;
  return sex === 'M' ? 'Son' : sex === 'F' ? 'Daughter' : 'Child';
}

export function citationLine(s: Source): string {
  const c = s.citation;
  return [
    c.archive,
    c.collection,
    c.book && `book ${c.book}`,
    c.folio && `folio ${c.folio}`,
    c.entry && `entry ${c.entry}`,
    s.recordDate,
    s.language && s.language.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');
}

export const percent = (x: number) => `${Math.round(x * 100)}%`;
