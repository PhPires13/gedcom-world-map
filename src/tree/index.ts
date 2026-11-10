// The Tree view: a family chart around one person where every link is drawn by how well it is
// proven, with panels to see and add the documents behind people and links.
//
// It works in two modes:
// - with the API server running, on trees stored there (import a GEDCOM, upload documents,
//   attach claims, see confidence change);
// - without it, read-only, on the GEDCOM currently open on the map (every link Unsupported).

import type { Tree as GedTree } from '../gedcom';
import { formatNumber, onLocaleChange, translateStatic } from '../i18n/core';
import { mountLanguageSwitcher } from '../i18n/switcher';
import {
  CONFIDENCE_LEVELS,
  localTreeDetail,
  toGedcomTree,
  type Relationship,
  type TreeDetail,
  type TreeSummary,
} from '../model';
import { api, serverAvailable } from './api';
import { createChartView, type ChartView, type Selection } from './chart';
import { esc, lifespan, percent } from './format';
import { errorText, levelLabel, t } from './i18n';
import { indexFamily, layoutChart, type FamilyIndex } from './layout';
import { renderLinkPanel, renderPersonPanel, type PanelContext } from './panels';
import './tree.css';

/** What the tree view needs from the map (`src/main.ts`). */
export interface MapBridge {
  /** The tree open on the map, if any. */
  current(): { tree: GedTree; name: string } | null;
  /** Opens `tree` on the map (unless it is already there) and selects a person. */
  show(tree: GedTree, name: string, personId?: string): void;
  /** Called when the map becomes visible again. */
  shown(): void;
}

type Mode = 'map' | 'tree';
type Current = { kind: 'server'; id: string } | { kind: 'local' };

const STORE_KEY = 'gedcom-world-map:tree-view';
const LOCAL = 'local';

