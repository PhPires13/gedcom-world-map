// The public, read-only map of a shared family (share.html?id=…): people at their birthplaces
// coloured by generation, migration arrows (the map app's own, src/map/flow-layer.ts), a timeline
// that plays the generations in, and the way to a print. No upload, no tree, no editing.

import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '../style.css';
import './share.css';

import { generationColor } from '../colors';
import { formatNumber, makeT, onLocaleChange, translateStatic } from '../i18n/core';
import { mapMessages } from '../i18n/messages/map';
import { shareMessages } from '../i18n/messages/share';
import { mountLanguageSwitcher } from '../i18n/switcher';
import { drawFlows } from '../map/flow-layer';
import { ApiError } from '../tree/api';
import { shareApi } from './api';
import type { SharedMap, SharePerson } from './snapshot';

const tm = makeT(mapMessages);
const ts = makeT(shareMessages);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface ViewPerson {
  name: string;
  parents: string[];
  birth?: { year?: number };
}

const state = {
  shared: null as SharedMap | null,
  people: new Map<string, ViewPerson>(),
  located: new Map<string, { lat: number; lon: number; place: string }>(),
  gens: new Map<string, number>(),
  maxGen: 0,
  /** Timeline: the generation shown so far (0 = most recent), or null for everyone. */
  timeline: null as number | null,
  /** During a timeline step: the generation whose arrows are still growing, and how far (0..1). */
  arriving: null as number | null,
  growProgress: 1,
};

// ---------- Map ----------

const map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([30, 0], 2);
let zoomControl: L.Control.Zoom | null = null;
function addZoomControl() {
  zoomControl?.remove();
  zoomControl = L.control.zoom({ position: 'topright', zoomInTitle: tm('map.zoomIn'), zoomOutTitle: tm('map.zoomOut') }).addTo(map);
}
addZoomControl();
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  className: 'base-tiles',
}).addTo(map);

map.createPane('flows');
map.getPane('flows')!.style.zIndex = '445';
const flowsRenderer = L.canvas({ pane: 'flows' });
const flowsLayer = L.layerGroup([], { pane: 'flows' }).addTo(map);

const markers = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, iconCreateFunction: (c) => pieIcon(c.getAllChildMarkers().map(idOf)) }).addTo(map);
const idOf = (m: L.Marker) => (m.options as L.MarkerOptions & { personId: string }).personId;

const genLabel = (g: number) => tm('gens.label', { n: formatNumber(g + 1) });
const genVisible = (g: number) => state.timeline === null || g >= state.timeline;
const genShown = (g: number) => genVisible(g) && g !== state.arriving;
const genFaded = (g: number) => state.timeline !== null && g > state.timeline;

/** A disk split by generation colour with a head count (the map app's cluster look). */
function pieIcon(ids: string[]) {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(state.gens.get(id) ?? 0, (counts.get(state.gens.get(id) ?? 0) ?? 0) + 1);
  let acc = 0;
  const stops = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, n]) => {
      const from = (acc / ids.length) * 360;
      acc += n;
      return `${generationColor(g, state.maxGen)}${genFaded(g) ? '59' : ''} ${from}deg ${(acc / ids.length) * 360}deg`;
    })
    .join(', ');
  const size = ids.length < 10 ? 34 : ids.length < 100 ? 42 : 50;
  return L.divIcon({
    html: `<div class="pie" style="background: conic-gradient(${stops})"><span>${formatNumber(ids.length)}</span></div>`,
    className: 'cluster',
    iconSize: [size, size],
  });
}

function tooltip(p: SharePerson) {
  const born = p.birthYear ? ` <span class="muted">${esc(ts('viewer.born', { year: p.birthYear }))}</span>` : '';
  return `<b>${esc(p.name)}</b>${born}<br>${esc(p.place)}<br><span class="muted">${esc(genLabel(p.gen))}</span>`;
}

