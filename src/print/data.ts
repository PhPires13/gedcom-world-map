// From a parsed family tree to what the print draws: who's on it (by branch and generation) and
// the moves between their birthplaces.

import { computeFlows } from '../flows';
import { lineage } from '../generations';
import type { Tree } from '../gedcom';
import type { PrintData, PrintPerson } from './types';

export type Branch = 'all' | 'ancestors' | 'paternal' | 'maternal';

export interface Selection {
  /** The person the branches are counted from (usually the youngest generation). */
  rootId?: string;
  branch: Branch;
  /** Generations to include (0 = most recent); undefined = all. */
  generations?: number[];
}

export interface Located {
  lat: number;
  lon: number;
  place: string;
}

/**
 * The person to count branches from by default: someone in the most recent generation with the
 * most known ancestors (ties go to the earliest born, so it's stable).
 */
export function defaultRoot(tree: Tree, gens: Map<string, number>): string | undefined {
  let best: { id: string; n: number; year: number } | undefined;
  for (const p of tree.people.values()) {
    if ((gens.get(p.id) ?? 0) !== 0) continue;
    const n = lineage(tree, p.id, 'parents').size;
    const year = p.birth?.year ?? Infinity;
    if (!best || n > best.n || (n === best.n && year < best.year)) best = { id: p.id, n, year };
  }
  return best?.id;
}

/** Ids of the people in a branch. */
export function branchMembers(tree: Tree, sel: Selection): Set<string> {
  if (sel.branch === 'all' || !sel.rootId || !tree.people.has(sel.rootId)) return new Set(tree.people.keys());
  const root = tree.people.get(sel.rootId)!;
  if (sel.branch === 'ancestors') return new Set([root.id, ...lineage(tree, root.id, 'parents')]);
  // Paternal: the father and his ancestors; maternal: the mother and hers. Falls back on parent order.
  const parents = root.parents.map((id) => tree.people.get(id)!).filter(Boolean);
  const want = sel.branch === 'paternal' ? 'M' : 'F';
  const parent = parents.find((p) => p.sex === want) ?? parents[sel.branch === 'paternal' ? 0 : 1];
  if (!parent) return new Set([root.id]);
  return new Set([root.id, parent.id, ...lineage(tree, parent.id, 'parents')]);
}

export function buildPrintData(tree: Tree, located: Map<string, Located>, gens: Map<string, number>, sel: Selection): PrintData {
  const members = branchMembers(tree, sel);
  const genSet = sel.generations ? new Set(sel.generations) : null;
  const shownGen = (g: number) => !genSet || genSet.has(g);

  const people: PrintPerson[] = [];
  for (const id of members) {
    const p = tree.people.get(id)!;
    const loc = located.get(id);
    const gen = gens.get(id) ?? 0;
    if (!loc || !shownGen(gen)) continue;
    people.push({ id, name: p.name, surname: p.surname, sex: p.sex, birthYear: (p.birth ?? p.baptism)?.year, gen, lat: loc.lat, lon: loc.lon, place: loc.place });
  }

  // Moves within the branch: both the parent who moved and the child born after it must be in it.
  const branchPeople = new Map<string, { parents: string[] }>();
  for (const id of members) branchPeople.set(id, { parents: tree.people.get(id)!.parents.filter((x) => members.has(x)) });
  const branchLocated = new Map([...located].filter(([id]) => members.has(id)));
  // A move shows when the generation of the parent who moved is shown.
  const flows = computeFlows(branchPeople, branchLocated, gens, (moverGen) => shownGen(moverGen));
  return { people, flows };
}
