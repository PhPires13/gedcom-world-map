// Lays out a family chart around one person: ancestors above (a pedigree), descendants below,
// spouses beside. Pure: takes people and relationships, returns boxes and lines in chart units.

import type { Person, Relationship } from '../model';

export const CARD_W = 176;
export const CARD_H = 58;
export const GAP_X = 18;
export const GAP_Y = 70;
const SLOT = CARD_W + GAP_X;
const SPOUSE_GAP = 40;
const ROW = CARD_H + GAP_Y;

export interface ChartNode {
  /** Unique per box: the same person can appear twice when cousins married (pedigree collapse). */
  key: string;
  personId: string;
  /** Centre of the card. */
  x: number;
  y: number;
  /** 0 = the focus person's row, negative = ancestors, positive = descendants. */
  generation: number;
  /** Has parents (or children) beyond the chart's depth: drawn as a hint to refocus. */
  moreAbove: boolean;
  moreBelow: boolean;
}

export interface ChartEdge {
  key: string;
  relationshipId: string;
  kind: Relationship['kind'];
  /** SVG path data. */
  path: string;
}

export interface Chart {
  nodes: ChartNode[];
  edges: ChartEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface FamilyIndex {
  people: Map<string, Person>;
  /** Parent links into each person (rel.to = the child). */
  parentLinks: Map<string, Relationship[]>;
  /** Parent links out of each person (rel.from = the parent). */
  childLinks: Map<string, Relationship[]>;
  spouseLinks: Map<string, Relationship[]>;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

const year = (p: Person | undefined) => p?.birth?.year ?? p?.baptism?.year ?? Infinity;

export function indexFamily(people: readonly Person[], relationships: readonly Relationship[]): FamilyIndex {
  const idx: FamilyIndex = {
    people: new Map(people.filter((p) => !p.mergedInto).map((p) => [p.id, p])),
    parentLinks: new Map(),
    childLinks: new Map(),
    spouseLinks: new Map(),
  };
  for (const r of relationships) {
    if (!idx.people.has(r.from) || !idx.people.has(r.to)) continue;
    if (r.kind === 'parent') {
      push(idx.parentLinks, r.to, r);
      push(idx.childLinks, r.from, r);
    } else {
      push(idx.spouseLinks, r.from, r);
      push(idx.spouseLinks, r.to, r);
    }
  }
  // Fathers before mothers; children oldest first.
  const sexRank = (id: string) => ({ M: 0, F: 1 })[idx.people.get(id)?.sex as 'M' | 'F'] ?? 2;
  for (const list of idx.parentLinks.values()) list.sort((a, b) => sexRank(a.from) - sexRank(b.from));
  for (const list of idx.childLinks.values()) list.sort((a, b) => year(idx.people.get(a.to)) - year(idx.people.get(b.to)));
  return idx;
}

/** Elbow line from the bottom of a parent card to the top of a child card. */
function elbow(px: number, py: number, cx: number, cy: number): string {
  const y1 = py + CARD_H / 2;
  const y2 = cy - CARD_H / 2;
  const mid = (y1 + y2) / 2;
  return `M${px},${y1} V${mid} H${cx} V${y2}`;
}

/** Parents' lines meet the child a little apart, so a father's and a mother's link stay distinct. */
const childOffset = (i: number, n: number) => (n <= 1 ? 0 : (i - (n - 1) / 2) * 14);

export function layoutChart(idx: FamilyIndex, focusId: string, up: number, down: number): Chart {
  const nodes: ChartNode[] = [];
  const edges: ChartEdge[] = [];
  if (!idx.people.has(focusId)) return { nodes, edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  const parentsOf = (id: string) => idx.parentLinks.get(id) ?? [];
  const childrenOf = (id: string) => idx.childLinks.get(id) ?? [];

  // Width of each subtree in slots, so subtrees sit side by side without overlapping.
  const widthUp = (id: string, d: number, path: Set<string>): number => {
    const ps = parentsOf(id).filter((r) => !path.has(r.from));
    if (d >= up || !ps.length) return 1;
    const next = new Set(path).add(id);
    return ps.reduce((s, r) => s + widthUp(r.from, d + 1, next), 0);
  };
  const widthDown = (id: string, d: number, path: Set<string>): number => {
    const cs = childrenOf(id).filter((r) => !path.has(r.to));
    if (d >= down || !cs.length) return 1;
    const next = new Set(path).add(id);
    return cs.reduce((s, r) => s + widthDown(r.to, d + 1, next), 0);
  };

  const focus: ChartNode = { key: focusId, personId: focusId, x: 0, y: 0, generation: 0, moreAbove: false, moreBelow: false };
  nodes.push(focus);

  // Ancestors: each person centred over the span of its own ancestors.
  const placeUp = (node: ChartNode, d: number, left: number, path: Set<string>) => {
    const ps = parentsOf(node.personId).filter((r) => !path.has(r.from));
    if (!ps.length) return;
    if (d >= up) {
      node.moreAbove = true;
      return;
    }
    const next = new Set(path).add(node.personId);
    let cursor = left;
    ps.forEach((r, i) => {
      const w = widthUp(r.from, d + 1, next);
      const parent: ChartNode = {
        key: `${node.key}^${r.from}`,
        personId: r.from,
        x: (cursor + w / 2) * SLOT,
        y: -(d + 1) * ROW,
        generation: -(d + 1),
        moreAbove: false,
        moreBelow: false,
      };
      nodes.push(parent);
      edges.push({
        key: `${parent.key}>${node.key}`,
        relationshipId: r.id,
        kind: 'parent',
        path: elbow(parent.x, parent.y, node.x + childOffset(i, ps.length), node.y),
      });
      placeUp(parent, d + 1, cursor, next);
      cursor += w;
    });
  };

  const placeDown = (node: ChartNode, d: number, left: number, path: Set<string>) => {
    const cs = childrenOf(node.personId).filter((r) => !path.has(r.to));
    if (!cs.length) return;
    if (d >= down) {
      node.moreBelow = true;
      return;
    }
    const next = new Set(path).add(node.personId);
    let cursor = left;
    for (const r of cs) {
      const w = widthDown(r.to, d + 1, next);
      const child: ChartNode = {
        key: `${node.key}v${r.to}`,
        personId: r.to,
        x: (cursor + w / 2) * SLOT,
        y: (d + 1) * ROW,
        generation: d + 1,
        moreAbove: false,
        moreBelow: false,
      };
      nodes.push(child);
      edges.push({ key: `${node.key}>${child.key}`, relationshipId: r.id, kind: 'parent', path: elbow(node.x, node.y, child.x, child.y) });
      placeDown(child, d + 1, cursor, next);
      cursor += w;
    }
  };

  const root = new Set<string>();
  placeUp(focus, 0, -widthUp(focusId, 0, root) / 2, root);
  placeDown(focus, 0, -widthDown(focusId, 0, root) / 2, root);

  // Spouses to the right of the focus, past anything already in row 0.
  (idx.spouseLinks.get(focusId) ?? []).forEach((r, i) => {
    const other = r.from === focusId ? r.to : r.from;
    // Extra room so the spouse line is long enough to show its confidence style.
    const x = (i + 1) * (SLOT + SPOUSE_GAP);
    nodes.push({ key: `${focusId}&${other}`, personId: other, x, y: 0, generation: 0, moreAbove: parentsOf(other).length > 0, moreBelow: false });
    // The first spouse sits right next to the focus; lines to later ones run just under the cards.
    const under = CARD_H / 2 + 8 + i * 6;
    const path = i
      ? `M${CARD_W / 2 - 12 - i * 6},${CARD_H / 2} V${under} H${x - 12} V${CARD_H / 2}`
      : `M${CARD_W / 2},0 H${x - CARD_W / 2}`;
    edges.push({ key: `${focusId}&${other}`, relationshipId: r.id, kind: 'spouse', path });
  });

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    nodes,
    edges,
    bounds: {
      minX: Math.min(...xs) - CARD_W / 2,
      maxX: Math.max(...xs) + CARD_W / 2,
      minY: Math.min(...ys) - CARD_H / 2,
      maxY: Math.max(...ys) + CARD_H / 2,
    },
  };
}
