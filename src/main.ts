import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './style.css';

import { decodeGedcom, originEvent, parseGedcom, type Person, type Tree } from './gedcom';
import { computeGenerations } from './generations';
import { Geocoder } from './geocode';
import { generationColor, vibrant } from './colors';
import { DOT, DOTS_FROM_ZOOM, layoutSpot, spreadBox, spreadScale, type SpotLayout } from './spots';
import { DENSITY_LEVELS, densityLevel, hexCorners, hexDensity } from './hexbin';
import { arrowHead, bundleFlows, bundleGeometry, computeFlows, cutPath, laneBend, trimEnd, type BundlePath } from './flows';
import { mountTreeView } from './tree';

// ---------- Types & state ----------

interface Located {
  lat: number;
  lon: number;
  place: string;
  kind: 'birth' | 'baptism';
  source: 'file' | 'geocoded';
  /** For geocoded places: the less specific variant that matched, if not the full place. */
  approximate?: string;
}

interface SpotMarkerOptions extends L.MarkerOptions {
  personIds: string[];
  layout: SpotLayout | null;
}

type LineMode = 'family' | 'ancestors' | 'descendants' | 'all';
type MapView = 'dots' | 'density' | 'both';

const state = {
  tree: null as Tree | null,
  gens: new Map<string, number>(),
  maxGen: 0,
  located: new Map<string, Located>(),
  /** One marker per birth spot (people born at the same coordinates share it). */
  spots: new Map<string, L.Marker>(),
  spotOf: new Map<string, string>(),
  edges: [] as Edge[],
  selected: null as string | null,
  related: new Set<string>(),
  lineMode: 'family' as LineMode,
  hiddenGens: new Set<number>(),
  clustering: true,
  geocodeAbort: null as AbortController | null,
  /** Set once the user pans/zooms/clicks the map, so we stop re-fitting the view under them. */
  viewTouched: false,
  /** Place names still waiting to be looked up, and whether the lookup is running. */
  pendingPlaces: new Set<string>(),
  lookupActive: false,
  /** People opened most recently first, for the "Recently viewed" list. */
  recent: [] as string[],
  /** Show people as dots, as a hexagon density map of birth places, or both. */
  view: 'dots' as MapView,
  /** Draw migration arrows from parents' birthplaces to their children's. */
  showFlows: false,
  /**
   * Generations timeline: the generation currently shown (0 = most recent), or null when off.
   * Generations older than it stay visible but faded; more recent ones are hidden.
   */
  timeline: null as number | null,
  /**
   * During a timeline step, the generation whose arrows are still growing (its people appear once
   * the arrows arrive), and how far the arrows have grown (0..1).
   */
  arriving: null as number | null,
  growProgress: 1,
};

const geocoder = new Geocoder();
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------- Map setup ----------

const map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([30, 0], 2);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  className: 'base-tiles',
}).addTo(map);

map.createPane('lines');
map.getPane('lines')!.style.zIndex = '450'; // above tiles, below markers (600)

const linesLayer = L.layerGroup([], { pane: 'lines' }).addTo(map);

// Translucent circles grouping each town's dots; below the lines so lines stay visible over them.
map.createPane('towns');
map.getPane('towns')!.style.zIndex = '440';
map.getPane('towns')!.style.pointerEvents = 'none';
const townsLayer = L.layerGroup([], { pane: 'towns' }).addTo(map);

function makeCluster() {
  return L.markerClusterGroup({
    maxClusterRadius: 50,
    showCoverageOnHover: false,
    iconCreateFunction: clusterIcon,
  });
}

let markerLayer: L.FeatureGroup = makeCluster().addTo(map);

// While someone is selected, the towns holding them and the relatives their lines go to are
// taken out of the clusters and shown here, so every line ends at a real dot.
const pinnedLayer = L.featureGroup().addTo(map);

// ---------- Density map (hexagon areas) ----------

/** Hexagon radius in screen pixels; hexagons keep this size at every zoom. */
const HEX_R = 9;

map.createPane('density');
map.getPane('density')!.style.zIndex = '430'; // under town circles, lines and dots
const densityRenderer = L.canvas({ pane: 'density' });
const densityLayer = L.layerGroup([], { pane: 'density' }).addTo(map);

/**
 * Tile the map with hexagons filled in the main generation of the people born in and around each
 * one, at a few discrete density levels, so towns become solid areas and nearby towns merge into
 * regions. Recomputed per zoom level, since the hexagons have a fixed on-screen size.
 */
function renderDensity() {
  densityLayer.clearLayers();
  if (state.view === 'dots' || !state.tree) return;
  const zoom = map.getZoom();
  const points = [];
  for (const [id, l] of state.located) {
    const gen = state.gens.get(id) ?? 0;
    if (!genShown(gen)) continue;
    const p = map.project([l.lat, l.lon], zoom);
    points.push({ x: p.x, y: p.y, gen });
  }
  const toLatLng = ([x, y]: [number, number]) => map.unproject([x, y], zoom);

  for (const hex of hexDensity(points, HEX_R)) {
    // A more saturated version of the generation colour, so translucent areas don't look pastel.
    const color = vibrant(generationColor(hex.mainGen, state.maxGen));
    const polygon = L.polygon(hexCorners(hex.cx, hex.cy, HEX_R).map(toLatLng), {
      renderer: densityRenderer,
      stroke: false,
      fillColor: color,
      fillOpacity: DENSITY_LEVELS[densityLevel(hex.weight)].opacity * (genFaded(hex.mainGen) ? 0.4 : 1),
      bubblingMouseEvents: false,
    });
    // Hexagons with people born in them say who; the ones around only add area.
    const total = [...hex.people.values()].reduce((a, b) => a + b, 0);
    if (total) {
      const rows = [...hex.people.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([g, n]) => `<i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>${genLabel(g)}: ${n}`)
        .join('<br>');
      polygon.bindTooltip(`<b>${total} ${total === 1 ? 'person' : 'people'} born here</b><br>${rows}`, { sticky: true });
    }
    const centre = toLatLng([hex.cx, hex.cy]);
    polygon.on('click', () => map.flyTo(centre, Math.min(map.getMaxZoom(), zoom + 2)));
    polygon.addTo(densityLayer);
  }
}

const dotsShown = () => state.view !== 'density';

/** Is this generation part of the map: ticked in the legend and, with the timeline on, reached by it. */
const genVisible = (g: number) => !state.hiddenGens.has(g) && (state.timeline === null || g >= state.timeline);
/** Are this generation's people drawn: visible, and not still arriving in a timeline step. */
const genShown = (g: number) => genVisible(g) && g !== state.arriving;
/** During the timeline, generations before the current step are shown faded. */
const genFaded = (g: number) => state.timeline !== null && g > state.timeline;

// ---------- Migration arrows ----------

