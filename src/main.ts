import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './style.css';

import { decodeGedcom, originEvent, parseGedcom, type Person, type Tree } from './gedcom';
import { computeGenerations } from './generations';
import { Geocoder } from './geocode';
import { generationColor } from './colors';

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

interface PersonMarkerOptions extends L.MarkerOptions {
  personId: string;
}

type LineMode = 'family' | 'ancestors' | 'descendants' | 'all';

const state = {
  tree: null as Tree | null,
  gens: new Map<string, number>(),
  maxGen: 0,
  located: new Map<string, Located>(),
  markers: new Map<string, L.Marker>(),
  selected: null as string | null,
  related: new Set<string>(),
  lineMode: 'family' as LineMode,
  hiddenGens: new Set<number>(),
  clustering: true,
  geocodeAbort: null as AbortController | null,
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

function makeCluster() {
  return L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: clusterIcon,
  });
}

let markerLayer: L.FeatureGroup = makeCluster().addTo(map);

function clusterIcon(cluster: L.MarkerCluster) {
  const counts = new Map<number, number>();
  for (const m of cluster.getAllChildMarkers()) {
    const g = state.gens.get((m.options as PersonMarkerOptions).personId) ?? 0;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = cluster.getChildCount();
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
  const related = cluster.getAllChildMarkers().some((m) => isHighlighted((m.options as PersonMarkerOptions).personId));
  const dim = state.selected && !related ? ' dim' : '';
  return L.divIcon({
    html: `<div class="pie" style="background: conic-gradient(${stops})"><span>${total}</span></div>`,
    className: `cluster${dim}`,
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

function personIcon(id: string) {
  const g = state.gens.get(id) ?? 0;
  const p = state.tree!.people.get(id)!;
  const cls = ['person-pin'];
  if (id === state.selected) cls.push('selected');
  else if (state.selected && !state.related.has(id)) cls.push('dim');
  if (p.sex === 'M') cls.push('male');
  if (p.sex === 'F') cls.push('female');
  const size = id === state.selected ? 22 : 14;
  return L.divIcon({
    className: cls.join(' '),
    html: `<span style="background:${generationColor(g, state.maxGen)}"></span>`,
    iconSize: [size, size],
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
  state.markers.clear();
  markerLayer.clearLayers();
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

  for (const id of state.located.keys()) addMarker(id);
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
          addMarker(id);
        }
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
  if (state.selected) drawLines();
  if (!abort.signal.aborted) fitToMarkers();
}

// ---------- Markers ----------

function addMarker(id: string) {
  const loc = state.located.get(id)!;
  const existing = state.markers.get(id);
  if (existing) markerLayer.removeLayer(existing);
  const p = state.tree!.people.get(id)!;
  const marker = L.marker([loc.lat, loc.lon], {
    icon: personIcon(id),
    personId: id,
    title: p.name,
    riseOnHover: true,
  } as PersonMarkerOptions);
  marker.bindTooltip(`<b>${esc(p.name)}</b> ${lifespan(p)}<br>${esc(loc.place)}`, { direction: 'top', offset: [0, -8] });
  marker.on('click', () => select(id, { pan: false }));
  state.markers.set(id, marker);
  if (!state.hiddenGens.has(state.gens.get(id) ?? 0)) markerLayer.addLayer(marker);
}

function refreshIcons() {
  for (const [id, m] of state.markers) m.setIcon(personIcon(id));
  if (markerLayer instanceof L.MarkerClusterGroup) markerLayer.refreshClusters();
}

function applyVisibility() {
  for (const [id, m] of state.markers) {
    const hidden = state.hiddenGens.has(state.gens.get(id) ?? 0);
    const on = markerLayer.hasLayer(m);
    if (hidden && on) markerLayer.removeLayer(m);
    if (!hidden && !on) markerLayer.addLayer(m);
  }
}

function setClustering(on: boolean) {
  state.clustering = on;
  map.removeLayer(markerLayer);
  markerLayer = on ? makeCluster() : L.featureGroup();
  markerLayer.addTo(map);
  applyVisibility();
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

function drawLines() {
  linesLayer.clearLayers();
  if (!state.selected) return;
  const { edges, related } = computeEdges(state.selected);
  state.related = related;

  for (const e of edges) {
    const a = state.located.get(e.from)!;
    const b = state.located.get(e.to)!;
    const pts: L.LatLngExpression[] = [
      [a.lat, a.lon],
      [b.lat, b.lon],
    ];
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
  return edges;
}

function select(id: string | null, opts: { pan: boolean } = { pan: true }) {
  state.selected = id;
  state.related = new Set();
  const edges = drawLines() ?? [];
  refreshIcons();
  $('#line-legend').hidden = !id;
  renderPerson();

  if (id && opts.pan) {
    const ids = [id, ...edges.map((e) => e.to)].filter((x) => state.located.has(x));
    const pts = ids.map((x) => L.latLng(state.located.get(x)!.lat, state.located.get(x)!.lon));
    // Keep the family clear of the info panel floating over the right side of the map.
    const panelW = window.innerWidth > 720 ? $('#person-panel').offsetWidth + 70 : 40;
    const fit = { paddingTopLeft: [60, 60] as L.PointTuple, paddingBottomRight: [panelW, 60] as L.PointTuple };
    if (pts.length === 1 || L.latLngBounds(pts).getNorthEast().equals(L.latLngBounds(pts).getSouthWest())) {
      const m = state.markers.get(ids[0])!;
      if (markerLayer instanceof L.MarkerClusterGroup && markerLayer.hasLayer(m)) {
        markerLayer.zoomToShowLayer(m);
      } else map.flyTo(pts[0], Math.max(map.getZoom(), 7));
    } else if (pts.length > 1) {
      map.flyToBounds(L.latLngBounds(pts), { ...fit, maxZoom: 9, duration: 0.8 });
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
  applyVisibility();
});

// Any [data-person] link anywhere selects that person.
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-person]');
  if (!a) return;
  e.preventDefault();
  select(a.dataset.person!);
});

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
