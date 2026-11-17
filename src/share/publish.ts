// The "Compartilhar" dialog of the map app: says what will be public, builds the public snapshot
// in the browser (src/share/snapshot.ts), publishes it, and hands back the link to copy or send on
// WhatsApp. It also lists the links already made, each with "Parar de compartilhar".

import type { Tree } from '../gedcom';
import { formatDate, formatNumber, makeT, onLocaleChange } from '../i18n/core';
import { shareMessages } from '../i18n/messages/share';
import { shareApi, shareLink, whatsappLink } from './api';
import { buildSnapshot, defaultFamilyName, MAX_FAMILY_LENGTH, publishableIds, type ShareInfo, type SnapshotPlace } from './snapshot';
import './share.css';

const t = makeT(shareMessages);

/** What the map app has loaded, at the moment the dialog opens. */
export interface ShareSource {
  tree: Tree;
  located: ReadonlyMap<string, SnapshotPlace>;
  gens: ReadonlyMap<string, number>;
  /** Place lookups still running: people waiting on them are not on the map yet. */
  lookupActive: boolean;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const ICON_WHATSAPP =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

const title = (family: string) => (family ? t('viewer.family', { family }) : '');

async function copyText(text: string, input?: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / no permission: select the text so the visitor can copy it themselves.
    input?.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** Opens the dialog when `button` is clicked; `current()` is what's loaded (null: nothing yet). */
export function mountShareButton(button: HTMLElement, current: () => ShareSource | null) {
  button.addEventListener('click', () => {
    const source = current();
    if (source) openShareDialog(source);
  });
}

export function openShareDialog(source: ShareSource) {
  const currentYear = new Date().getFullYear();
  const allowed = publishableIds(source.tree, currentYear);
  const state = {
    family: defaultFamilyName(source.tree, allowed),
    busy: false,
    error: '',
    notice: '',
    created: null as ShareInfo | null,
    copied: false,
    mine: [] as ShareInfo[],
    offline: false,
  };
  const preview = () => buildSnapshot({ ...source, family: state.family, currentYear });

  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  document.body.append(dialog);

  function render() {
    const { snapshot, withheld, unplaced } = preview();
    const count = snapshot.people.length;
    const n = (x: number) => ({ count: x, n: formatNumber(x) });
    const created = state.created;
    const link = created ? shareLink(created) : '';

    const form = `
      <p class="share-intro">${esc(t('share.intro'))}</p>
      <label class="share-field">
        <span>${esc(t('share.familyLabel'))}</span>
        <input id="share-family" type="text" maxlength="${MAX_FAMILY_LENGTH}" value="${esc(state.family)}" autocomplete="off" required />
        <small class="muted" id="share-title-preview">${state.family.trim() ? esc(t('share.familyPreview', { title: title(state.family.trim()) })) : ''}</small>
      </label>
      <h3>${esc(t('share.whatPublic'))}</h3>
      <ul class="share-rules">
        <li class="ok">${esc(t('share.public.people', n(count)))}</li>
        ${withheld ? `<li class="out">${esc(t('share.public.living', n(withheld)))}</li>` : ''}
        ${unplaced ? `<li class="out">${esc(t('share.public.unplaced', n(unplaced)))}</li>` : ''}
        <li class="out">${esc(t('share.public.never'))}</li>
        <li>${esc(t('share.public.undo'))}</li>
      </ul>
      ${source.lookupActive ? `<p class="share-note">${esc(t('share.lookupRunning'))}</p>` : ''}
      ${count === 0 ? `<p class="share-note">${esc(t('share.nobody'))}</p>` : ''}
      ${state.offline ? `<p class="share-error">${esc(t('share.offline'))}</p>` : ''}
      ${state.error ? `<p class="share-error">${esc(state.error)}</p>` : ''}
      <div class="share-actions">
        <button type="button" class="btn" data-act="close">${esc(t('share.cancel'))}</button>
        <button type="button" class="btn primary" data-act="create" ${count === 0 || state.busy || !state.family.trim() ? 'disabled' : ''}>
          ${esc(state.busy ? t('share.creating') : t('share.create'))}
        </button>
      </div>`;

    const done = created
      ? `
      <p class="share-ready">${esc(t('share.ready'))}</p>
      <div class="share-link-row">
        <input id="share-link" type="text" readonly value="${esc(link)}" aria-label="${esc(t('share.linkLabel'))}" />
      </div>
      <div class="share-buttons">
        <button type="button" class="btn primary" data-act="copy">${ICON_COPY}${esc(state.copied ? t('share.copied') : t('share.copy'))}</button>
        <a class="btn whatsapp" target="_blank" rel="noopener" href="${esc(whatsappLink(t('share.waText', { family: created.family, url: link })))}">${ICON_WHATSAPP}${esc(t('share.whatsapp'))}</a>
        <a class="btn" target="_blank" rel="noopener" href="${esc(link)}">${esc(t('share.open'))}</a>
      </div>
      <div class="share-actions">
        <button type="button" class="link-btn danger" data-act="unpublish" data-id="${esc(created.id)}">${esc(t('share.unpublish'))}</button>
        <button type="button" class="btn" data-act="close">${esc(t('share.close'))}</button>
      </div>`
      : '';

    const others = state.mine.filter((s) => s.id !== created?.id);
    const list = others.length
      ? `<details class="share-mine"><summary>${esc(t('share.existing'))} (${formatNumber(others.length)})</summary><ul>${others
          .map(
            (s) => `<li>
              <a href="${esc(shareLink(s))}" target="_blank" rel="noopener">${esc(title(s.family))}</a>
              <span class="muted">${esc(t('share.created', { date: formatDate(s.createdAt, { dateStyle: 'medium' }) }))}</span>
              <button type="button" class="link-btn danger" data-act="unpublish" data-id="${esc(s.id)}">${esc(t('share.unpublish'))}</button>
            </li>`,
          )
          .join('')}</ul></details>`
      : '';

    // Re-rendering replaces the inputs: keep the cursor in the name field if it was there.
    const focused = document.activeElement as HTMLInputElement | null;
    const keep = focused?.id === 'share-family' ? [focused.selectionStart, focused.selectionEnd] : null;
    dialog.innerHTML = `
      <form method="dialog" class="share-card">
        <header>
          <h2>${esc(t('share.dialogTitle'))}</h2>
          <button type="button" class="icon-btn ghost" data-act="close" aria-label="${esc(t('share.close'))}">×</button>
        </header>
        ${created ? done : form}
        ${state.notice ? `<p class="share-notice">${esc(state.notice)}</p>` : ''}
        ${list}
      </form>`;
    if (keep) {
      const input = dialog.querySelector<HTMLInputElement>('#share-family');
      input?.focus();
      input?.setSelectionRange(keep[0], keep[1]);
    }
  }

  async function loadMine() {
    try {
      state.mine = await shareApi.mine();
      state.offline = false;
    } catch {
      state.offline = true;
    }
    render();
  }

  async function create() {
    const { snapshot } = preview();
    if (!snapshot.people.length || !state.family.trim()) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      state.created = await shareApi.create(snapshot);
      state.mine = [state.created, ...state.mine];
      state.offline = false;
    } catch (e) {
      state.error = t('share.error', { error: e instanceof Error ? e.message : String(e) });
    }
    state.busy = false;
    render();
  }

  async function unpublish(id: string) {
    if (!confirm(t('share.unpublishConfirm'))) return;
    try {
      await shareApi.remove(id);
      state.mine = state.mine.filter((s) => s.id !== id);
      if (state.created?.id === id) state.created = null;
      state.notice = t('share.unpublished');
      state.error = '';
    } catch (e) {
      state.error = t('share.unpublishError', { error: e instanceof Error ? e.message : String(e) });
    }
    render();
  }

  dialog.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== 'share-family') return;
    state.family = input.value;
    // Only the parts that depend on the name, so typing keeps the cursor where it is.
    dialog.querySelector('#share-title-preview')!.textContent = state.family.trim()
      ? t('share.familyPreview', { title: title(state.family.trim()) })
      : '';
    const create = dialog.querySelector<HTMLButtonElement>('[data-act="create"]');
    if (create) create.disabled = !state.family.trim() || !preview().snapshot.people.length || state.busy;
  });
  dialog.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'close') dialog.close();
    else if (act === 'create') void create();
    else if (act === 'unpublish') void unpublish(el.dataset.id!);
    else if (act === 'copy' && state.created) {
      void copyText(shareLink(state.created), dialog.querySelector<HTMLInputElement>('#share-link') ?? undefined).then((ok) => {
        state.copied = ok;
        render();
      });
    }
  });
  dialog.addEventListener('submit', (e) => e.preventDefault());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).id === 'share-family') {
      e.preventDefault();
      void create();
    }
  });
  const offLocale = onLocaleChange(render);
  dialog.addEventListener('close', () => {
    offLocale();
    dialog.remove();
  });

  render();
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>('#share-family')?.focus();
  void loadMine();
}