map.createPane('flows');
map.getPane('flows')!.style.zIndex = '445'; // over density and town circles, under selection lines and dots
const flowsRenderer = L.canvas({ pane: 'flows' });
const flowsLayer = L.layerGroup([], { pane: 'flows' }).addTo(map);

/** Places closer than this on screen are grouped, so arrows bundle until you zoom in. */
const FLOW_GROUP_PX = 60;
/** Arrows stop this far (px) before their destination, so the arrowhead isn't hidden under a marker. */
const FLOW_END_GAP = 20;

/** Pixel length of a path. */
const pathLength = (pts: [number, number][]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

const flowWeight = (n: number) => Math.min(16, 1.5 + 1.6 * Math.sqrt(n));

/** Parent→child pairs ("parentId>childId") whose move is traced along the arrows for the selected person. */
let flowTraced = new Set<string>();

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

/**
 * Migration arrows as a flow map: for each generation, moves between two groups of nearby places
 * become one trunk, sized by how many people made them, that splits into thinner arrows to each
 * destination (and gathers several origins at the start). Groups are measured on screen, so they
 * separate as you zoom in. Colours are the children's generation. Recomputed per zoom.
 */
function renderFlows() {
  flowsLayer.clearLayers();
  if (!state.showFlows || !state.tree) return;
  const zoom = map.getZoom();
  // A move shows if the mover's generation is ticked in the legend, and (with the timeline on) once the
  // timeline reaches the generation of the child whose birth dates it.
  const flows = computeFlows(
    state.tree.people,
    state.located,
    state.gens,
    (moverGen, childGen) => !state.hiddenGens.has(moverGen) && (state.timeline === null || childGen >= state.timeline),
  );
  const project = (p: { lat: number; lon: number }): [number, number] => {
    const pt = map.project([p.lat, p.lon], zoom);
    return [pt.x, pt.y];
  };
  const toLatLng = ([x, y]: [number, number]) => map.unproject([x, y], zoom);
  const people = state.tree.people;
  const placeOf = (id: string) => state.located.get(id)?.place ?? '';
  const nameOf = (id: string) => esc(people.get(id)?.name ?? '');
  const born = (id: string) => {
    const y = people.get(id)?.birth?.year;
    return y ? ` (${y})` : '';
  };
  /** One line per move: who moved, and the children they had at the destination. */
  const moveLines = (fs: (typeof flows)[number][]) => {
    const lines = fs.map(
      (f) =>
        `<b>${f.parents.map(nameOf).join(' &amp; ')}</b> <span class="muted">→ had ${f.children.map((c) => nameOf(c) + born(c)).join(', ')}</span>`,
    );
    return lines.slice(0, 6).join('<br>') + (lines.length > 6 ? `<br><span class="muted">and ${lines.length - 6} more</span>` : '');
  };
  const moved = (n: number) => `${n} ${n === 1 ? 'person' : 'people'} moved`;

  // The selected person's moves are traced along the bundles they belong to: their own (as the one who
  // moved) solid, and their parents' move to where they were born dashed. Everything else fades back.
  const sel = state.selected;
  const ownMove = (f: (typeof flows)[number]) => !!sel && f.parents.includes(sel);
  const parentsMove = (f: (typeof flows)[number]) => !!sel && f.children.includes(sel);
  flowTraced = new Set();
  const traced: { pts: [number, number][]; own: boolean }[] = [];

  // Small bundles first, so the big routes are drawn on top.
  const bundles = bundleFlows(flows, project, FLOW_GROUP_PX).sort((a, b) => a.total - b.total);
  for (const b of bundles) {
    const color = generationColor(b.gen, state.maxGen);
    const mine = [...new Set([...b.origins, ...b.dests].flatMap((e) => e.flows))].filter((f) => ownMove(f) || parentsMove(f));
    // The timeline dates a move by the child's birth, so fading and growing follow the child's generation.
    const opacity = (genFaded(b.step) ? 0.25 : 0.85) * (sel && !mine.length ? 0.35 : 1);
    const growing = b.step === state.arriving;
    const paths = bundleGeometry(b, laneBend(b.lane));
    const hasIn = paths.some((p) => p.kind === 'in');
    const hasTrunk = paths.some((p) => p.kind === 'trunk');
    const header = `<i class="dot" style="background:${color}"></i>${genLabel(b.gen)}`;

    // Trace each of the selected person's moves through this bundle: their branch in, the trunk, their branch out.
    for (const f of mine) {
      const piece = (kind: BundlePath['kind']) =>
        paths.find((p) => p.kind === kind && (kind === 'trunk' || p.end?.flows.includes(f)))?.pts ?? [];
      const route = trimEnd([...piece('in'), ...piece('trunk').slice(1), ...piece('out').slice(1)], FLOW_END_GAP);
      const pts = growing ? cutPath(route, state.growProgress) : route;
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
        frac = Math.max(0, Math.min(1, (state.growProgress - a) / (z - a)));
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
        tip = `${header}: ${moved(b.total)}<br><b>From</b> ${list(from)}<br><b>To</b> ${list(to)}`;
      } else if (path.kind === 'in') {
        tip = `<b>From ${esc(placeOf(endFlows[0].parents[0]))}</b><br>${header}: ${moved(endMovers)}<br>${moveLines(endFlows)}`;
      } else {
        const from = [...new Set(endFlows.map((f) => placeOf(f.parents[0])))].join(', ');
        tip = `<b>${esc(from)} → ${esc(placeOf(endFlows[0].children[0]))}</b><br>${header}: ${moved(endMovers)}<br>${moveLines(endFlows)}`;
      }

      // Arrows stop just short so the arrowhead's tip lands on the place (or on the growing tip).
      const isOut = path.kind === 'out';
      const headSize = 6 + weight * 1.3;
      // The line ends under the arrowhead, not past its tip.
      L.polyline((isOut ? trimEnd(pts, headSize * 0.6) : pts).map(toLatLng), {
        renderer: flowsRenderer,
        color,
        weight,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
        bubblingMouseEvents: false,
      })
        .bindTooltip(tip, { sticky: true })
        .addTo(flowsLayer);
      if (isOut && pts.length >= 3) {
        L.polygon(arrowHead(pts[pts.length - 1], pts[pts.length - 3], headSize).map(toLatLng), {
          renderer: flowsRenderer,
          stroke: false,
          fillColor: color,
          fillOpacity: opacity,
          interactive: false,
        }).addTo(flowsLayer);
      }
      // A direction marker halfway along long trunks (and long single arrows), once fully grown.
      const main = path.kind === 'trunk' || (isOut && !hasTrunk); // the long shared part of the route
      if (main && frac >= 1 && pathLength(path.pts) > 140) {
        const mid = cutPath(path.pts, 0.55);
        L.polygon(arrowHead(mid[mid.length - 1], mid[mid.length - 3], headSize + 2).map(toLatLng), {
          renderer: flowsRenderer,
          color: '#fff',
          weight: 1.5,
          opacity,
          fillColor: color,
          fillOpacity: opacity,
          interactive: false,
        }).addTo(flowsLayer);
      }
    }
  }

  // Traced routes on top, with a white edge so they read over any arrow colour: the selected person's
  // own move solid and dark, their parents' move (to where they were born) dashed and lighter.
  for (const { pts, own } of traced.sort((a, b) => Number(a.own) - Number(b.own))) {
    const ll = pts.slice(0, -1).map(toLatLng);
    const ink = own ? '#1f2937' : '#6b7280';
    L.polyline(ll, { renderer: flowsRenderer, color: '#fff', weight: own ? 7 : 6, opacity: 0.95, interactive: false }).addTo(flowsLayer);
    L.polyline(ll, {
      renderer: flowsRenderer,
      color: ink,
      weight: own ? 3 : 2.5,
      opacity: 1,
      dashArray: own ? undefined : '7 6',
      interactive: false,
    }).addTo(flowsLayer);
    if (pts.length >= 3) {
      L.polygon(arrowHead(pts[pts.length - 1], pts[pts.length - 3], own ? 12 : 10).map(toLatLng), {
        renderer: flowsRenderer,
        color: '#fff',
        weight: 1.5,
        fillColor: ink,
        fillOpacity: 1,
        interactive: false,
      }).addTo(flowsLayer);
    }
  }
}

