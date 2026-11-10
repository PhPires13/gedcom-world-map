// Converting between a parsed GEDCOM (`src/gedcom.ts`) and the evidence model.

import type { Family as GedFamily, Person as GedPerson, Tree as GedTree } from '../gedcom';
import { computeConfidence, treeHealth } from './confidence';
import { isPrivate, presumedLivingAll } from './living';
import type { Person, Relationship, RelationshipKind, TreeDetail } from './types';

/** A person as read from a GEDCOM, before it gets an id in the tree. */
export interface ImportedPerson {
  /** GEDCOM xref, e.g. `@I12@`. */
  ref: string;
  givenName: string;
  surname: string;
  name: string;
  sex?: GedPerson['sex'];
  birth?: GedPerson['birth'];
  baptism?: GedPerson['baptism'];
  death?: GedPerson['death'];
  burial?: GedPerson['burial'];
  occupation?: string;
}

/** A link as read from a GEDCOM. For `parent`, `fromRef` is the parent and `toRef` the child. */
export interface ImportedLink {
  kind: RelationshipKind;
  fromRef: string;
  toRef: string;
}

/**
 * Turns a parsed GEDCOM into people and links. A GEDCOM says nothing about evidence, so every
 * person and link it contains becomes `unsupported`, with the file kept as their `authored` source.
 */
export function gedcomToDrafts(tree: GedTree): { people: ImportedPerson[]; links: ImportedLink[] } {
  const people: ImportedPerson[] = [...tree.people.values()].map((p) => ({
    ref: p.id,
    givenName: p.givenName,
    surname: p.surname,
    name: p.name,
    sex: p.sex,
    birth: p.birth,
    baptism: p.baptism,
    death: p.death,
    burial: p.burial,
    occupation: p.occupation,
  }));
  const links: ImportedLink[] = [];
  const seen = new Set<string>();
  const add = (kind: RelationshipKind, fromRef: string, toRef: string) => {
    const key = kind === 'spouse' ? `s:${[fromRef, toRef].sort().join('|')}` : `p:${fromRef}|${toRef}`;
    if (fromRef === toRef || seen.has(key)) return;
    seen.add(key);
    links.push({ kind, fromRef, toRef });
  };
  for (const p of tree.people.values()) {
    for (const parent of p.parents) add('parent', parent, p.id);
    for (const s of p.spouses) add('spouse', p.id, s);
  }
  return { people, links };
}

/**
 * A read-only `TreeDetail` built in the browser from a GEDCOM, for the tree view when no server
 * is running. Ids are the GEDCOM xrefs; every link is `unsupported`.
 */
export function localTreeDetail(tree: GedTree, name: string, currentYear: number): TreeDetail {
  const { people: drafts, links } = gedcomToDrafts(tree);
  const now = new Date().toISOString();
  const treeId = 'local';
  const living = presumedLivingAll(
    drafts.map((p) => ({ ...p, id: p.ref })),
    links.map((l) => ({ kind: l.kind, from: l.fromRef, to: l.toRef })),
    currentYear,
  );
  const people: Person[] = drafts.map((d) => {
    const presumedLiving = living.get(d.ref) ?? true;
    return {
      ...d,
      id: d.ref,
      treeId,
      origin: 'gedcom',
      originRef: d.ref,
      privacyOverride: null,
      presumedLiving,
      isPrivate: isPrivate(null, presumedLiving),
      createdAt: now,
    };
  });
  const level = computeConfidence([]).level;
  const relationships: Relationship[] = links.map((l, i) => ({
    id: `local-${i}`,
    treeId,
    kind: l.kind,
    from: l.fromRef,
    to: l.toRef,
    origin: 'gedcom',
    confidence: level,
    confidenceUpdatedAt: now,
    createdAt: now,
  }));
  return {
    tree: {
      id: treeId,
      name,
      ownerId: 'local',
      peopleCount: people.length,
      relationshipCount: relationships.length,
      createdAt: now,
      updatedAt: now,
    },
    people,
    relationships,
    health: treeHealth(relationships.map((r) => r.confidence)),
  };
}

/**
 * Turns a tree from the API back into the parsed-GEDCOM shape the map uses. Merged people are
 * left out (their surviving person stands in for them). Families are rebuilt from shared parents.
 */
export function toGedcomTree(detail: Pick<TreeDetail, 'people' | 'relationships'>): GedTree {
  const people = new Map<string, GedPerson>();
  for (const p of detail.people) {
    if (p.mergedInto) continue;
    people.set(p.id, {
      id: p.id,
      name: p.name,
      givenName: p.givenName,
      surname: p.surname,
      sex: p.sex,
      birth: p.birth,
      baptism: p.baptism,
      death: p.death,
      burial: p.burial,
      occupation: p.occupation,
      parents: [],
      children: [],
      spouses: [],
    });
  }
  const push = (arr: string[], v: string) => !arr.includes(v) && arr.push(v);
  for (const r of detail.relationships) {
    const a = people.get(r.from);
    const b = people.get(r.to);
    if (!a || !b) continue;
    if (r.kind === 'parent') {
      push(a.children, b.id);
      push(b.parents, a.id);
    } else {
      push(a.spouses, b.id);
      push(b.spouses, a.id);
    }
  }
  const families = new Map<string, GedFamily>();
  for (const p of people.values()) {
    if (!p.parents.length) continue;
    const [x, y] = p.parents.map((id) => people.get(id)!);
    const husband = [x, y].find((q) => q?.sex === 'M') ?? x;
    const wife = [x, y].find((q) => q && q !== husband);
    const id = `F:${[husband?.id, wife?.id].filter(Boolean).sort().join('+')}`;
    const fam = families.get(id) ?? { id, husband: husband?.id, wife: wife?.id, children: [] };
    fam.children.push(p.id);
    families.set(id, fam);
  }
  return { people, families };
}
