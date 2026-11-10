// Draws a laid-out chart: cards as HTML (for text ellipsis and focus), links as SVG paths styled
// by confidence. Supports drag to pan, wheel / buttons to zoom.

import type { Person, Relationship } from '../model';
import { esc, lifespan } from './format';
import { CARD_H, CARD_W, type Chart } from './layout';

export interface ChartHandlers {
  onPerson(id: string): void;
  onLink(relationshipId: string): void;
}

export interface ChartView {
  render(chart: Chart, people: Map<string, Person>, rels: Map<string, Relationship>, focusId: string, selected: Selection): void;
  fit(): void;
  zoomBy(f: number): void;
}

export type Selection = { kind: 'person'; id: string } | { kind: 'link'; id: string } | null;

const lock = `<svg class="lock" viewBox="0 0 24 24" aria-label="Private"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>`;

export function createChartView(viewport: HTMLElement, handlers: ChartHandlers): ChartView {
  viewport.innerHTML = `<div class="tv-canvas"><svg class="tv-edges" overflow="visible"></svg><div class="tv-cards"></div></div>`;
  const canvas = viewport.querySelector<HTMLElement>('.tv-canvas')!;
  const svg = viewport.querySelector<SVGSVGElement>('.tv-edges')!;
  const cards = viewport.querySelector<HTMLElement>('.tv-cards')!;

  let view = { x: 0, y: 0, k: 1 };
  let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const apply = () => (canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`);

  const zoomAt = (f: number, cx: number, cy: number) => {
    const k = Math.min(2, Math.max(0.25, view.k * f));
    view = { x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k, k };
    apply();
  };

  const fit = () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    const bw = bounds.maxX - bounds.minX + 80;
    const bh = bounds.maxY - bounds.minY + 80;
    const k = Math.min(1, Math.max(0.3, Math.min(w / bw, h / bh)));
    view = { k, x: w / 2 - ((bounds.minX + bounds.maxX) / 2) * k, y: h / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
    apply();
  };

  // Drag to pan. A drag that moved does not count as a click on what is under it.
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) viewport.classList.add('dragging');
    drag.moved = true;
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    apply();
  });
  window.addEventListener('pointerup', () => {
    viewport.classList.remove('dragging');
    // Let the click handler see whether this was a drag, then forget it.
    setTimeout(() => (drag = null));
  });
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  viewport.addEventListener('click', (e) => {
    if (drag?.moved) return;
    const el = e.target as Element;
    const person = el.closest<HTMLElement>('[data-tv-person]');
    if (person) return handlers.onPerson(person.dataset.tvPerson!);
    const link = el.closest<SVGElement>('[data-rel]');
    if (link) handlers.onLink(link.dataset.rel!);
  });
  viewport.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (el.dataset.tvPerson) handlers.onPerson(el.dataset.tvPerson);
    else if (el.dataset.rel) handlers.onLink(el.dataset.rel);
    else return;
    e.preventDefault();
  });

  let lastFocus = '';

  return {
    render(chart, people, rels, focusId, selected) {
      bounds = chart.bounds;
      svg.innerHTML = chart.edges
        .map((e) => {
          const r = rels.get(e.relationshipId)!;
          const sel = selected?.kind === 'link' && selected.id === e.relationshipId ? ' selected' : '';
          const label = esc(`${r.kind === 'spouse' ? 'Spouses' : 'Parent and child'}: ${r.confidence}`);
          return `<g class="edge conf-${r.confidence}${sel}" data-rel="${r.id}" tabindex="0" role="button" aria-label="${label}">
            <path class="edge-line" d="${e.path}"/><path class="edge-hit" d="${e.path}"><title>${label}</title></path></g>`;
        })
        .join('');
      cards.innerHTML = chart.nodes
        .map((n) => {
          const p = people.get(n.personId)!;
          const cls = [
            'card',
            n.personId === focusId && n.generation === 0 ? 'focus' : '',
            selected?.kind === 'person' && selected.id === n.personId ? 'selected' : '',
            p.sex === 'M' ? 'male' : p.sex === 'F' ? 'female' : '',
            p.isPrivate ? 'private' : '',
          ].join(' ');
          return `<div class="${cls}" data-tv-person="${p.id}" tabindex="0" role="button"
            style="left:${n.x - CARD_W / 2}px;top:${n.y - CARD_H / 2}px;width:${CARD_W}px;height:${CARD_H}px">
            ${n.moreAbove ? '<span class="more up" title="More ancestors: click to centre here">▲</span>' : ''}
            <span class="name">${p.isPrivate ? lock : ''}${esc(p.name)}</span>
            <span class="years">${esc(lifespan(p)) || '&nbsp;'}</span>
            ${n.moreBelow ? '<span class="more down" title="More descendants: click to centre here">▼</span>' : ''}
          </div>`;
        })
        .join('');
      if (focusId !== lastFocus) {
        lastFocus = focusId;
        fit();
      }
    },
    fit,
    zoomBy: (f) => zoomAt(f, viewport.clientWidth / 2, viewport.clientHeight / 2),
  };
}