function setView(view: MapView) {
  state.view = view;
  for (const layer of [markerLayer, pinnedLayer]) {
    if (dotsShown()) layer.addTo(map);
    else map.removeLayer(layer);
  }
  $('#density-key').hidden = view === 'dots';
  renderDensity();
  renderOverlays();
}

const idsOf = (m: L.Marker) => (m.options as SpotMarkerOptions).personIds;

function clusterIcon(cluster: L.MarkerCluster) {
  return pieIcon(cluster.getAllChildMarkers().flatMap(idsOf));
}

/** A disk split by generation colour, with a head count: used for clusters and for zoomed-out towns. */
function pieIcon(ids: string[]) {
  const counts = new Map<number, number>();
  for (const id of ids) {
    const g = state.gens.get(id) ?? 0;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = ids.length;
  let acc = 0;
  const stops = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, n]) => {
      const from = (acc / total) * 360;
      acc += n;
      // During the timeline, earlier generations' slices are translucent so the current one stands out.
      const color = generationColor(g, state.maxGen) + (genFaded(g) ? '59' : '');
      return `${color} ${from}deg ${(acc / total) * 360}deg`;
    })
    .join(', ');
  const size = total < 10 ? 34 : total < 100 ? 42 : 50;
  const cls = ['cluster'];
  if (state.selected && ids.includes(state.selected)) cls.push('has-selected');
  else if (state.selected && !ids.some(isHighlighted)) cls.push('dim');
  return L.divIcon({
    html: `<div class="pie" style="background: conic-gradient(${stops})"><span>${total}</span></div>`,
    className: cls.join(' '),
    iconSize: [size, size],
  });
}

// ---------- Helpers ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function lifespan(p: Person): string {
  const b = p.birth?.year ?? p.baptism?.year;
  const d = p.death?.year ?? p.burial?.year;
  if (!b && !d) return '';
  return `${b ?? '?'}–${d ?? ''}`;
}

const genLabel = (g: number) => `Generation ${g + 1}`;

function isHighlighted(id: string) {
  return id === state.selected || state.related.has(id);
}

/** CSS state classes for one person's dot. */
function dotState(id: string): string {
  if (id === state.selected) return ' selected';
  if (state.selected && !state.related.has(id)) return ' dim';
  if (genFaded(state.gens.get(id) ?? 0)) return ' faded';
  return '';
}

/** A lone person: a simple dot. Several people at one spot: dots spread around it, one row per generation. */
function spotIcon(ids: string[], layout: SpotLayout | null) {
  const people = state.tree!.people;
  // Zoomed out, a town with several people is a disk like the clusters between towns.
  if (layout && townAsDisk()) return pieIcon(ids);
  if (!layout) {
    const id = ids[0];
    const size = id === state.selected ? 22 : 14;
    return L.divIcon({
      className: `person-pin${dotState(id)}`,
      html: `<span style="background:${generationColor(state.gens.get(id) ?? 0, state.maxGen)}"></span>`,
      iconSize: [size, size],
    });
  }
  // Spread grows with the map once zoomed in, so people keep their place within the town.
  const scale = spreadScale(map.getZoom(), layout.minScale);
  const { halfW, halfH } = spreadBox(layout, scale);
  const dots = layout.dots
    .map((d) => {
      const p = people.get(d.id)!;
      const title = [p.name, lifespan(p), state.located.get(d.id)?.place].filter(Boolean).join(' · ');
      const left = halfW + d.dx * scale - DOT / 2;
      const top = halfH + d.dy * scale - DOT / 2;
      return `<span class="tree-dot${dotState(d.id)}" data-pid="${esc(d.id)}" title="${esc(title)}" style="left:${left}px;top:${top}px;background:${generationColor(d.gen, state.maxGen)}"></span>`;
    })
    .join('');
  return L.divIcon({
    className: 'spot-tree',
    html: dots,
    iconSize: [halfW * 2, halfH * 2],
    iconAnchor: [halfW, halfH],
  });
}

// ---------- Loading a tree ----------

async function loadText(text: string, fileName: string) {
  await loadTree(parseGedcom(text), fileName);
}

async function loadTree(tree: Tree, fileName: string) {
  state.geocodeAbort?.abort();
  state.lookupActive = false;
  state.pendingPlaces = new Set();
  if (tree.people.size === 0) {
    alert(`No people found in “${fileName}”. Is it a GEDCOM file?`);
    return;
  }

  state.tree = tree;
  state.gens = computeGenerations(tree);
  state.maxGen = Math.max(0, ...state.gens.values());
  state.located.clear();
  state.hiddenGens.clear();
  state.selected = null;
  state.related.clear();
  state.edges = [];
  state.viewTouched = false;
  linesLayer.clearLayers();
  $('#person-panel').hidden = true;
  $('#line-legend').hidden = true;

  $('#upload').hidden = true;
  $('#tree-info').hidden = false;
  $('#file-name').textContent = fileName;
  $('#file-name').title = fileName;
  $<HTMLInputElement>('#search').value = '';
  renderSearch('');
  state.recent = [];
  renderRecent();
  stopTimeline();
  cancelAnimationFrame(growFrame);
  state.timeline = null;
  state.arriving = null;
  state.growProgress = 1;
  $('#timeline').hidden = true;

  // Places that need looking up → people waiting on them.
  const pending = new Map<string, string[]>();

  for (const p of tree.people.values()) {
    const origin = originEvent(p);
    if (!origin) continue;
    const { event, kind } = origin;
    if (event.lat !== undefined && event.lon !== undefined) {
      state.located.set(p.id, { lat: event.lat, lon: event.lon, place: event.place ?? '', kind, source: 'file' });
    } else if (event.place) {
      const cached = geocoder.cached(event.place);
      if (cached) setGeocoded(p.id, event.place, kind, cached);
      else if (cached === undefined) {
        const list = pending.get(event.place) ?? [];
        list.push(p.id);
        pending.set(event.place, list);
      }
    }
  }

  rebuildMarkers();
  renderLegend();
  renderStats();
  fitToMarkers();

  state.pendingPlaces = new Set(pending.keys());
  if (pending.size) await geocodeAll(pending);
}

