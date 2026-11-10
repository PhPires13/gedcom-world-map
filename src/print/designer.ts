// The print designer page (print.html): load a tree, choose a style and what to show, preview the
// print live and export it as SVG, 300 dpi PNG or PDF, or order it (shop.ts). Everything but the
// order runs in the browser.
//
// The preview is the tree's PUBLIC view: people presumed living (or marked private) are left off,
// exactly as on the print the server makes for an order.

import './designer.css';
import { originEvent, parseGedcom, decodeGedcom, type Tree } from '../gedcom';
import { localTreeDetail, toGedcomTree } from '../model';
import { api, serverAvailable } from '../tree/api';
import { computeGenerations } from '../generations';
import { Geocoder } from '../geocode';
import { loadFlags, loadStyleFonts, loadTopology } from './assets-browser';
import { CountryLocator } from './countries';
import { buildPrintData, defaultRoot, type Branch, type Located } from './data';
import { BORDERS, FINISHES, LAYOUTS, borderById, finishById, layoutById } from './catalog';
import { mmToPx, pageSize } from './geo';
import { setPngDpi } from './png';
import { initShop } from './shop';
import { defaultTexts, renderHeritageMap, topologyDetailFor } from './render';
import { STYLES, styleById } from './styles';
import type { AreaId, Lang, Orientation, PaperSize, PrintAssets, PrintData, PrintOptions } from './types';
import type { Topology } from 'topojson-specification';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const val = (id: string) => $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`).value;
const checked = (id: string) => $<HTMLInputElement>(`#${id}`).checked;

const geocoder = new Geocoder();
const state = {
  tree: null as Tree | null,
  gens: new Map<string, number>(),
  located: new Map<string, Located>(),
  /** Places not found in the geocoding cache yet → people born there. */
  pending: new Map<string, string[]>(),
  fileName: '',
  titleTouched: false,
  subtitleTouched: false,
  geocoding: null as AbortController | null,
  /** GEDCOM text of a tree opened from a file (imported to the server when ordering). */
  gedText: '',
  /** The tree on the server, once known (opened from there, or imported for an order). */
  serverTreeId: '',
  /** Designer person id → server person id (GEDCOM xref → id after an import). */
  serverIds: new Map<string, string>(),
  /** People kept off the map because they are presumed living or marked private. */
  privateCount: 0,
};

// ---------- Loading a tree ----------

function loadText(text: string, fileName: string) {
  const tree = parseGedcom(text);
  if (!tree.people.size) {
    alert(`No people found in “${fileName}”. Is it a GEDCOM file?`);
    return;
  }
  // The living rule, as the server applies it: these people never reach the print.
  const detail = localTreeDetail(tree, fileName, new Date().getFullYear());
  const hidden = new Set(detail.people.filter((p) => p.isPrivate).map((p) => p.id));
  loadTree(tree, fileName, hidden, { gedText: text });
}

/** A tree saved on the server, in its public view. */
async function loadServerTree(treeId: string) {
  const detail = await api.getTreeView(treeId, 'public');
  const tree = toGedcomTree(detail);
  const hidden = new Set(detail.people.filter((p) => p.isPrivate).map((p) => p.id));
  loadTree(tree, detail.tree.name, hidden, { serverTreeId: treeId });
}

function loadTree(tree: Tree, fileName: string, hidden: Set<string>, from: { gedText?: string; serverTreeId?: string }) {
  state.geocoding?.abort();
  state.tree = tree;
  state.fileName = fileName;
  state.gedText = from.gedText ?? '';
  state.serverTreeId = from.serverTreeId ?? '';
  state.serverIds = new Map(from.serverTreeId ? [...tree.people.keys()].map((id) => [id, id]) : []);
  state.privateCount = hidden.size;
  state.gens = computeGenerations(tree);
  state.located = new Map();
  state.pending = new Map();
  state.titleTouched = false;
  state.subtitleTouched = false;
  // Coordinates from the file, else from the map app's geocoding cache (same browser storage).
  for (const p of tree.people.values()) {
    if (hidden.has(p.id)) continue;
    const ev = originEvent(p)?.event;
    if (!ev) continue;
    if (ev.lat !== undefined && ev.lon !== undefined) state.located.set(p.id, { lat: ev.lat, lon: ev.lon, place: ev.place ?? '' });
    else if (ev.place) {
      const c = geocoder.cached(ev.place);
      if (c) state.located.set(p.id, { lat: c.lat, lon: c.lon, place: ev.place });
      else if (c === undefined) state.pending.set(ev.place, [...(state.pending.get(ev.place) ?? []), p.id]);
    }
  }
  fillPeople();
  fillGenerations();
  $<HTMLFieldSetElement>('#design').disabled = false;
  updateStatus();
  scheduleRender(0);
}

