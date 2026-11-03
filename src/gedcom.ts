// Minimal, forgiving GEDCOM (5.5 / 5.5.1 / 7) parser that extracts what the map needs.

export interface GedNode {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: GedNode[];
}

export interface LifeEvent {
  date?: string;
  year?: number;
  place?: string;
  /** Coordinates given in the file itself (PLAC > MAP > LATI/LONG). */
  lat?: number;
  lon?: number;
}

export interface Person {
  id: string;
  name: string;
  givenName: string;
  surname: string;
  sex?: 'M' | 'F' | 'U';
  birth?: LifeEvent;
  /** Baptism / christening, used as a fallback location when birth has no place. */
  baptism?: LifeEvent;
  death?: LifeEvent;
  burial?: LifeEvent;
  occupation?: string;
  parents: string[];
  children: string[];
  spouses: string[];
}

export interface Family {
  id: string;
  husband?: string;
  wife?: string;
  children: string[];
  marriage?: LifeEvent;
}

export interface Tree {
  people: Map<string, Person>;
  families: Map<string, Family>;
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

/** Decode raw bytes: UTF-8 (with/without BOM), UTF-16, falling back to Windows-1252. */
export function decodeGedcom(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseLines(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];

  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (!raw.trim()) continue;
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const level = Number(m[1]);
    const node: GedNode = { level, xref: m[2], tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };

    // Continuation lines are folded into their parent's value.
    if ((node.tag === 'CONC' || node.tag === 'CONT') && stack.length) {
      const parent = stack[level - 1] ?? stack[stack.length - 1];
      parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
      continue;
    }

    stack.length = level;
    if (level === 0) roots.push(node);
    else stack[level - 1]?.children.push(node);
    stack[level] = node;
  }
  return roots;
}

const child = (n: GedNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const childrenOf = (n: GedNode, tag: string) => n.children.filter((c) => c.tag === tag);

/** Parses "N12.345", "S5.2", "-5.2", "12,5" into a signed number. */
export function parseCoord(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toUpperCase();
  const m = /^([NSEW])?\s*(-?\d+(?:[.,]\d+)?)\s*([NSEW])?$/.exec(s);
  if (!m) return undefined;
  let n = Number(m[2].replace(',', '.'));
  const hemi = m[1] ?? m[3];
  if (hemi === 'S' || hemi === 'W') n = -Math.abs(n);
  return Number.isFinite(n) ? n : undefined;
}

export function extractYear(date: string | undefined): number | undefined {
  if (!date) return undefined;
  // Prefer the first 3–4 digit number (handles "ABT 1850", "BET 1850 AND 1860", "12 MAR 1901").
  const m = /(?:^|\D)(\d{3,4})(?:\D|$)/.exec(date);
  return m ? Number(m[1]) : undefined;
}

function parseEvent(n: GedNode | undefined): LifeEvent | undefined {
  if (!n) return undefined;
  const date = child(n, 'DATE')?.value.trim() || undefined;
  const plac = child(n, 'PLAC');
  const place = plac?.value.trim().replace(/\s*,\s*/g, ', ').replace(/^(,\s*)+|(,\s*)+$/g, '') || undefined;
  const map = child(plac, 'MAP');
  const lat = parseCoord(child(map, 'LATI')?.value);
  const lon = parseCoord(child(map, 'LONG')?.value);
  const ev: LifeEvent = { date, year: extractYear(date), place };
  if (lat !== undefined && lon !== undefined) {
    ev.lat = lat;
    ev.lon = lon;
  }
  return ev;
}

function parseName(indi: GedNode): { name: string; givenName: string; surname: string } {
  const nameNode = child(indi, 'NAME');
  const raw = nameNode?.value ?? '';
  const givn = child(nameNode, 'GIVN')?.value.trim();
  const surn = child(nameNode, 'SURN')?.value.trim();
  const slash = /\/([^/]*)\//.exec(raw);
  const surname = surn ?? slash?.[1].trim() ?? '';
  const givenName = givn ?? raw.replace(/\/[^/]*\//, ' ').replace(/\s+/g, ' ').trim();
  const name = [givenName, surname].filter(Boolean).join(' ') || '(unnamed)';
  return { name, givenName, surname };
}

export function parseGedcom(text: string): Tree {
  const roots = parseLines(text);
  const people = new Map<string, Person>();
  const families = new Map<string, Family>();

  for (const r of roots) {
    if (r.tag === 'INDI' && r.xref) {
      const sex = child(r, 'SEX')?.value.trim().toUpperCase();
      people.set(r.xref, {
        id: r.xref,
        ...parseName(r),
        sex: sex === 'M' || sex === 'F' ? sex : sex ? 'U' : undefined,
        birth: parseEvent(child(r, 'BIRT')),
        baptism: parseEvent(child(r, 'BAPM') ?? child(r, 'CHR')),
        death: parseEvent(child(r, 'DEAT')),
        burial: parseEvent(child(r, 'BURI')),
        occupation: child(r, 'OCCU')?.value.trim() || undefined,
        parents: [],
        children: [],
        spouses: [],
      });
    } else if (r.tag === 'FAM' && r.xref) {
      families.set(r.xref, {
        id: r.xref,
        husband: child(r, 'HUSB')?.value.trim() || undefined,
        wife: child(r, 'WIFE')?.value.trim() || undefined,
        children: childrenOf(r, 'CHIL').map((c) => c.value.trim()),
        marriage: parseEvent(child(r, 'MARR')),
      });
    }
  }

  const addUnique = (arr: string[], v: string) => {
    if (!arr.includes(v)) arr.push(v);
  };

  for (const fam of families.values()) {
    const parents = [fam.husband, fam.wife].filter((p): p is string => !!p && people.has(p));
    if (parents.length === 2) {
      addUnique(people.get(parents[0])!.spouses, parents[1]);
      addUnique(people.get(parents[1])!.spouses, parents[0]);
    }
    for (const c of fam.children) {
      const kid = people.get(c);
      if (!kid) continue;
      for (const p of parents) {
        addUnique(kid.parents, p);
        addUnique(people.get(p)!.children, c);
      }
    }
  }

  return { people, families };
}

/** The event used to place a person on the map: birth, falling back to baptism. */
export function originEvent(p: Person): { event: LifeEvent; kind: 'birth' | 'baptism' } | undefined {
  if (p.birth?.place || p.birth?.lat !== undefined) return { event: p.birth, kind: 'birth' };
  if (p.baptism?.place || p.baptism?.lat !== undefined) return { event: p.baptism, kind: 'baptism' };
  return undefined;
}
