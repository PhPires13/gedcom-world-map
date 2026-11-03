import type { Tree } from './gedcom';

/**
 * Assigns each person a generation index where 0 = most recent generation.
 *
 * Walks each connected family group breadth-first: parents are one generation
 * older, children one younger, spouses the same. Each group is then shifted so
 * its youngest generation is 0. The walk starts from the most recently born
 * person in the group, which keeps results stable when a tree has pedigree
 * collapse (cousin marriages) that makes generation counts ambiguous.
 */
export function computeGenerations(tree: Tree): Map<string, number> {
  const raw = new Map<string, number>();
  const people = [...tree.people.values()];

  // Start points: most recently born first, so they win ties.
  const order = [...people].sort((a, b) => (b.birth?.year ?? -Infinity) - (a.birth?.year ?? -Infinity));

  for (const start of order) {
    if (raw.has(start.id)) continue;
    const component: string[] = [];
    raw.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      component.push(id);
      const p = tree.people.get(id)!;
      const g = raw.get(id)!;
      const visit = (other: string, gen: number) => {
        if (!raw.has(other) && tree.people.has(other)) {
          raw.set(other, gen);
          queue.push(other);
        }
      };
      p.parents.forEach((x) => visit(x, g + 1));
      p.children.forEach((x) => visit(x, g - 1));
      p.spouses.forEach((x) => visit(x, g));
    }
    const min = Math.min(...component.map((id) => raw.get(id)!));
    for (const id of component) raw.set(id, raw.get(id)! - min);
  }
  return raw;
}

/** Recursively collect ancestors or descendants of a person (excluding the person). */
export function lineage(tree: Tree, id: string, dir: 'parents' | 'children'): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = tree.people.get(stack.pop()!);
    if (!cur) continue;
    for (const next of cur[dir]) {
      if (!seen.has(next) && next !== id) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}