function updateStatus() {
  const t = state.tree;
  if (!t) return;
  const placed = state.located.size;
  $('#tree-status').textContent =
    `${state.fileName}: ${t.people.size} people, ${placed} placed on the map.` +
    (state.privateCount ? ` ${state.privateCount} presumed living or private ${state.privateCount === 1 ? 'is' : 'are'} left off, as on the printed map.` : '');
  const n = state.pending.size;
  $('#geocode-box').hidden = !n && !state.geocoding;
  if (!state.geocoding) $('#geocode').textContent = `Find ${n} more place${n === 1 ? '' : 's'} (about ${Math.ceil(n * 1.2)} s)`;
}

async function geocodePending() {
  if (state.geocoding) {
    state.geocoding.abort();
    return;
  }
  const abort = new AbortController();
  state.geocoding = abort;
  const places = [...state.pending.keys()];
  let failed = 0;
  for (const [i, place] of places.entries()) {
    if (abort.signal.aborted) break;
    $('#geocode').textContent = `Finding places… ${i}/${places.length} (stop)`;
    $('#geocode-fill').style.width = `${(i / places.length) * 100}%`;
    try {
      const c = await geocoder.geocode(place, abort.signal);
      if (c) for (const id of state.pending.get(place)!) state.located.set(id, { lat: c.lat, lon: c.lon, place });
      state.pending.delete(place);
      updateStatus();
      scheduleRender(800);
    } catch (e) {
      if (abort.signal.aborted) break;
      console.warn('Geocoding failed for', place, e);
      if (++failed >= 5) break;
    }
  }
  state.geocoding = null;
  $('#geocode-fill').style.width = '0';
  updateStatus();
  scheduleRender(0);
}

// ---------- Controls ----------

const yearSpan = (ys: number[]) => (ys.length ? (Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)}–${Math.max(...ys)}`) : '');

function fillPeople() {
  const t = state.tree!;
  const root = defaultRoot(t, state.gens);
  const people = [...t.people.values()].sort(
    (a, b) => (state.gens.get(a.id) ?? 0) - (state.gens.get(b.id) ?? 0) || (b.birth?.year ?? 0) - (a.birth?.year ?? 0),
  );
  $('#root').innerHTML = people
    .map((p) => `<option value="${p.id}"${p.id === root ? ' selected' : ''}>${escapeHtml(p.name)}${p.birth?.year ? ` (${p.birth.year})` : ''}</option>`)
    .join('');
}

function fillGenerations() {
  const t = state.tree!;
  const byGen = new Map<number, number[]>();
  for (const p of t.people.values()) {
    const g = state.gens.get(p.id) ?? 0;
    const list = byGen.get(g) ?? [];
    if (p.birth?.year) list.push(p.birth.year);
    byGen.set(g, list);
  }
  $('#gens').innerHTML = [...byGen.keys()]
    .sort((a, b) => b - a)
    .map((g) => {
      const span = yearSpan(byGen.get(g)!);
      return `<label title="Generation ${g + 1} counting from the youngest"><input type="checkbox" data-gen="${g}" checked /> ${span ? `Born ${span}` : `Generation ${g + 1}`}</label>`;
    })
    .join('');
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function selectedGenerations(): number[] | undefined {
  const boxes = [...document.querySelectorAll<HTMLInputElement>('#gens input')];
  if (boxes.every((b) => b.checked)) return undefined;
  return boxes.filter((b) => b.checked).map((b) => Number(b.dataset.gen));
}

function currentData(): PrintData {
  return buildPrintData(state.tree!, state.located, state.gens, {
    rootId: val('root'),
    branch: val('branch') as Branch,
    generations: selectedGenerations(),
  });
}

function currentOptions(data: PrintData): PrintOptions {
  const lang = val('lang') as Lang;
  const defaults = defaultTexts(data, lang, val('root'));
  if (!state.titleTouched) $<HTMLInputElement>('#title').value = defaults.title;
  if (!state.subtitleTouched) $<HTMLInputElement>('#subtitle').value = defaults.subtitle;
  return {
    style: styleById(val('style')),
    paper: val('paper') as PaperSize,
    orientation: val('orientation') as Orientation,
    area: val('area') as AreaId,
    lang,
    title: val('title'),
    subtitle: val('subtitle'),
    dedication: val('dedication'),
    show: {
      dates: checked('show-dates'),
      placeNames: checked('show-placeNames'),
      flags: val('flags') as PrintOptions['show']['flags'],
      countryNames: checked('show-countryNames'),
      oceanNames: checked('show-oceanNames'),
      compass: checked('show-compass'),
      scaleBar: checked('show-scaleBar'),
      legend: checked('show-legend'),
      graticule: checked('show-graticule'),
      surnames: checked('show-surnames'),
    },
    layout: layoutById(val('layout')),
    border: borderById(val('border')),
    finish: finishById(val('finish')),
    flagScale: Number(val('flag-size')) || 1,
    routes: val('routes') === 'detailed' ? 'detailed' : 'essential',
  };
}

// ---------- Rendering ----------

const locators = new WeakMap<Topology, CountryLocator>();

/** Everything the renderer needs for these options: map detail for the scale, flags, fonts. */
async function assetsFor(data: PrintData, o: PrintOptions, embedFonts: boolean): Promise<PrintAssets> {
  const topology = await loadTopology(topologyDetailFor(data, o));
  let locator = locators.get(topology);
  if (!locator) locators.set(topology, (locator = new CountryLocator(topology)));
  const codes = new Set(data.people.map((p) => locator.locate(p)).filter(Boolean));
  const [flags, fonts] = await Promise.all([loadFlags(codes), loadStyleFonts(o.style)]);
  return { topology, flags, fontCss: embedFonts ? fonts.css : '', measure: fonts.measure };
}

let renderTimer = 0;
let renderSeq = 0;
function scheduleRender(delay = 150) {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, delay);
}

async function render() {
  if (!state.tree) return;
  const seq = ++renderSeq;
  const sheet = $('#sheet');
  sheet.classList.add('busy');
  try {
    const data = currentData();
    const o = currentOptions(data);
    $('#style-desc').textContent = o.style.description ?? '';
    // Only the geographic layout uses the chosen area; the others always fit the family.
    $<HTMLSelectElement>('#area').disabled = !!o.layout && (o.layout.kind !== 'accurate' || !!o.layout.fitFamily);
    const assets = await assetsFor(data, o, false);
    if (seq !== renderSeq) return;
    const t0 = performance.now();
    const res = renderHeritageMap(data, o, assets);
    console.debug(`Rendered print in ${Math.round(performance.now() - t0)} ms (${Math.round(res.svg.length / 1024)} kB)`);
    sheet.style.setProperty('--aspect', String(res.width / res.height));
    sheet.innerHTML = res.svg;
    const warnings = [...res.warnings];
    if (!data.people.length) warnings.push('Nobody in this selection has a known place of birth yet.');
    if (state.pending.size) warnings.push(`${state.pending.size} places haven't been looked up yet, so some people are missing.`);
    $('#warnings').hidden = !warnings.length;
    $('#warnings').innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  } catch (e) {
    console.error(e);
    sheet.innerHTML = `<p class="empty">Couldn't draw the print: ${escapeHtml(String(e))}</p>`;
  } finally {
    if (seq === renderSeq) sheet.classList.remove('busy');
  }
}