function setGeocoded(id: string, place: string, kind: Located['kind'], c: { lat: number; lon: number; matched: string }) {
  state.located.set(id, {
    lat: c.lat,
    lon: c.lon,
    place,
    kind,
    source: 'geocoded',
    approximate: c.matched !== place ? c.matched : undefined,
  });
}

async function geocodeAll(pending: Map<string, string[]>) {
  const abort = new AbortController();
  state.geocodeAbort = abort;
  state.lookupActive = true;
  const places = [...pending.keys()];
  const progress = $('#progress');
  progress.hidden = false;
  let failed = 0;

  for (let i = 0; i < places.length; i++) {
    if (abort.signal.aborted) break;
    const remaining = places.length - i;
    $('#progress-label').textContent = `Finding places… ${i}/${places.length} (~${Math.ceil(remaining * 1.2)}s left)`;
    $<HTMLDivElement>('#progress-fill').style.width = `${(i / places.length) * 100}%`;

    const place = places[i];
    try {
      const c = await geocoder.geocode(place, abort.signal);
      if (c) {
        for (const id of pending.get(place)!) {
          const kind = originEvent(state.tree!.people.get(id)!)!.kind;
          setGeocoded(id, place, kind, c);
        }
        scheduleRebuild();
      }
      state.pendingPlaces.delete(place);
      // If the open person was waiting on this place, refresh their panel and lines now.
      if (state.selected && pending.get(place)!.includes(state.selected)) select(state.selected, { pan: false });
    } catch (e) {
      if (abort.signal.aborted) break;
      failed++;
      console.warn('Geocoding error for', place, e);
      if (failed >= 5) {
        $('#progress-label').textContent = 'Place lookup is failing — check your connection.';
        state.geocodeAbort = null;
        state.lookupActive = false;
        if (state.selected) renderPerson();
        return;
      }
    }
    if (i % 5 === 0) renderStats();
  }

  progress.hidden = true;
  state.geocodeAbort = null;
  state.lookupActive = false;
  renderStats();
  if (state.selected) select(state.selected, { pan: false });
  if (!abort.signal.aborted && !state.viewTouched) fitToMarkers();
}

// ---------- Markers ----------

const spotKey = (l: Located) => `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`;

/** Recreate every marker: one per birth spot, holding all visible people born there. */
function rebuildMarkers() {
  markerLayer.clearLayers();
  pinnedLayer.clearLayers();
  state.spots.clear();
  state.spotOf.clear();
  if (!state.tree) return;

  const exact = new Map<string, string[]>();
  for (const [id, loc] of state.located) {
    if (!genShown(state.gens.get(id) ?? 0)) continue;
    const key = spotKey(loc);
    exact.set(key, [...(exact.get(key) ?? []), id]);
  }

  // The same town often ends up with slightly different coordinates (coordinates from the file vs.
  // geocoded, "Braga" vs "Braga, Braga, Portugal"), so merge spots that are very close together.
  // Each merged spot sits at the location of its largest original group.
  const MERGE_METERS = 1500;
  const spots: { at: L.LatLng; ids: string[] }[] = [];
  for (const ids of [...exact.values()].sort((a, b) => b.length - a.length)) {
    const loc = state.located.get(ids[0])!;
    const at = L.latLng(loc.lat, loc.lon);
    const near = spots.find((sp) => sp.at.distanceTo(at) < MERGE_METERS);
    if (near) near.ids.push(...ids);
    else spots.push({ at, ids: [...ids] });
  }
  const groups = new Map(spots.map((sp, i) => [String(i), sp] as const));

  const markers: L.Marker[] = [];
  for (const [key, { at, ids }] of groups) {
    const loc = state.located.get(ids[0])!;
    const layout =
      ids.length > 1
        ? layoutSpot(
            ids,
            (id) => state.gens.get(id) ?? 0,
            (id) => state.tree!.people.get(id)?.birth?.year,
          )
        : null;
    const marker = L.marker(at, {
      icon: spotIcon(ids, layout),
      personIds: ids,
      layout,
      riseOnHover: true,
    } as SpotMarkerOptions);
    if (!layout) {
      const p = state.tree.people.get(ids[0])!;
      marker.bindTooltip(`<b>${esc(p.name)}</b> ${lifespan(p)}<br>${esc(loc.place)}`, { direction: 'top', offset: [0, -8] });
    }
    marker.on('click', (e: L.LeafletMouseEvent) => {
      // A zoomed-out town disk behaves like a cluster: zoom in until its people spread out.
      if (layout && townAsDisk()) {
        map.flyTo(marker.getLatLng(), Math.max(DOTS_FROM_ZOOM, map.getZoom() + 2));
        return;
      }
      const dot = (e.originalEvent.target as HTMLElement).closest<HTMLElement>('[data-pid]');
      const id = dot?.dataset.pid ?? (layout ? null : ids[0]);
      if (id) select(id, { pan: false });
    });
    state.spots.set(key, marker);
    for (const id of ids) state.spotOf.set(id, key);
    markers.push(marker);
  }
  if (markerLayer instanceof L.MarkerClusterGroup) markerLayer.addLayers(markers);
  else markers.forEach((m) => markerLayer.addLayer(m));
  syncPinned();
  renderDensity();
  renderFlows();
  renderOverlays();
}

/** Move the selected person's family out of (or back into) the clusters. */
function syncPinned() {
  const want = new Set<string>();
  if (state.selected && markerLayer instanceof L.MarkerClusterGroup) {
    for (const id of [state.selected, ...state.edges.flatMap((e) => [e.from, e.to])]) {
      const key = state.spotOf.get(id);
      if (key !== undefined) want.add(key);
    }
  }
  const pin: L.Marker[] = [];
  const unpin: L.Marker[] = [];
  for (const [key, m] of state.spots) {
    const pinned = pinnedLayer.hasLayer(m);
    if (want.has(key) && !pinned) pin.push(m);
    else if (!want.has(key) && pinned) unpin.push(m);
  }
  if (!pin.length && !unpin.length) return;
  if (markerLayer instanceof L.MarkerClusterGroup) markerLayer.removeLayers(pin);
  pin.forEach((m) => pinnedLayer.addLayer(m));
  unpin.forEach((m) => pinnedLayer.removeLayer(m));
  if (markerLayer instanceof L.MarkerClusterGroup) markerLayer.addLayers(unpin);
  else unpin.forEach((m) => markerLayer.addLayer(m));
}