function renderMarkers() {
  markers.clearLayers();
  const shared = state.shared;
  if (!shared) return;
  const list: L.Marker[] = [];
  for (const p of shared.snapshot.people) {
    if (!genShown(p.gen)) continue;
    const icon = L.divIcon({
      className: `person-pin${genFaded(p.gen) ? ' faded' : ''}`,
      html: `<span style="background:${generationColor(p.gen, state.maxGen)}"></span>`,
      iconSize: [14, 14],
    });
    const m = L.marker([p.lat, p.lon], { icon, personId: p.id, riseOnHover: true } as L.MarkerOptions);
    m.bindTooltip(tooltip(p), { direction: 'top', offset: [0, -8] });
    list.push(m);
  }
  markers.addLayers(list);
  renderFlows();
}

function renderFlows() {
  flowsLayer.clearLayers();
  if (!state.shared) return;
  drawFlows({
    map,
    layer: flowsLayer,
    renderer: flowsRenderer,
    people: state.people,
    located: state.located,
    gens: state.gens,
    maxGen: state.maxGen,
    shown: (_moverGen, childGen) => state.timeline === null || childGen >= state.timeline,
    faded: genFaded,
    arriving: state.arriving,
    growProgress: state.growProgress,
    selected: null,
    genLabel,
  });
}

map.on('zoomend', renderFlows);

// ---------- Header, legend ----------

function renderHead() {
  const shared = state.shared;
  if (!shared) return;
  const family = shared.family;
  const s = shared.summary;
  document.title = ts('viewer.pageTitle', { family });
  $('#share-title').removeAttribute('data-i18n');
  $('#share-title').textContent = ts('viewer.family', { family });
  const years = s.fromYear !== undefined && s.toYear !== undefined && s.fromYear !== s.toYear ? `${s.fromYear}–${s.toYear}` : '';
  $('#share-sub').textContent = [
    ts('viewer.subtitle'),
    ts('viewer.people', { count: s.people, n: formatNumber(s.people) }),
    ts('viewer.generations', { count: s.generations, n: formatNumber(s.generations) }),
    years,
  ]
    .filter(Boolean)
    .join(' · ');

  const byGen = new Map<number, number[]>();
  for (const p of shared.snapshot.people) {
    const ys = byGen.get(p.gen) ?? [];
    if (p.birthYear) ys.push(p.birthYear);
    byGen.set(p.gen, ys);
  }
  $('#share-legend').innerHTML = [...byGen.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([g, ys]) => {
      ys.sort((a, b) => a - b);
      const median = ys.length ? tm('gens.born', { year: ys[Math.floor(ys.length / 2)] }) : '';
      return `<li class="${state.timeline !== null && g < state.timeline ? 'off' : genFaded(g) ? 'faded' : ''}"><i class="dot" style="background:${generationColor(g, state.maxGen)}"></i>${esc(genLabel(g))} <span class="muted">${esc(median)}</span></li>`;
    })
    .join('');
}

// ---------- Timeline ----------

const TIMELINE_STEP_MS = 2400;
const GROW_MS = 1200;
let timelineTimer = 0;
let growFrame = 0;
const range = $<HTMLInputElement>('#timeline-range');

function medianYear(g: number): number | undefined {
  const ys = state.shared!.snapshot.people.filter((p) => p.gen === g && p.birthYear).map((p) => p.birthYear!);
  ys.sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : undefined;
}

function renderTimelineLabel() {
  const g = state.timeline;
  const dot = $('#timeline-dot');
  if (g === null) {
    $('#timeline-gen').textContent = ts('viewer.play');
    $('#timeline-year').textContent = '';
    dot.hidden = true;
  } else {
    $('#timeline-gen').textContent = genLabel(g);
    const year = medianYear(g);
    $('#timeline-year').textContent = year ? tm('gens.born', { year }) : '';
    dot.hidden = false;
    dot.style.background = generationColor(g, state.maxGen);
  }
  const label = tm(timelineTimer ? 'timeline.pause' : 'timeline.play');
  $('#timeline-play').setAttribute('aria-label', label);
  $('#timeline-play').title = label;
}