// ---------- Export ----------

const DPI = 300;

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Draws an SVG document onto a canvas of the given pixel size. */
async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(width, height);
    img.src = url;
    await img.decode();
    // Give embedded fonts a moment: the first paint of an SVG image can come before they're ready.
    await new Promise((r) => setTimeout(r, 300));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`The browser can't make an image this large (${width}×${height} px).`);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality));

/** The print as a file: SVG, PNG at 300 dpi, or PDF (the 300 dpi image on a page of the paper size). */
export async function exportBlob(kind: 'svg' | 'png' | 'pdf'): Promise<{ blob: Blob; name: string }> {
  const data = currentData();
  const o = currentOptions(data);
  const assets = await assetsFor(data, o, true);
  const name = ['heritage-map', o.style.id, o.layout?.id, o.border?.id, o.finish?.id, o.paper, o.orientation].filter(Boolean).join('-');
  if (kind === 'svg') return { blob: new Blob([renderHeritageMap(data, o, assets).svg], { type: 'image/svg+xml' }), name: `${name}.svg` };
  const { w, h } = pageSize(o.paper, o.orientation);
  const px = { width: mmToPx(w, DPI), height: mmToPx(h, DPI) };
  const res = renderHeritageMap(data, { ...o, pixelSize: px }, assets);
  const canvas = await rasterize(res.svg, px.width, px.height);
  if (kind === 'png') {
    const png = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
    return { blob: new Blob([setPngDpi(png, DPI) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), name: `${name}-300dpi.png` };
  }
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: o.orientation, unit: 'mm', format: [w, h], compress: true });
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer());
  doc.addImage(jpeg, 'JPEG', 0, 0, w, h, undefined, 'NONE');
  doc.setProperties({ title: o.title || 'Heritage map', creator: 'GEDCOM World Map' });
  return { blob: doc.output('blob'), name: `${name}.pdf` };
}