let rebuildTimer = 0;
/** Coalesce rebuilds while places are being geocoded one by one. */
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuildMarkers, 300);
}

function refreshIcons() {
  for (const m of state.spots.values()) {
    const o = m.options as SpotMarkerOptions;
    m.setIcon(spotIcon(o.personIds, o.layout));
  }
  if (markerLayer instanceof L.MarkerClusterGroup) markerLayer.refreshClusters();
}

function setClustering(on: boolean) {
  state.clustering = on;
  map.removeLayer(markerLayer);
  markerLayer = on ? makeCluster() : L.featureGroup();
  markerLayer.on('animationend', renderOverlays);
  if (dotsShown()) markerLayer.addTo(map);
  rebuildMarkers();
}
markerLayer.on('animationend', renderOverlays);

/** Zoomed out far enough that towns are drawn as disks rather than spread-out dots? */
const townAsDisk = () => map.getZoom() < DOTS_FROM_ZOOM;

/** Is this spot drawn as itself (not folded into a cluster)? */
function spotVisible(marker: L.Marker): boolean {
  if (pinnedLayer.hasLayer(marker)) return true;
  return markerLayer instanceof L.MarkerClusterGroup
    ? markerLayer.getVisibleParent(marker) === marker
    : markerLayer.hasLayer(marker);
}

function renderTownCircles() {
  townsLayer.clearLayers();
  for (const marker of state.spots.values()) {
    const layout = (marker.options as SpotMarkerOptions).layout;
    if (!layout || !dotsShown() || townAsDisk() || !spotVisible(marker)) continue;
    const { halfW, halfH } = spreadBox(layout, spreadScale(map.getZoom(), layout.minScale));
    L.circleMarker(marker.getLatLng(), {
      pane: 'towns',
      radius: Math.hypot(halfW, halfH) + 9,
      color: '#343a40',
      weight: 1,
      opacity: 0.35,
      fillColor: '#495057',
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(townsLayer);
  }
}

/** Things drawn relative to where spots currently appear: town circles and relationship lines. */
function renderOverlays() {
  renderTownCircles();
  renderLines();
}

/**
 * Where a person's dot is actually drawn. In a town's group of dots that's offset from the town's
 * coordinates; inside a cluster (or for a lone dot) it's the coordinates themselves.
 */
function dotLatLng(id: string): L.LatLng {
  const loc = state.located.get(id)!;
  const latlng = L.latLng(loc.lat, loc.lon);
  if (!dotsShown()) return latlng; // density map only: lines go to the birth places themselves
  const marker = state.spots.get(state.spotOf.get(id) ?? '');
  const layout = marker && (marker.options as SpotMarkerOptions).layout;
  if (!marker || !layout) return latlng;
  if (!spotVisible(marker)) return latlng;
  if (townAsDisk()) return marker.getLatLng();
  const dot = layout.dots.find((d) => d.id === id)!;
  const scale = spreadScale(map.getZoom(), layout.minScale);
  return map.layerPointToLatLng(map.latLngToLayerPoint(marker.getLatLng()).add([dot.dx * scale, dot.dy * scale]));
}

function fitToMarkers() {
  const pts = [...state.located.values()].map((l) => L.latLng(l.lat, l.lon));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 8 });
}

// ---------- Selection & relationship lines ----------

interface Edge {
  from: string;
  to: string;
  kind: 'up' | 'down' | 'spouse';
  skipped: boolean;
}

/**
 * Walk parents ("up") or children ("down") from `start`. Lines connect each person to their
 * nearest relative in that direction who has a location; if someone in between has no known
 * place the line is marked `skipped` and drawn dashed.
 */
function walk(start: string, dir: 'up' | 'down', depth: number, edges: Edge[], related: Set<string>) {
  const tree = state.tree!;
  const key = dir === 'up' ? 'parents' : 'children';
  const visited = new Set<string>();
  const visit = (id: string, anchor: string | null, skipped: boolean, d: number) => {
    if (d >= depth) return;
    for (const next of tree.people.get(id)?.[key] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      related.add(next);
      if (state.located.has(next)) {
        if (anchor) edges.push({ from: anchor, to: next, kind: dir, skipped });
        visit(next, next, false, d + 1);
      } else {
        // Unplaced relatives don't count towards depth, so the line reaches the next placed one.
        visit(next, anchor, true, d);
      }
    }
  };
  visit(start, state.located.has(start) ? start : null, false, 0);
}

function computeEdges(id: string): { edges: Edge[]; related: Set<string> } {
  const edges: Edge[] = [];
  const related = new Set<string>();
  const up = state.lineMode === 'ancestors' || state.lineMode === 'all' ? Infinity : 1;
  const down = state.lineMode === 'descendants' || state.lineMode === 'all' ? Infinity : 1;
  walk(id, 'up', up, edges, related);
  walk(id, 'down', down, edges, related);
  for (const s of state.tree!.people.get(id)!.spouses) {
    related.add(s);
    if (state.located.has(id) && state.located.has(s)) edges.push({ from: id, to: s, kind: 'spouse', skipped: false });
  }
  return { edges, related };
}

const LINE_COLORS = { up: '#1864ab', down: '#d9480f', spouse: '#495057' };

/**
 * Points for one relationship line. Lines between relatives born in the same town bow gently
 * outwards, so lines between neighbouring dots don't run on top of each other or the dots.
 */
function linePoints(e: Edge): L.LatLng[] {
  const a = dotLatLng(e.from);
  const b = dotLatLng(e.to);
  const key = state.spotOf.get(e.from);
  const marker = key !== undefined && key === state.spotOf.get(e.to) ? state.spots.get(key) : undefined;
  if (!marker || !(marker.options as SpotMarkerOptions).layout || !dotsShown() || townAsDisk() || !spotVisible(marker)) {
    return [a, b];
  }

  const p1 = map.latLngToLayerPoint(a);
  const p2 = map.latLngToLayerPoint(b);
  const centre = map.latLngToLayerPoint(marker.getLatLng());
  const mid = p1.add(p2).divideBy(2);
  const d = p2.subtract(p1);
  const len = Math.hypot(d.x, d.y) || 1;
  // Unit normal, flipped to point away from the town's centre.
  let n = L.point(-d.y / len, d.x / len);
  const away = mid.subtract(centre);
  if (n.x * away.x + n.y * away.y < 0) n = n.multiplyBy(-1);
  const bulge = Math.min(40, Math.max(10, len * 0.3));
  const ctrl = mid.add(n.multiplyBy(bulge * 2)); // quadratic Bézier apex sits at `bulge`

  const pts: L.LatLng[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = (1 - t) ** 2 * p1.x + 2 * (1 - t) * t * ctrl.x + t ** 2 * p2.x;
    const y = (1 - t) ** 2 * p1.y + 2 * (1 - t) * t * ctrl.y + t ** 2 * p2.y;
    pts.push(map.layerPointToLatLng([x, y]));
  }
  return pts;
}

