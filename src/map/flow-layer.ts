// Drawing the migration arrows on a Leaflet map: shared by the map app (src/main.ts) and the
// public share viewer (src/share/viewer.ts). The geometry itself lives in src/flows.ts.

import L from 'leaflet';
import { generationColor } from '../colors';
import { arrowHead, bundleFlows, bundleGeometry, computeFlows, cutPath, laneBend, trimEnd, type BundlePath, type Place } from '../flows';
import { formatNumber, makeT } from '../i18n/core';
import { mapMessages } from '../i18n/messages/map';

const t = makeT(mapMessages);

/** Places closer than this on screen are grouped, so arrows bundle until you zoom in. */
const FLOW_GROUP_PX = 60;
/** Arrows stop this far (px) before their destination, so the arrowhead isn't hidden under a marker. */
const FLOW_END_GAP = 20;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Pixel length of a path. */
const pathLength = (pts: [number, number][]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

const flowWeight = (n: number) => Math.min(16, 1.5 + 1.6 * Math.sqrt(n));

/**
 * When each piece grows during a timeline step (as shares of the step): branches merge in, the
 * trunk travels, then it splits out. Bundles without merging or splitting give their time to the rest.
 */
function growPhase(kind: BundlePath['kind'], hasIn: boolean, hasTrunk: boolean): [number, number] {
  if (hasIn && hasTrunk) return { in: [0, 0.25], trunk: [0.25, 0.75], out: [0.75, 1] }[kind] as [number, number];
  if (hasTrunk) return kind === 'trunk' ? [0, 0.65] : [0.65, 1];
  if (hasIn) return kind === 'in' ? [0, 0.3] : [0.3, 1];
  return [0, 1];
}

/** What the arrows are drawn from. People only need a name, parent links and a birth year. */
export interface FlowScene {
  map: L.Map;
  layer: L.LayerGroup;
  renderer: L.Renderer;
  people: Map<string, { name: string; parents: string[]; birth?: { year?: number } }>;
  located: Map<string, Place & { place: string }>;
  gens: Map<string, number>;
  maxGen: number;
  /** Whether to include a move, given the generation of the parent who moved and of the child whose birth dates it. */
  shown: (moverGen: number, childGen: number) => boolean;
  /** Whether a timeline step's generation is drawn faded (earlier than the current step). */
  faded: (gen: number) => boolean;
  /** The timeline step whose arrows are still growing, and how far they have grown (0..1). */
  arriving: number | null;
  growProgress: number;
  /** The selected person, whose moves are traced; everything else fades back. */
  selected: string | null;
  genLabel: (gen: number) => string;
}

/**
 * Migration arrows as a flow map: for each generation, moves between two groups of nearby places
 * become one trunk, sized by how many people made them, that splits into thinner arrows to each
 * destination (and gathers several origins at the start). Groups are measured on screen, so they
 * separate as you zoom in. Colours are the children's generation. Call again per zoom.
 *
 * Draws into `scene.layer` (cleared by the caller) and returns the parent→child pairs
 * ("parentId>childId") traced along the arrows for the selected person.
 */
export function drawFlows(scene: FlowScene): Set<string> {
  const { map, layer, renderer, people, located, gens, maxGen } = scene;
  const zoom = map.getZoom();
  const flows = computeFlows(people, located, gens, scene.shown);
  const project = (p: { lat: number; lon: number }): [number, number] => {
    const pt = map.project([p.lat, p.lon], zoom);
    return [pt.x, pt.y];
  };
  const toLatLng = ([x, y]: [number, number]) => map.unproject([x, y], zoom);
  const placeOf = (id: string) => located.get(id)?.place ?? '';
  const nameOf = (id: string) => esc(people.get(id)?.name ?? '');
  const born = (id: string) => {
    const y = people.get(id)?.birth?.year;
    return y ? ` (${y})` : '';
  };
  /** One line per move: who moved, and the children they had at the destination. */
  const moveLines = (fs: (typeof flows)[number][]) => {
    const lines = fs.map(
      (f) =>
        `<b>${f.parents.map(nameOf).join(esc(t('flows.and')))}</b> <span class="muted">→ ${t('flows.had', {
          parents: f.parents.length,
          children: f.children.map((c) => nameOf(c) + born(c)).join(', '),
        })}</span>`,
    );
    return (
      lines.slice(0, 6).join('<br>') +
      (lines.length > 6 ? `<br><span class="muted">${t('flows.more', { n: formatNumber(lines.length - 6) })}</span>` : '')
    );
  };
  const moved = (n: number) => t('flows.moved', { count: n, n: formatNumber(n) });

  // The selected person's moves are traced along the bundles they belong to: their own (as the one who
  // moved) solid, and their parents' move to where they were born dashed. Everything else fades back.
  const sel = scene.selected;
  const ownMove = (f: (typeof flows)[number]) => !!sel && f.parents.includes(sel);
  const parentsMove = (f: (typeof flows)[number]) => !!sel && f.children.includes(sel);
  const flowTraced = new Set<string>();
  const traced: { pts: [number, number][]; own: boolean }[] = [];

  // Small bundles first, so the big routes are drawn on top.
  const bundles = bundleFlows(flows, project, FLOW_GROUP_PX).sort((a, b) => a.total - b.total);
  for (const b of bundles) {
    const color = generationColor(b.gen, maxGen);
    const mine = [...new Set([...b.origins, ...b.dests].flatMap((e) => e.flows))].filter((f) => ownMove(f) || parentsMove(f));
    // The timeline dates a move by the child's birth, so fading and growing follow the child's generation.
    const opacity = (scene.faded(b.step) ? 0.25 : 0.85) * (sel && !mine.length ? 0.35 : 1);
    const growing = b.step === scene.arriving;
    const paths = bundleGeometry(b, laneBend(b.lane));
    const hasIn = paths.some((p) => p.kind === 'in');
    const hasTrunk = paths.some((p) => p.kind === 'trunk');
    const header = `<i class="dot" style="background:${color}"></i>${scene.genLabel(b.gen)}`;

    // Trace each of the selected person's moves through this bundle: their branch in, the trunk, their branch out.
    for (const f of mine) {
      const piece = (kind: BundlePath['kind']) =>
        paths.find((p) => p.kind === kind && (kind === 'trunk' || p.end?.flows.includes(f)))?.pts ?? [];
      const route = trimEnd([...piece('in'), ...piece('trunk').slice(1), ...piece('out').slice(1)], FLOW_END_GAP);
      const pts = growing ? cutPath(route, scene.growProgress) : route;
      if (pts.length >= 2) traced.push({ pts, own: ownMove(f) });
      // Record the parent→child links this move covers, so their straight family line isn't drawn too.
      if (ownMove(f)) for (const c of f.children) flowTraced.add(`${sel}>${c}`);
      else for (const p of f.parents) flowTraced.add(`${p}>${sel}`);
    }

    for (const path of paths) {
      // How much of this piece is drawn: all of it, or its share of a timeline step's growth.
      let frac = 1;
      if (growing) {
        const [a, z] = growPhase(path.kind, hasIn, hasTrunk);
        frac = Math.max(0, Math.min(1, (scene.growProgress - a) / (z - a)));
        if (frac <= 0) continue;
      }
      // Branches to a destination stop short of it, so their arrowhead shows beside the marker.
      const base = path.kind === 'out' ? trimEnd(path.pts, FLOW_END_GAP) : path.pts;
      const pts = cutPath(base, frac);
      if (pts.length < 2) continue;
      const weight = flowWeight(path.count);

      // Hover details: the whole bundle on its trunk; on a branch, who moved and the children they had there.
      const endFlows = path.end?.flows ?? [];
      const endMovers = new Set(endFlows.flatMap((f) => f.parents)).size;
      let tip: string;
      if (path.kind === 'trunk') {
        const from = [...new Set(b.origins.map((e) => placeOf(e.flows[0].parents[0])))];
        const to = [...new Set(b.dests.map((e) => placeOf(e.flows[0].children[0])))];
        const list = (xs: string[]) => esc(xs.slice(0, 4).join(', ') + (xs.length > 4 ? `, +${xs.length - 4}` : ''));
        tip = `${header}: ${moved(b.total)}<br><b>${t('flows.from')}</b> ${list(from)}<br><b>${t('flows.to')}</b> ${list(to)}`;
      } else if (path.kind === 'in') {
        tip = `<b>${t('flows.fromPlace', { place: esc(placeOf(endFlows[0].parents[0])) })}</b><br>${header}: ${moved(endMovers)}<br>${moveLines(endFlows)}`;
      } else {
        const from = [...new Set(endFlows.map((f) => placeOf(f.parents[0])))].join(', ');
        tip = `<b>${esc(from)} → ${esc(placeOf(endFlows[0].children[0]))}</b><br>${header}: ${moved(endMovers)}<br>${moveLines(endFlows)}`;
      }

      // Arrows stop just short so the arrowhead's tip lands on the place (or on the growing tip).
      const isOut = path.kind === 'out';
      const headSize = 6 + weight * 1.3;
      // The line ends under the arrowhead, not past its tip.
      L.polyline((isOut ? trimEnd(pts, headSize * 0.6) : pts).map(toLatLng), {
        renderer,
        color,
        weight,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
        bubblingMouseEvents: false,
      })
        .bindTooltip(tip, { sticky: true })
        .addTo(layer);
      if (isOut && pts.length >= 3) {
        L.polygon(arrowHead(pts[pts.length - 1], pts[pts.length - 3], headSize).map(toLatLng), {
          renderer,
          stroke: false,
          fillColor: color,
          fillOpacity: opacity,
          interactive: false,
        }).addTo(layer);
      }
      // A direction marker halfway along long trunks (and long single arrows), once fully grown.
      const main = path.kind === 'trunk' || (isOut && !hasTrunk); // the long shared part of the route
      if (main && frac >= 1 && pathLength(path.pts) > 140) {
        const mid = cutPath(path.pts, 0.55);
        L.polygon(arrowHead(mid[mid.length - 1], mid[mid.length - 3], headSize + 2).map(toLatLng), {
          renderer,
          color: '#fff',
          weight: 1.5,
          opacity,
          fillColor: color,
          fillOpacity: opacity,
          interactive: false,
        }).addTo(layer);
      }
    }
  }

  // Traced routes on top, with a white edge so they read over any arrow colour: the selected person's
  // own move solid and dark, their parents' move (to where they were born) dashed and lighter.
  for (const { pts, own } of traced.sort((a, b) => Number(a.own) - Number(b.own))) {
    const ll = pts.slice(0, -1).map(toLatLng);
    const ink = own ? '#1f2937' : '#6b7280';
    L.polyline(ll, { renderer, color: '#fff', weight: own ? 7 : 6, opacity: 0.95, interactive: false }).addTo(layer);
    L.polyline(ll, {
      renderer,
      color: ink,
      weight: own ? 3 : 2.5,
      opacity: 1,
      dashArray: own ? undefined : '7 6',
      interactive: false,
    }).addTo(layer);
    if (pts.length >= 3) {
      L.polygon(arrowHead(pts[pts.length - 1], pts[pts.length - 3], own ? 12 : 10).map(toLatLng), {
        renderer,
        color: '#fff',
        weight: 1.5,
        fillColor: ink,
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer);
    }
  }
  return flowTraced;
}