async function exportFile(kind: 'svg' | 'png' | 'pdf') {
  const status = $('#export-status');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-export]')];
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = kind === 'svg' ? 'Preparing SVG…' : `Drawing at ${DPI} dpi… this can take a little while.`;
  try {
    const t0 = performance.now();
    const { blob, name } = await exportBlob(kind);
    download(blob, name);
    status.textContent = `Saved ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB, ${((performance.now() - t0) / 1000).toFixed(1)} s).`;
  } catch (e) {
    console.error(e);
    status.textContent = `Export failed: ${String(e)}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- Wiring ----------

$('#style').innerHTML = STYLES.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
const optionList = (items: { id: string; name: string; description?: string }[], none?: string) =>
  (none ? `<option value="">${escapeHtml(none)}</option>` : '') +
  items.map((x) => `<option value="${x.id}" title="${escapeHtml(x.description ?? '')}">${escapeHtml(x.name)}</option>`).join('');
$('#layout').innerHTML = optionList(LAYOUTS);
$('#border').innerHTML = optionList(BORDERS, "The style's own frame");
$('#finish').innerHTML = optionList(FINISHES, "The style's own paper");
// The frame around the preview is only a mock-up of the finished object; it isn't exported.
$('#mockup').addEventListener('change', () => ($('#stage').dataset.frame = val('mockup')));

$<HTMLInputElement>('#file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadText(decodeGedcom(await file.arrayBuffer()), file.name);
});
// Trees saved on the server (the tree view's), when the API is running.
void serverAvailable().then(async (up) => {
  if (!up) return;
  const trees = await api.listTrees().catch(() => []);
  if (!trees.length) return;
  const sel = $<HTMLSelectElement>('#saved-tree');
  sel.innerHTML = `<option value="">Open a saved tree…</option>` + trees.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.peopleCount} people)</option>`).join('');
  sel.hidden = false;
  const wanted = new URLSearchParams(location.search).get('tree');
  if (wanted && trees.some((t) => t.id === wanted)) {
    sel.value = wanted;
    await loadServerTree(wanted);
  }
});
$<HTMLSelectElement>('#saved-tree').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value;
  if (id) void loadServerTree(id).catch((err) => alert(`Couldn't open the tree: ${String(err)}`));
});

initShop({
  design() {
    if (!state.tree) return undefined;
    const data = currentData();
    const o = currentOptions(data);
    // Coordinates of the birthplaces shown (place names only, never people).
    const places: Record<string, { lat: number; lon: number }> = {};
    for (const l of state.located.values()) if (l.place) places[l.place] = { lat: l.lat, lon: l.lon };
    return {
      styleId: o.style.id,
      orientation: o.orientation,
      area: o.area,
      lang: o.lang,
      title: o.title,
      subtitle: o.subtitle,
      dedication: o.dedication,
      // The same choices the preview is drawn with (layouts, borders, finishes are ids of the JSON files).
      layoutId: o.layout?.id ?? LAYOUTS[0].id,
      borderId: o.border?.id,
      finishId: o.finish?.id,
      flagScale: o.flagScale ?? 1,
      routes: o.routes ?? 'essential',
      maxRoutes: o.maxRoutes,
      show: { ...o.show, surnames: o.show.surnames !== false },
      selection: { rootId: val('root') || undefined, branch: val('branch') as Branch, generations: selectedGenerations() },
      places,
    };
  },
  async serverTree() {
    if (!state.serverTreeId) {
      if (!state.gedText) throw new Error('No tree loaded');
      const tree = await api.createTree(state.fileName.replace(/\.(ged|gedcom)$/i, '') || 'Family tree');
      await api.importGedcomText(tree.id, state.fileName, state.gedText);
      const detail = await api.getTree(tree.id);
      state.serverIds = new Map(detail.people.filter((p) => p.originRef).map((p) => [p.originRef!, p.id]));
      state.serverTreeId = tree.id;
    }
    return { treeId: state.serverTreeId, personId: (id) => state.serverIds.get(id) };
  },
  setPaper(size) {
    const sel = $<HTMLSelectElement>('#paper');
    if (sel.value !== size) {
      sel.value = size;
      scheduleRender(0);
    }
  },
});

$('#sample').addEventListener('click', async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}sample.ged`);
  loadText(await res.text(), 'sample.ged');
});
$('#geocode').addEventListener('click', geocodePending);
$('#title').addEventListener('input', () => (state.titleTouched = true));
$('#subtitle').addEventListener('input', () => (state.subtitleTouched = true));
$('#design').addEventListener('input', () => scheduleRender());
$('#design').addEventListener('change', () => scheduleRender());
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-export]')) {
  b.addEventListener('click', () => exportFile(b.dataset.export as 'svg' | 'png' | 'pdf'));
}

// For checking exports from the browser's console while developing (not in production builds).
if (import.meta.env.DEV) Object.assign(window, { heritagePrint: { exportBlob } });
