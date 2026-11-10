// The Tree view: a family chart around one person where every link is drawn by how well it is
// proven, with panels to see and add the documents behind people and links.
//
// It works in two modes:
// - with the API server running, on trees stored there (import a GEDCOM, upload documents,
//   attach claims, see confidence change);
// - without it, read-only, on the GEDCOM currently open on the map (every link Unsupported).

import type { Tree as GedTree } from '../gedcom';
import {
  CONFIDENCE_LABELS,
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

export function mountTreeView(root: HTMLElement, map: MapBridge) {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="view-switch" role="tablist" aria-label="View">
      <button role="tab" data-mode="map" aria-selected="true">Map</button>
      <button role="tab" data-mode="tree" aria-selected="false">Tree</button>
    </div>
    <div class="tv-toast" role="status" hidden></div>`,
  );
  root.innerHTML = `
    <section class="tree-view" hidden>
      <header class="tv-header">
        <div class="tv-pick">
          <select class="tv-tree-select" aria-label="Tree"></select>
          <input type="file" class="tv-import-file" accept=".ged,.gedcom,text/plain" hidden />
        </div>
        <div class="tv-health" hidden></div>
      </header>
      <div class="tv-body">
        <div class="tv-chart-wrap">
          <div class="tv-toolbar">
            <input class="tv-search" type="search" list="tv-people" placeholder="Find a person…" aria-label="Find a person" />
            <datalist id="tv-people"></datalist>
            <label>Ancestors <select class="tv-up">${[1, 2, 3, 4, 5, 6].map((n) => `<option${n === 3 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Descendants <select class="tv-down">${[0, 1, 2, 3, 4].map((n) => `<option${n === 2 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
            <span class="tv-zoom"><button class="icon-btn" data-zoom="in" aria-label="Zoom in">+</button><button class="icon-btn" data-zoom="out" aria-label="Zoom out">−</button><button class="small-btn" data-zoom="fit">Fit</button></span>
          </div>
          <div class="tv-chart" tabindex="-1"></div>
          <div class="tv-legend">${CONFIDENCE_LEVELS.map((l) => `<span><svg width="34" height="8"><path class="edge-line conf-${l}" d="M2,4 H32"/></svg>${CONFIDENCE_LABELS[l]}</span>`).join('')}</div>
          <div class="tv-empty" hidden></div>
        </div>
        <aside class="tv-panel" hidden>
          <button class="icon-btn tv-close" aria-label="Close">×</button>
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

  const st = {
    mode: 'map' as Mode,
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
    if (local) opts.push(`<option value="${LOCAL}">${esc(local.name)} (on the map, read-only)</option>`);
    for (const t of st.trees) opts.push(`<option value="${t.id}">${esc(t.name)} · ${t.peopleCount} people</option>`);
    if (st.server) {
      opts.push('<option value="import">＋ New tree from a GEDCOM file…</option>');
      opts.push('<option value="sample">＋ New tree from the sample family</option>');
    }
    if (!want) opts.unshift('<option value="" disabled>Choose a tree…</option>');
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
      const res = await fetch(`${import.meta.env.BASE_URL}sample.ged`);
      await importTree('Sample family', () => res.blob().then((b) => new File([b], 'sample.ged', { type: 'text/plain' })));
    } else if (v === LOCAL) await open({ kind: 'local' }, true);
    else if (v) await open({ kind: 'server', id: v }, true);
  });

  $<HTMLInputElement>('.tv-import-file').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await importTree(file.name.replace(/\.(ged|gedcom)$/i, ''), async () => file);
  });

  async function importTree(name: string, file: () => Promise<File>) {
    try {
      toast('Importing…');
      const tree = await api.createTree(name);
      const res = await api.importGedcom(tree.id, await file());
      st.trees = await api.listTrees();
      renderPicker({ kind: 'server', id: tree.id });
      await open({ kind: 'server', id: tree.id }, true);
      toast(`Imported ${res.peopleCreated} people and ${res.relationshipsCreated} links, all Unsupported until documents back them.`);
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
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
    const detail = await load(cur);
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
    const detail = await load(st.current);
    if (detail) setDetail(detail);
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
    panel.hidden = true;
    empty.hidden = false;
    empty.innerHTML = st.server
      ? `<h2>Start a family tree</h2>
         <p>Import a GEDCOM file. Every person and link starts as <b>Unsupported</b>; attach baptism, marriage and death records to prove them.</p>
         <div class="tv-empty-actions"><button class="btn primary" data-act="import">Import a GEDCOM file</button><button class="btn" data-act="sample">Use the sample family</button></div>`
      : `<h2>No tree to show</h2>
         <p>Load a GEDCOM file on the map to see it here as a family tree (read-only).</p>
         <p class="muted">To keep documents and evidence, start the server with <code>npm run dev:all</code>.</p>
         <div class="tv-empty-actions"><button class="btn" data-act="map">Go to the map</button><button class="btn" data-act="retry">Check for the server again</button></div>`;
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
    const el = $('.tv-health');
    el.hidden = false;
    const segs = CONFIDENCE_LEVELS.filter((l) => h.counts[l])
      .map((l) => `<i class="seg conf-${l}" style="flex:${h.counts[l]}" title="${CONFIDENCE_LABELS[l]}: ${h.counts[l]}"></i>`)
      .join('');
    el.innerHTML = `
      <span class="tv-health-label">Tree health <b>${percent(h.provenShare)}</b> <span class="muted">proven (${h.counts.proven} of ${h.total} links)</span></span>
      <span class="tv-health-bar" aria-hidden="true">${segs || '<i class="seg" style="flex:1"></i>'}</span>`;
    el.title = CONFIDENCE_LEVELS.map((l) => `${CONFIDENCE_LABELS[l]}: ${h.counts[l]}`).join('\n');
  }

  function renderSearch() {
    st.searchIds.clear();
    const opts: string[] = [];
    for (const p of st.idx!.people.values()) {
      let label = `${p.name}${lifespan(p) ? ` (${lifespan(p)})` : ''}`;
      for (let n = 2; st.searchIds.has(label); n++) label = `${p.name} #${n}`;
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
    void (sel.kind === 'person' ? renderPersonPanel(panelContent, ctx(), sel.id) : renderLinkPanel(panelContent, ctx(), sel.id));
  }

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