function renderLines() {
  linesLayer.clearLayers();
  if (!state.selected) return;
  for (const e of state.edges) {
    // Moves already traced along the migration arrows don't need a straight line too.
    const pair = e.kind === 'up' ? `${e.to}>${e.from}` : `${e.from}>${e.to}`;
    if (state.showFlows && e.kind !== 'spouse' && flowTraced.has(pair)) continue;
    const pts = linePoints(e);
    L.polyline(pts, { pane: 'lines', color: '#fff', weight: 6, opacity: 0.8, interactive: false }).addTo(linesLayer);
    L.polyline(pts, {
      pane: 'lines',
      color: LINE_COLORS[e.kind],
      weight: 3,
      opacity: 0.9,
      lineCap: 'round',
      // Dotted: a relative in between has no known place. Dashed: spouse.
      dashArray: e.skipped ? '1 7' : e.kind === 'spouse' ? '6 7' : undefined,
      interactive: false,
    }).addTo(linesLayer);
  }
}

// Town dots are spread by a zoom-dependent amount, so redraw them, their circles and lines per zoom level.
map.on('zoomend', () => {
  if (state.tree) refreshIcons();
  renderDensity();
  renderFlows();
  renderOverlays();
});

function select(id: string | null, opts: { pan: boolean } = { pan: true }) {
  state.selected = id;
  if (id) {
    state.viewTouched = true;
    state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
  }
  renderRecent();
  const { edges, related } = id ? computeEdges(id) : { edges: [], related: new Set<string>() };
  state.edges = edges;
  state.related = related;
  syncPinned();
  refreshIcons();
  renderFlows();
  renderOverlays();
  $('#line-legend').hidden = !id;
  renderPerson();

  if (id && opts.pan) {
    const ids = [id, ...edges.map((e) => e.to)].filter((x) => state.located.has(x));
    const pts = ids.map((x) => L.latLng(state.located.get(x)!.lat, state.located.get(x)!.lon));
    // Keep the family clear of the info panel floating over the right side of the map.
    const panelW = window.innerWidth > 720 ? $('#person-panel').offsetWidth + 70 : 40;
    const fit = { paddingTopLeft: [60, 60] as L.PointTuple, paddingBottomRight: [panelW, 60] as L.PointTuple };
    const bounds = pts.length ? L.latLngBounds(pts) : null;
    if (bounds && bounds.getNorthEast().equals(bounds.getSouthWest())) {
      // Everyone is at one spot: zoom in far enough for the town's tree card to show.
      map.flyTo(pts[0], Math.max(map.getZoom(), 11), { duration: 0.8 });
    } else if (bounds) {
      map.flyToBounds(bounds, { ...fit, maxZoom: 9, duration: 0.8 });
    }
  }
}

// ---------- Person panel ----------

function personLink(id: string, liAttrs = '') {
  const p = state.tree!.people.get(id);
  if (!p) return '';
  const g = state.gens.get(id) ?? 0;
  const noLoc = state.located.has(id) ? '' : ' <em class="muted">· no location</em>';
  return `<li${liAttrs}><a href="#" data-person="${esc(id)}" tabindex="-1"><i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>${esc(p.name)}</a> <span class="muted">${lifespan(p)}</span>${noLoc}</li>`;
}

function eventRow(label: string, ev: Person['birth']) {
  if (!ev || (!ev.date && !ev.place)) return '';
  return `<tr><th>${label}</th><td>${esc(ev.date ?? '')}${ev.date && ev.place ? '<br>' : ''}${esc(ev.place ?? '')}</td></tr>`;
}

function renderPerson() {
  const panel = $('#person-panel');
  const id = state.selected;
  if (!id) {
    panel.hidden = true;
    return;
  }
  const p = state.tree!.people.get(id)!;
  const g = state.gens.get(id) ?? 0;
  const loc = state.located.get(id);
  const section = (title: string, ids: string[]) =>
    ids.length ? `<h3>${title}</h3><ul class="people">${ids.map((id) => personLink(id)).join('')}</ul>` : '';

  let locNote = '';
  if (!loc) {
    const origin = originEvent(p);
    const waiting = origin?.event.place !== undefined && state.pendingPlaces.has(origin.event.place);
    locNote = !origin
      ? `<p class="note">No birth place recorded — not shown on the map.</p>`
      : waiting && state.lookupActive
        ? `<p class="note">Still looking up this place — it will appear on the map once found.</p>`
        : waiting
          ? `<p class="note">The place lookup stopped before reaching this place. Load the file again to continue.</p>`
          : `<p class="note">Birth place couldn’t be found on the map.</p>`;
  } else {
    const notes: string[] = [];
    if (loc.kind === 'baptism') notes.push('Placed at baptism location (no birth place recorded).');
    if (loc.approximate) notes.push(`Approximate: matched “${esc(loc.approximate)}”.`);
    if (notes.length) locNote = `<p class="note">${notes.join(' ')}</p>`;
  }

  const siblings = new Set<string>();
  for (const par of p.parents) for (const c of state.tree!.people.get(par)?.children ?? []) if (c !== id) siblings.add(c);

  $('#person-content').innerHTML = `
    <div class="gen-badge" style="background:${generationColor(g, state.maxGen)}">${genLabel(g)}</div>
    <h2>${esc(p.name)}</h2>
    <p class="muted">${[lifespan(p), p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : ''].filter(Boolean).join(' · ')}</p>
    ${locNote}
    <table class="events">
      ${eventRow('Born', p.birth)}
      ${p.birth?.place ? '' : eventRow('Baptised', p.baptism)}
      ${eventRow('Died', p.death)}
      ${eventRow('Buried', p.burial)}
      ${p.occupation ? `<tr><th>Occupation</th><td>${esc(p.occupation)}</td></tr>` : ''}
    </table>
    ${section('Parents', p.parents)}
    ${section(p.spouses.length > 1 ? 'Spouses' : 'Spouse', p.spouses)}
    ${section('Children', p.children)}
    ${section('Siblings', [...siblings])}
    ${loc ? '<button id="zoom-person" class="btn">Zoom to family</button>' : ''}
  `;
  panel.hidden = false;
  panel.scrollTop = 0;
  $('#zoom-person')?.addEventListener('click', () => select(id));
}

// ---------- Sidebar ----------

function renderStats() {
  const t = state.tree!;
  const total = t.people.size;
  const onMap = state.located.size;
  const stat = (n: number, label: string) => `<div class="stat"><b>${n.toLocaleString()}</b><span>${label}</span></div>`;
  $('#stats').innerHTML = stat(total, 'people') + stat(onMap, 'on the map') + stat(state.maxGen + 1, 'generations');

  const missing = [...t.people.values()].filter((p) => !state.located.has(p.id));
  const details = $<HTMLDetailsElement>('#unmapped');
  details.hidden = missing.length === 0;
  details.querySelector('summary')!.textContent = `${missing.length} not on the map`;
  details.querySelector('ul')!.innerHTML = missing
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500)
    .map((p) => personLink(p.id))
    .join('');
}