function setTimeline(g: number | null, animate = false) {
  cancelAnimationFrame(growFrame);
  state.arriving = null;
  state.growProgress = 1;
  state.timeline = g;
  range.max = String(state.maxGen);
  range.value = String(g === null ? state.maxGen : state.maxGen - g);
  renderTimelineLabel();
  renderHead();
  if (g === null || !animate) return renderMarkers();
  // Generation g's arrows grow out first; its people appear when they arrive.
  state.arriving = g;
  state.growProgress = 0;
  renderMarkers();
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / GROW_MS);
    state.growProgress = 1 - (1 - k) ** 3;
    if (k < 1) {
      renderFlows();
      growFrame = requestAnimationFrame(tick);
    } else {
      state.arriving = null;
      state.growProgress = 1;
      renderMarkers();
    }
  };
  growFrame = requestAnimationFrame(tick);
}

function stopTimeline() {
  clearInterval(timelineTimer);
  timelineTimer = 0;
  $('#timeline').classList.remove('playing');
  renderTimelineLabel();
}

function playTimeline() {
  stopTimeline();
  if (state.timeline === null || state.timeline === 0) setTimeline(state.maxGen, true);
  $('#timeline').classList.add('playing');
  timelineTimer = window.setInterval(() => {
    if (state.timeline === null || state.timeline <= 0) return stopTimeline();
    setTimeline(state.timeline - 1, true);
    if (state.timeline === 0) stopTimeline();
  }, TIMELINE_STEP_MS);
  renderTimelineLabel();
}

$('#timeline-play').addEventListener('click', () => (timelineTimer ? stopTimeline() : playTimeline()));
range.addEventListener('input', () => {
  stopTimeline();
  setTimeline(state.maxGen - Number(range.value), true);
});

// Clicks and scrolls on the panels shouldn't reach the map underneath.
for (const sel of ['#share-head', '#share-cta', '#timeline', '#share-message']) {
  L.DomEvent.disableClickPropagation($(sel));
  L.DomEvent.disableScrollPropagation($(sel));
}

// ---------- Loading ----------

function showMessage(text: string) {
  const box = $('#share-message');
  box.textContent = text;
  box.hidden = false;
  $('#share-head').hidden = true;
}

function show(shared: SharedMap) {
  state.shared = shared;
  for (const p of shared.snapshot.people) {
    state.people.set(p.id, { name: p.name, parents: p.parents, birth: { year: p.birthYear } });
    state.located.set(p.id, { lat: p.lat, lon: p.lon, place: p.place });
    state.gens.set(p.id, p.gen);
  }
  state.maxGen = Math.max(0, ...state.gens.values());
  const pts = shared.snapshot.people.map((p) => L.latLng(p.lat, p.lon));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 8 });
  $('#timeline').hidden = state.maxGen === 0;
  range.max = String(state.maxGen);
  range.value = String(state.maxGen);
  renderHead();
  renderTimelineLabel();
  renderMarkers();
}

let failure: 'notFound' | 'error' | null = null;
async function load() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{24}$/.test(id)) {
    failure = 'notFound';
    return showMessage(ts('viewer.notFound'));
  }
  try {
    show(await shareApi.get(id));
  } catch (e) {
    failure = e instanceof ApiError && e.status === 404 ? 'notFound' : 'error';
    showMessage(ts(failure === 'notFound' ? 'viewer.notFound' : 'viewer.error'));
  }
}

// ---------- Language ----------

function translatePage() {
  translateStatic(document.body, tm);
  translateStatic(document.body, ts);
}

mountLanguageSwitcher($('#lang-switch'));
translatePage();
onLocaleChange(() => {
  translatePage();
  addZoomControl();
  if (failure) showMessage(ts(failure === 'notFound' ? 'viewer.notFound' : 'viewer.error'));
  if (!state.shared) return;
  renderHead();
  renderTimelineLabel();
  renderMarkers();
});

void load();
