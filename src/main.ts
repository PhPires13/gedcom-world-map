import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './style.css';

import { decodeGedcom, originEvent, parseGedcom, type Person, type Tree } from './gedcom';
import { computeGenerations } from './generations';
import { Geocoder } from './geocode';
import { generationColor } from './colors';
import { DOT, DOTS_FROM_ZOOM, layoutSpot, spreadBox, spreadScale, type SpotLayout } from './spots';

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
      return `${generationColor(g, state.maxGen)} ${from}deg ${(acc / total) * 360}deg`;
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
  state.geocodeAbort?.abort();
  const tree = parseGedcom(text);
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
  $<HTMLInputElement>('#search').value = '';
  $('#search-results').innerHTML = '';

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
    } catch (e) {
      if (abort.signal.aborted) break;
      failed++;
      console.warn('Geocoding error for', place, e);
      if (failed >= 5) {
        $('#progress-label').textContent = 'Place lookup is failing — check your connection.';
        state.geocodeAbort = null;
        return;
      }
    }
    if (i % 5 === 0) renderStats();
  }

  progress.hidden = true;
  state.geocodeAbort = null;
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
    if (state.hiddenGens.has(state.gens.get(id) ?? 0)) continue;
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
  markerLayer.addTo(map);
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
    if (!layout || townAsDisk() || !spotVisible(marker)) continue;
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
  if (!marker || !(marker.options as SpotMarkerOptions).layout || townAsDisk() || !spotVisible(marker)) return [a, b];

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
  renderOverlays();
});

function select(id: string | null, opts: { pan: boolean } = { pan: true }) {
  state.selected = id;
  if (id) state.viewTouched = true;
  const { edges, related } = id ? computeEdges(id) : { edges: [], related: new Set<string>() };
  state.edges = edges;
  state.related = related;
  syncPinned();
  refreshIcons();
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

function personLink(id: string) {
  const p = state.tree!.people.get(id);
  if (!p) return '';
  const g = state.gens.get(id) ?? 0;
  const noLoc = state.located.has(id) ? '' : ' <em class="muted">· no location</em>';
  return `<li><a href="#" data-person="${esc(id)}"><i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>${esc(p.name)}</a> <span class="muted">${lifespan(p)}</span>${noLoc}</li>`;
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
    ids.length ? `<h3>${title}</h3><ul class="people">${ids.map(personLink).join('')}</ul>` : '';

  let locNote = '';
  if (!loc) {
    locNote = originEvent(p)
      ? `<p class="note">Birth place couldn’t be found on the map.</p>`
      : `<p class="note">No birth place recorded — not shown on the map.</p>`;
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
  $('#stats').innerHTML = `<strong>${total.toLocaleString()}</strong> people · <strong>${onMap.toLocaleString()}</strong> on the map · <strong>${state.maxGen + 1}</strong> generations`;

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
    const tag = g === 0 ? ' · most recent' : g === state.maxGen ? ' · oldest' : '';
    rows.push(
      `<li class="${state.hiddenGens.has(g) ? 'off' : ''}" data-gen="${g}">
        <i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>
        <span>${genLabel(g)}<small>${tag}</small></span>
        <span class="muted">${median}</span>
        <span class="count">${e.count}</span>
      </li>`,
    );
  }
  $('#legend').innerHTML = rows.join('');
}

function renderSearch(q: string) {
  const list = $('#search-results');
  q = q.trim().toLowerCase();
  if (!q || !state.tree) {
    list.innerHTML = '';
    return;
  }
  const terms = q.split(/\s+/);
  const hits = [...state.tree.people.values()]
    .filter((p) => terms.every((t) => p.name.toLowerCase().includes(t)))
    .slice(0, 30);
  list.innerHTML = hits.length ? hits.map((p) => personLink(p.id)).join('') : '<li class="muted">No matches</li>';
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
  $('#progress').hidden = true;
  renderStats();
});

$<HTMLInputElement>('#search').addEventListener('input', (e) => renderSearch((e.target as HTMLInputElement).value));

$<HTMLSelectElement>('#line-mode').addEventListener('change', (e) => {
  state.lineMode = (e.target as HTMLSelectElement).value as LineMode;
  if (state.selected) select(state.selected, { pan: false });
});

$<HTMLInputElement>('#cluster').addEventListener('change', (e) => setClustering((e.target as HTMLInputElement).checked));

$('#legend').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-gen]');
  if (!li) return;
  const g = Number(li.dataset.gen);
  if (state.hiddenGens.has(g)) state.hiddenGens.delete(g);
  else state.hiddenGens.add(g);
  li.classList.toggle('off');
  rebuildMarkers();
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