function renderLegend() {
  const byGen = new Map<number, { count: number; years: number[] }>();
  for (const p of state.tree!.people.values()) {
    const g = state.gens.get(p.id) ?? 0;
    const e = byGen.get(g) ?? { count: 0, years: [] };
    e.count++;
    if (p.birth?.year) e.years.push(p.birth.year);
    byGen.set(g, e);
  }
  const rows: string[] = [];
  for (let g = 0; g <= state.maxGen; g++) {
    const e = byGen.get(g);
    if (!e) continue;
    const ys = e.years.sort((a, b) => a - b);
    const median = ys.length ? `born ≈ ${ys[Math.floor(ys.length / 2)]}` : '';
    const shown = !state.hiddenGens.has(g);
    rows.push(
      `<li class="${shown ? '' : 'off'}" data-gen="${g}">
        <input type="checkbox" class="gen-check" ${shown ? 'checked' : ''} aria-label="Show ${genLabel(g)}" />
        <i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>
        <button type="button" class="gen-name" title="Show only this generation">${genLabel(g)}</button>
        <span class="muted">${median}</span>
        <span class="count">${e.count}</span>
      </li>`,
    );
  }
  $('#legend').innerHTML = rows.join('');

  // "Select all" is ticked when everything shows, half-ticked when only some do.
  const total = byGen.size;
  const hidden = [...byGen.keys()].filter((g) => state.hiddenGens.has(g)).length;
  const all = $<HTMLInputElement>('#gen-all');
  all.checked = hidden === 0;
  all.indeterminate = hidden > 0 && hidden < total;
  $('#gen-summary').textContent = hidden ? `(${total - hidden} of ${total} shown)` : '';
}

/** Generations that exist in this tree. */
const allGens = () => [...new Set(state.gens.values())];

function setHiddenGens(hidden: Iterable<number>) {
  state.hiddenGens = new Set(hidden);
  renderLegend();
  rebuildMarkers();
}

const RECENT_MAX = 8;

/** Last people opened, newest first, with the one currently open highlighted. */
function renderRecent() {
  const section = $<HTMLDetailsElement>('#sec-recent');
  section.hidden = state.recent.length === 0;
  $('#recent').innerHTML = state.recent
    .map((id) => personLink(id, id === state.selected ? ' class="current"' : ''))
    .join('');
}

/** Lower-case and strip accents, so "antonio" finds "António". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

let searchActive = -1;
const searchItems = () => [...$('#search-results').querySelectorAll<HTMLLIElement>('li[data-result]')];

/** Highlight one search result (keyboard or mouse) and keep it scrolled into view. */
function setSearchActive(i: number) {
  const items = searchItems();
  searchActive = items.length ? Math.max(0, Math.min(i, items.length - 1)) : -1;
  items.forEach((li, k) => {
    li.classList.toggle('active', k === searchActive);
    li.setAttribute('aria-selected', String(k === searchActive));
  });
  const input = $<HTMLInputElement>('#search');
  if (searchActive >= 0) {
    input.setAttribute('aria-activedescendant', items[searchActive].id);
    items[searchActive].scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}

const MAX_RESULTS = 50;

/** Results float over the menu below the search box; shown while there's a query. */
function setSearchOpen(open: boolean) {
  $('#search-popup').hidden = !open;
  $('#search').setAttribute('aria-expanded', String(open));
}

function renderSearch(q: string) {
  const list = $('#search-results');
  const terms = fold(q.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length || !state.tree) {
    list.innerHTML = '';
    setSearchActive(-1);
    setSearchOpen(false);
    return;
  }
  const all = [...state.tree.people.values()].filter((p) => {
    const name = fold(p.name);
    return terms.every((t) => name.includes(t));
  });
  const hits = all.slice(0, MAX_RESULTS);
  const count = !all.length
    ? 'No matches'
    : all.length > hits.length
      ? `Showing ${hits.length} of ${all.length} matches`
      : `${all.length} ${all.length === 1 ? 'match' : 'matches'}`;
  const keys = all.length ? '<span class="keys"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open</span>' : '';
  $('#search-count').innerHTML = `<span>${count}</span>${keys}`;
  list.innerHTML = hits.map((p, i) => personLink(p.id, ` id="result-${i}" role="option" data-result="${esc(p.id)}"`)).join('');
  setSearchOpen(true);
  // The first match is pre-highlighted, so typing a name and pressing Enter opens it.
  setSearchActive(0);
}

// ---------- Events ----------

async function readFile(file: File) {
  const text = decodeGedcom(await file.arrayBuffer());
  await loadText(text, file.name);
}

$<HTMLInputElement>('#file-input').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) readFile(f);
});

