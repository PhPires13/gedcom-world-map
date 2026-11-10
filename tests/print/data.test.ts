import { describe, expect, it } from 'vitest';
import { branchMembers, buildPrintData, defaultRoot } from '../../src/print/data';
import { sampleTree } from './fixtures';

const { tree, gens, located } = sampleTree();
const root = defaultRoot(tree, gens)!;

describe('choosing who is on the print', () => {
  it('counts branches from someone in the youngest generation', () => {
    expect(gens.get(root)).toBe(0);
    expect(tree.people.get(root)!.name).toBe('Sofia Almeida Costa');
  });

  it('splits ancestors into the father’s and mother’s sides', () => {
    const all = branchMembers(tree, { rootId: root, branch: 'all' });
    const anc = branchMembers(tree, { rootId: root, branch: 'ancestors' });
    const dad = branchMembers(tree, { rootId: root, branch: 'paternal' });
    const mum = branchMembers(tree, { rootId: root, branch: 'maternal' });
    expect(all.size).toBe(tree.people.size);
    expect(anc.size).toBeLessThan(all.size); // her brother isn't her ancestor
    const father = tree.people.get(root)!.parents.map((id) => tree.people.get(id)!).find((p) => p.sex === 'M')!;
    expect(dad.has(father.id)).toBe(true);
    expect(mum.has(father.id)).toBe(false);
    for (const id of dad) if (id !== root) expect(mum.has(id)).toBe(false);
    expect(dad.size + mum.size - 1).toBe(anc.size);
  });

  it('only draws moves within the chosen branch', () => {
    const data = buildPrintData(tree, located, gens, { rootId: root, branch: 'paternal' });
    const ids = new Set(data.people.map((p) => p.id));
    for (const f of data.flows) {
      for (const id of [...f.parents, ...f.children]) expect(branchMembers(tree, { rootId: root, branch: 'paternal' }).has(id)).toBe(true);
    }
    expect(ids.size).toBeGreaterThan(0);
  });

  it('filters generations: people by their own, moves by the generation that moved', () => {
    const data = buildPrintData(tree, located, gens, { branch: 'all', generations: [2] });
    expect(data.people.every((p) => p.gen === 2)).toBe(true);
    expect(data.flows.length).toBeGreaterThan(0);
    expect(data.flows.every((f) => f.gen === 2)).toBe(true);
  });

  it('leaves out people without a known place', () => {
    const data = buildPrintData(tree, new Map(), gens, { branch: 'all' });
    expect(data.people).toEqual([]);
    expect(data.flows).toEqual([]);
  });
});