/** Options for the ancestors / descendants pickers (generation counts, in local digits). */
const generations = (counts: number[], selected: number) =>
  counts.map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${formatNumber(n)}</option>`).join('');

export function mountTreeView(root: HTMLElement, map: MapBridge) {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="view-switch" role="tablist" data-i18n-attr="aria-label:switch.label">
      <button role="tab" data-mode="map" aria-selected="true" data-i18n="switch.map"></button>
      <button role="tab" data-mode="tree" aria-selected="false" data-i18n="switch.tree"></button>
    </div>
    <div class="tv-toast" role="status" hidden></div>`,
  );
  root.innerHTML = `
    <section class="tree-view" hidden>
      <header class="tv-header">
        <div class="tv-pick">
          <select class="tv-tree-select" data-i18n-attr="aria-label:picker.label; title:picker.label"></select>
          <input type="file" class="tv-import-file" accept=".ged,.gedcom,text/plain" hidden />
        </div>
        <div class="tv-header-end">
          <div class="tv-health" hidden></div>
          <div class="tv-lang"></div>
        </div>
      </header>
      <div class="tv-body">
        <div class="tv-chart-wrap">
          <div class="tv-toolbar">
            <input class="tv-search" type="search" list="tv-people" data-i18n-attr="placeholder:search.placeholder; aria-label:search.label" />
            <datalist id="tv-people"></datalist>
            <label data-i18n-attr="title:toolbar.ancestorsTitle"><span data-i18n="toolbar.ancestors"></span> <select class="tv-up">${generations([1, 2, 3, 4, 5, 6], 3)}</select></label>
            <label data-i18n-attr="title:toolbar.descendantsTitle"><span data-i18n="toolbar.descendants"></span> <select class="tv-down">${generations([0, 1, 2, 3, 4], 2)}</select></label>
            <span class="tv-zoom"><button class="icon-btn" data-zoom="in" data-i18n-attr="aria-label:zoom.in; title:zoom.in">+</button><button class="icon-btn" data-zoom="out" data-i18n-attr="aria-label:zoom.out; title:zoom.out">−</button><button class="small-btn" data-zoom="fit" data-i18n="zoom.fit" data-i18n-attr="title:zoom.fitTitle"></button></span>
          </div>
          <div class="tv-chart" tabindex="-1" role="group" data-i18n-attr="aria-label:chart.label"></div>
          <div class="tv-legend" role="group" data-i18n-attr="aria-label:legend.label">${CONFIDENCE_LEVELS.map((l) => `<span><svg width="34" height="8" aria-hidden="true"><path class="edge-line conf-${l}" d="M2,4 H32"/></svg><span data-i18n="level.${l}"></span></span>`).join('')}</div>
          <div class="tv-empty" hidden></div>
        </div>
        <aside class="tv-panel" hidden data-i18n-attr="aria-label:panel.label">
          <button class="icon-btn tv-close" data-i18n-attr="aria-label:panel.close; title:panel.close">×</button>
          <div class="tv-panel-content"></div>
        </aside>
      </div>
    </section>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const view = $('.tree-view');
  const select = $<HTMLSelectElement>('.tv-tree-select');
  const panel = $('.tv-panel');
  const panelContent = $('.tv-panel-content');
  const empty = $('.tv-empty');
  const toastEl = document.querySelector<HTMLElement>('.tv-toast')!;
  const switchEl = document.querySelector<HTMLElement>('.view-switch')!;
  translateStatic(switchEl, t);
  translateStatic(root, t);
  mountLanguageSwitcher($('.tv-lang'));

  const st = {
    mode: 'map' as Mode,
    /** Whether the tree picker has been filled (the Tree view was opened at least once). */
    picked: false,
    server: null as boolean | null,
    trees: [] as TreeSummary[],
    current: null as Current | null,
    detail: null as TreeDetail | null,
    idx: null as FamilyIndex | null,
    rels: new Map<string, Relationship>(),
    focus: null as string | null,
    selection: null as Selection,
    /** The server tree last sent to the map, to tell it apart from a local file. */
    pushed: null as { treeId: string; tree: GedTree } | null,
    searchIds: new Map<string, string>(),
  };

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { tree?: string; focus?: Record<string, string> };
    } catch {
      return {};
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      /* not persisted */
    }
  };

  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3200);
  };

  const chart: ChartView = createChartView($('.tv-chart'), {
    onPerson: (id) => openPanel({ kind: 'person', id }, true),
    onLink: (id) => openPanel({ kind: 'link', id }),
  });

  // ---------- What is on the map ----------

  /** The map's tree, if it came from a local file rather than from the server. */
  const localOnMap = () => {
    const cur = map.current();
    return cur && cur.tree !== st.pushed?.tree ? cur : null;
  };

  // ---------- Mode ----------

  function setMode(mode: Mode) {
    st.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('.view-switch [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    document.body.classList.toggle('tree-mode', mode === 'tree');
    view.hidden = mode !== 'tree';
    if (mode === 'tree') void enterTree();
    else map.shown();
    if (location.hash !== (mode === 'tree' ? '#tree' : '')) history.replaceState(null, '', mode === 'tree' ? '#tree' : location.pathname + location.search);
  }

  async function enterTree() {
    if (st.server === null) st.server = await serverAvailable();
    if (st.server) {
      try {
        st.trees = await api.listTrees();
      } catch {
        st.server = false;
      }
    }
    // Keep showing what was open, unless it went away.
    const local = localOnMap();
    let want: Current | null = st.current;
    if (want?.kind === 'local' && !local) want = null;
    const wantId = want?.kind === 'server' ? want.id : null;
    if (wantId && !st.trees.some((t) => t.id === wantId)) want = null;
    if (!want && local) want = { kind: 'local' };
    if (!want && saved.tree && st.trees.some((t) => t.id === saved.tree)) want = { kind: 'server', id: saved.tree };
    if (!want && st.trees.length) want = { kind: 'server', id: st.trees[0].id };
    renderPicker(want);
    const same = !!want && !!st.current && JSON.stringify(want) === JSON.stringify(st.current) && want.kind === 'server';
    if (want) await open(want, !same);
    else showEmpty();
  }

  // ---------- Picking a tree ----------

  function renderPicker(want: Current | null) {
    const local = localOnMap();
    const opts: string[] = [];
    if (local) opts.push(`<option value="${LOCAL}">${esc(t('picker.local', { name: local.name }))}</option>`);
    for (const tree of st.trees) opts.push(`<option value="${tree.id}">${esc(t('picker.server', { name: tree.name, count: tree.peopleCount }))}</option>`);
    if (st.server) {
      opts.push(`<option value="import">${esc(t('picker.import'))}</option>`);
      opts.push(`<option value="sample">${esc(t('picker.sample'))}</option>`);
    }
    if (!want) opts.unshift(`<option value="" disabled>${esc(t('picker.choose'))}</option>`);
    st.picked = true;
    select.innerHTML = opts.join('');
    select.hidden = !local && !st.server && !st.trees.length;
    select.value = want ? (want.kind === 'local' ? LOCAL : want.id) : '';
  }

  select.addEventListener('change', async () => {
    const v = select.value;
    if (v === 'import') {
      renderPicker(st.current);
      $<HTMLInputElement>('.tv-import-file').value = '';
      $<HTMLInputElement>('.tv-import-file').click();
    } else if (v === 'sample') {
      renderPicker(st.current);
      await importTree(t('sample.name'), async () => {
        const res = await fetch(`${import.meta.env.BASE_URL}sample.ged`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return new File([await res.blob()], 'sample.ged', { type: 'text/plain' });
      });
    } else if (v === LOCAL) await open({ kind: 'local' }, true);
    else if (v) await open({ kind: 'server', id: v }, true);
  });

  $<HTMLInputElement>('.tv-import-file').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await importTree(file.name.replace(/\.(ged|gedcom)$/i, ''), async () => file);
  });

  async function importTree(name: string, file: () => Promise<File>) {
    try {
      toast(t('import.progress'));
      const tree = await api.createTree(name);
      const res = await api.importGedcom(tree.id, await file());
      st.trees = await api.listTrees();
      renderPicker({ kind: 'server', id: tree.id });
      await open({ kind: 'server', id: tree.id }, true);
      toast(t('import.done', { people: res.peopleCreated, links: res.relationshipsCreated }));
    } catch (e) {
      toast(t('import.failed', { message: errorText(e) }));
    }
  }

  async function load(cur: Current): Promise<TreeDetail | null> {
    if (cur.kind === 'local') {
      const local = localOnMap();
      return local ? localTreeDetail(local.tree, local.name, new Date().getFullYear()) : null;
    }
    return api.getTree(cur.id);
  }

  async function open(cur: Current, fresh: boolean) {
    let detail: TreeDetail | null;
    try {
      detail = await load(cur);
    } catch (e) {
      toast(t('error.openTree', { detail: errorText(e) }));
      if (!st.detail) showEmpty();
      else renderPicker(st.current);
      return;
    }
    if (!detail) return showEmpty();
    st.current = cur;
    if (cur.kind === 'server') {
      saved.tree = cur.id;
      save();
    }
    setDetail(detail);
    if (fresh) {
      st.selection = null;
      panel.hidden = true;
      const key = cur.kind === 'local' ? `local:${detail.tree.name}` : cur.id;
      const remembered = saved.focus?.[key];
      st.focus = remembered && st.idx!.people.has(remembered) ? remembered : defaultFocus(st.idx!);
    }
    draw();
  }

  async function refresh() {
    if (!st.current) return;
    try {
      const detail = await load(st.current);
      if (detail) setDetail(detail);
    } catch (e) {
      toast(t('error.openTree', { detail: errorText(e) }));
    }
    draw();
  }

  function setDetail(detail: TreeDetail) {
    st.detail = detail;
    st.idx = indexFamily(detail.people, detail.relationships);
    st.rels = new Map(detail.relationships.map((r) => [r.id, r]));
    empty.hidden = true;
    renderHealth();
    renderSearch();
  }

  /** The most recently born person with parents in the tree: usually who the tree is about. */
  function defaultFocus(idx: FamilyIndex): string | null {
    let best: string | null = null;
    let bestYear = -Infinity;
    for (const p of idx.people.values()) {
      const y = p.birth?.year ?? p.baptism?.year ?? -Infinity;
      if (idx.parentLinks.has(p.id) && (best === null || y > bestYear)) {
        best = p.id;
        bestYear = y;
      }
    }
    return best ?? idx.people.keys().next().value ?? null;
  }

  function showEmpty() {
    st.current = null;
    st.detail = null;
    $('.tv-health').hidden = true;
    st.selection = null;
    panel.hidden = true;
    empty.hidden = false;
    renderEmpty();
  }

  function renderEmpty() {
    empty.innerHTML = st.server
      ? `<h2>${t('empty.server.title')}</h2>
         <p>${t('empty.server.text')}</p>
         <div class="tv-empty-actions"><button class="btn primary" data-act="import">${t('empty.server.import')}</button><button class="btn" data-act="sample">${t('empty.server.sample')}</button></div>`
      : `<h2>${t('empty.local.title')}</h2>
         <p>${t('empty.local.text')}</p>
         <p class="muted">${t('empty.local.server')}</p>
         <div class="tv-empty-actions"><button class="btn" data-act="map">${t('empty.local.map')}</button><button class="btn" data-act="retry">${t('empty.local.retry')}</button></div>`;
  }

  empty.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'import') {
      $<HTMLInputElement>('.tv-import-file').value = '';
      $<HTMLInputElement>('.tv-import-file').click();
    } else if (act === 'sample') {
      select.value = 'sample';
      select.dispatchEvent(new Event('change'));
    } else if (act === 'map') setMode('map');
    else if (act === 'retry') {
      st.server = null;
      await enterTree();
    }
  });

  // ---------- Drawing ----------

  function renderHealth() {
    const h = st.detail!.health;
    const segment = (l: (typeof CONFIDENCE_LEVELS)[number]) => t('health.segment', { level: levelLabel(l), count: formatNumber(h.counts[l]) });
    const el = $('.tv-health');
    el.hidden = false;
    const segs = CONFIDENCE_LEVELS.filter((l) => h.counts[l])
      .map((l) => `<i class="seg conf-${l}" style="flex:${h.counts[l]}" title="${esc(segment(l))}"></i>`)
      .join('');
    el.innerHTML = `
      <span class="tv-health-label">${t('health.title')} <b>${percent(h.provenShare)}</b> <span class="muted">${esc(t('health.detail', { proven: h.counts.proven, total: h.total }))}</span></span>
      <span class="tv-health-bar" aria-hidden="true">${segs || '<i class="seg" style="flex:1"></i>'}</span>`;
    el.title = CONFIDENCE_LEVELS.map(segment).join('\n');
  }

  function renderSearch() {
    st.searchIds.clear();
    const opts: string[] = [];
    for (const p of st.idx!.people.values()) {
      let label = `${p.name}${lifespan(p) ? ` (${lifespan(p)})` : ''}`;
      for (let n = 2; st.searchIds.has(label); n++) label = t('search.duplicate', { name: p.name, n });
      st.searchIds.set(label, p.id);
      opts.push(`<option value="${esc(label)}"></option>`);
    }
    $('#tv-people').innerHTML = opts.join('');
  }

  $<HTMLInputElement>('.tv-search').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const id = st.searchIds.get(input.value);
    if (!id) return;
    input.value = '';
    openPanel({ kind: 'person', id }, true);
  });

  function setFocus(id: string) {
    st.focus = id;
    if (st.detail) {
      const key = st.current?.kind === 'server' ? st.current.id : `local:${st.detail.tree.name}`;
      saved.focus = { ...saved.focus, [key]: id };
      save();
    }
    draw();
  }

  function draw() {
    if (!st.idx || !st.focus) return;
    const up = Number($<HTMLSelectElement>('.tv-up').value);
    const down = Number($<HTMLSelectElement>('.tv-down').value);
    chart.render(layoutChart(st.idx, st.focus, up, down), st.idx.people, st.rels, st.focus, st.selection);
  }

  $('.tv-up').addEventListener('change', () => (draw(), chart.fit()));
  $('.tv-down').addEventListener('change', () => (draw(), chart.fit()));
  root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.zoom === 'fit' ? chart.fit() : chart.zoomBy(b.dataset.zoom === 'in' ? 1.25 : 0.8))),
  );

  // ---------- Panels ----------

  const ctx = (): PanelContext => ({
    treeId: st.current?.kind === 'server' ? st.current.id : null,
    fileName: st.detail?.tree.name ?? '',
    people: st.idx!.people,
    rels: st.rels,
    linksOf: (id) => [
      ...(st.idx!.parentLinks.get(id) ?? []),
      ...(st.idx!.spouseLinks.get(id) ?? []),
      ...(st.idx!.childLinks.get(id) ?? []),
    ],
    openPerson: (id) => openPanel({ kind: 'person', id }, true),
    openLink: (id) => openPanel({ kind: 'link', id }),
    refresh,
    showOnMap,
    toast,
  });

  /** Opens the side panel; `refocus` also centres the chart on the person (after the panel is shown, so it fits beside it). */
  function openPanel(sel: Selection, refocus = false) {
    st.selection = sel;
    panel.hidden = !sel;
    if (refocus && sel?.kind === 'person') setFocus(sel.id);
    else draw();
    if (!sel) return;
    panel.scrollTop = 0;
    panelRender++;
    void renderPanel(sel);
  }

  const renderPanel = (sel: NonNullable<Selection>) =>
    sel.kind === 'person' ? renderPersonPanel(panelContent, ctx(), sel.id) : renderLinkPanel(panelContent, ctx(), sel.id);

  // ---------- Language ----------

  /** Bumped by every panel render, so a stale re-translation does not restore over a newer panel. */
  let panelRender = 0;

  type Kept = { open: boolean[]; fields: Map<string, { value?: string; checked?: boolean; files?: FileList }>; scroll: number };
  type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const fieldId = (f: Field) =>
    f.name ? (f instanceof HTMLInputElement && f.type === 'radio' ? `${f.name}=${f.value}` : f.name) : f.classList.contains('tv-argument') ? 'argument' : '';
  const fields = () => [...panelContent.querySelectorAll<Field>('input, select, textarea')].filter((f) => fieldId(f) && !f.classList.contains('tv-privacy'));

  /** What the visitor has open or typed in the panel, to put back after it is redrawn in another language. */
  function keepPanel(): Kept {
    const kept: Kept = { open: [...panelContent.querySelectorAll('details')].map((d) => d.open), fields: new Map(), scroll: panel.scrollTop };
    for (const f of fields()) {
      if (f instanceof HTMLInputElement && f.type === 'radio') kept.fields.set(fieldId(f), { checked: f.checked });
      else if (f instanceof HTMLInputElement && f.type === 'file') kept.fields.set(fieldId(f), { files: f.files ?? undefined });
      else kept.fields.set(fieldId(f), { value: f.value });
    }
    return kept;
  }

  function restorePanel(kept: Kept) {
    panelContent.querySelectorAll('details').forEach((d, i) => {
      if (i < kept.open.length) d.open = kept.open[i];
    });
    const changed: Field[] = [];
    for (const f of fields()) {
      const k = kept.fields.get(fieldId(f));
      if (!k) continue;
      if (k.checked !== undefined && f instanceof HTMLInputElement) {
        if (k.checked && !f.checked) changed.push(f);
        f.checked = k.checked;
      } else if (k.files && f instanceof HTMLInputElement) {
        if (k.files.length) f.files = k.files;
      } else if (k.value !== undefined && f.value !== k.value) {
        if (f.name === 'sourceId') f.dataset.keep = k.value;
        f.value = k.value;
        if (f.name === 'relationshipId') changed.push(f);
      }
    }
    // Let the form show the parts that go with the restored choices.
    for (const f of changed) f.dispatchEvent(new Event('change'));
    panel.scrollTop = kept.scroll;
  }

  async function retranslatePanel(sel: NonNullable<Selection>) {
    const kept = keepPanel();
    const mine = ++panelRender;
    await renderPanel(sel);
    if (mine === panelRender && st.selection === sel) restorePanel(kept);
  }

  onLocaleChange(() => {
    translateStatic(switchEl, t);
    translateStatic(root, t);
    if (st.picked) renderPicker(st.current);
    if (st.detail) {
      renderHealth();
      renderSearch();
      draw();
    }
    if (!empty.hidden) renderEmpty();
    if (st.selection && !panel.hidden) void retranslatePanel(st.selection);
  });

  $('.tv-close').addEventListener('click', () => openPanel(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.mode === 'tree' && st.selection) openPanel(null);
  });

  function showOnMap(personId?: string) {
    if (!st.detail || !st.current) return;
    if (st.current.kind === 'local') {
      const local = localOnMap();
      if (local) map.show(local.tree, local.name, personId);
    } else {
      if (st.pushed?.treeId !== st.current.id) st.pushed = { treeId: st.current.id, tree: toGedcomTree(st.detail) };
      map.show(st.pushed.tree, st.detail.tree.name, personId);
    }
    setMode('map');
  }

  // ---------- Switch ----------

  document.querySelectorAll<HTMLButtonElement>('.view-switch [data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const mode = b.dataset.mode as Mode;
      // Going to the map from a server tree shows that tree there.
      if (mode === 'map' && st.mode === 'tree' && st.current?.kind === 'server') return showOnMap(st.selection?.kind === 'person' ? st.selection.id : undefined);
      setMode(mode);
    }),
  );

  if (location.hash === '#tree') setMode('tree');
}