$('#load-sample').addEventListener('click', async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}sample.ged`);
  await loadText(await res.text(), 'sample.ged');
});

$('#load-other').addEventListener('click', () => {
  state.geocodeAbort?.abort();
  $<HTMLInputElement>('#file-input').value = '';
  $<HTMLInputElement>('#file-input').click();
});

const dropzone = $('#dropzone');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('over');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropzone.classList.remove('over');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) readFile(f);
});

$('#progress-stop').addEventListener('click', () => {
  state.geocodeAbort?.abort();
  state.lookupActive = false;
  $('#progress').hidden = true;
  renderStats();
  if (state.selected) renderPerson();
});

const searchInput = $<HTMLInputElement>('#search');
searchInput.addEventListener('input', () => renderSearch(searchInput.value));
searchInput.addEventListener('focus', () => searchInput.value.trim() && renderSearch(searchInput.value));
// Clicking anywhere outside the search box closes the results (the query is kept).
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('.search-box')) setSearchOpen(false);
});
searchInput.addEventListener('keydown', (e) => {
  const items = searchItems();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault(); // don't move the text cursor
    setSearchActive(searchActive + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter') {
    const li = items[searchActive] ?? items[0];
    if (!li) return;
    e.preventDefault();
    select(li.dataset.result!);
  } else if (e.key === 'Escape' && searchInput.value) {
    // Clear the search first; a second Escape then closes the selected person as usual.
    e.stopPropagation();
    searchInput.value = '';
    renderSearch('');
  }
});
// The whole row is clickable, not just the name (clicks on the name itself go through [data-person]).
$('#search-results').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-person]')) return;
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-result]');
  if (li) select(li.dataset.result!);
});
$('#search-results').addEventListener('mousemove', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-result]');
  if (li) setSearchActive(searchItems().indexOf(li));
});

$<HTMLSelectElement>('#line-mode').addEventListener('change', (e) => {
  state.lineMode = (e.target as HTMLSelectElement).value as LineMode;
  if (state.selected) select(state.selected, { pan: false });
});

$<HTMLInputElement>('#cluster').addEventListener('change', (e) => setClustering((e.target as HTMLInputElement).checked));

$<HTMLInputElement>('#flows').addEventListener('change', (e) => {
  state.showFlows = (e.target as HTMLInputElement).checked;
  renderFlows();
});

// ---------- Generations timeline ----------

const TIMELINE_STEP_MS = 2400;
/** How long a step's arrows take to grow from the parents' birthplaces to the children's. */
const GROW_MS = 1200;
let timelineTimer = 0;
let growFrame = 0;
const timelineRange = $<HTMLInputElement>('#timeline-range');

/** Median birth year of a generation, for the timeline label. */
function genMedianYear(g: number): number | undefined {
  const years = [...state.tree!.people.values()]
    .filter((p) => state.gens.get(p.id) === g && p.birth?.year)
    .map((p) => p.birth!.year!)
    .sort((a, b) => a - b);
  return years.length ? years[Math.floor(years.length / 2)] : undefined;
}

/**
 * Show the map up to generation `g` (null turns the timeline off and shows everyone again). With
 * `animate`, generation g's arrows grow out first and its people appear once they arrive.
 */
function setTimeline(g: number | null, animate = false) {
  cancelAnimationFrame(growFrame);
  state.arriving = null;
  state.growProgress = 1;
  state.timeline = g;
  $('#timeline').hidden = g === null;
  if (g !== null) {
    // The slider runs oldest (left) to newest (right); generation numbers run the other way.
    timelineRange.max = String(state.maxGen);
    timelineRange.value = String(state.maxGen - g);
    $('#timeline-gen').textContent = genLabel(g);
    const year = genMedianYear(g);
    $('#timeline-year').textContent = year ? `born ≈ ${year}` : '';
    $('#timeline-dot').style.background = generationColor(g, state.maxGen);
  }
  if (g === null || !animate) {
    rebuildMarkers();
    return;
  }
  // Hide generation g's people and grow its arrows; reveal them when the arrows arrive.
  state.arriving = g;
  state.growProgress = 0;
  rebuildMarkers();
  const start = performance.now();
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / GROW_MS);
    state.growProgress = ease(t);
    if (t < 1) {
      renderFlows();
      growFrame = requestAnimationFrame(tick);
    } else {
      state.arriving = null;
      state.growProgress = 1;
      rebuildMarkers();
    }
  };
  growFrame = requestAnimationFrame(tick);
}

function stopTimeline() {
  clearInterval(timelineTimer);
  timelineTimer = 0;
  $('#timeline').classList.remove('playing');
  $('#timeline-play').setAttribute('aria-label', 'Play');
}

/** Step from the oldest generation to the newest, one generation every TIMELINE_STEP_MS. */
function playTimeline() {
  stopTimeline();
  if (state.timeline === null || state.timeline === 0) setTimeline(state.maxGen, true);
  $('#timeline').classList.add('playing');
  $('#timeline-play').setAttribute('aria-label', 'Pause');
  timelineTimer = window.setInterval(() => {
    if (state.timeline === null || state.timeline <= 0) return stopTimeline();
    setTimeline(state.timeline - 1, true);
    if (state.timeline === 0) stopTimeline();
  }, TIMELINE_STEP_MS);
}

$('#timeline-open').addEventListener('click', () => state.tree && playTimeline());
$('#timeline-play').addEventListener('click', () => (timelineTimer ? stopTimeline() : playTimeline()));
timelineRange.addEventListener('input', () => {
  stopTimeline();
  setTimeline(state.maxGen - Number(timelineRange.value), true);
});
$('#timeline-close').addEventListener('click', () => {
  stopTimeline();
  setTimeline(null);
});
// Clicks and scrolls on the bar shouldn't reach the map underneath.
L.DomEvent.disableClickPropagation($('#timeline'));
L.DomEvent.disableScrollPropagation($('#timeline'));

const VIEW_KEY = 'gedcom-world-map:view';
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    setView(radio.value as MapView);
    try {
      localStorage.setItem(VIEW_KEY, radio.value);
    } catch {
      /* not remembered */
    }
  });
}
try {
  const saved = localStorage.getItem(VIEW_KEY) as MapView | null;
  const radio = saved && document.querySelector<HTMLInputElement>(`input[name="view"][value="${saved}"]`);
  if (radio) {
    radio.checked = true;
    setView(saved!);
  }
} catch {
  /* default view */
}

$('#legend').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const li = box.closest<HTMLElement>('li[data-gen]');
  if (!li || !box.classList.contains('gen-check')) return;
  const g = Number(li.dataset.gen);
  const hidden = new Set(state.hiddenGens);
  if (box.checked) hidden.delete(g);
  else hidden.add(g);
  setHiddenGens(hidden);
});
$('#legend').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.gen-name');
  const li = btn?.closest<HTMLElement>('li[data-gen]');
  if (!li) return;
  const g = Number(li.dataset.gen);
  const others = allGens().filter((x) => x !== g);
  // Show only this generation; clicking it again while it's the only one shown brings all back.
  const alreadySolo = !state.hiddenGens.has(g) && others.every((x) => state.hiddenGens.has(x));
  setHiddenGens(alreadySolo ? [] : others);
});
$<HTMLInputElement>('#gen-all').addEventListener('change', (e) => {
  setHiddenGens((e.target as HTMLInputElement).checked ? [] : allGens());
});

// Any [data-person] link anywhere selects that person.
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-person]');
  if (!a) return;
  e.preventDefault();
  select(a.dataset.person!);
});

for (const ev of ['pointerdown', 'wheel'] as const) {
  map.getContainer().addEventListener(ev, () => (state.viewTouched = true), { passive: true });
}

$('#close-person').addEventListener('click', () => select(null));
map.on('click', () => state.selected && select(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) select(null);
});

// Collapsible menu sections remember whether they were open (per browser; storage may be unavailable).
const SECTIONS_KEY = 'gedcom-world-map:sections';
function loadSectionState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
const sectionState = loadSectionState();
for (const d of document.querySelectorAll<HTMLDetailsElement>('details.section')) {
  if (d.id in sectionState) d.open = sectionState[d.id];
  d.addEventListener('toggle', () => {
    sectionState[d.id] = d.open;
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionState));
    } catch {
      /* not persisted */
    }
  });
}

$('#toggle-sidebar').addEventListener('click', () => {
  document.body.classList.add('sidebar-hidden');
  $('#show-sidebar').hidden = false;
  setTimeout(() => map.invalidateSize(), 250);
});
$('#show-sidebar').addEventListener('click', () => {
  document.body.classList.remove('sidebar-hidden');
  $('#show-sidebar').hidden = true;
  setTimeout(() => map.invalidateSize(), 250);
});

// ---------- Tree view ----------

mountTreeView($('#tree-root'), {
  current: () => (state.tree ? { tree: state.tree, name: $('#file-name').textContent ?? '' } : null),
  show(tree, name, personId) {
    if (tree !== state.tree) void loadTree(tree, name);
    if (personId && state.tree?.people.has(personId)) select(personId);
  },
  shown: () => map.invalidateSize(),
});
