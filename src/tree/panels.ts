// The side panel: a person's documents on a timeline, or a link's evidence, plus the form to add
// a document and a claim.

import type { TreeMessageKey } from '../i18n/messages/tree';
import {
  type Claim,
  type ClaimPersonLink,
  type ClaimRole,
  type Person,
  type PersonEvidence,
  type Relationship,
  type RelationshipEvidence,
  type Source,
} from '../model';
import { formatNumber } from '../i18n/core';
import { api, apiUrl, type NewClaim } from './api';
import { badge, citationLine, esc, gedcomDate, lifespan, nameOf, roleOf, shortNameOf } from './format';
import { errorText, levelLabel, t } from './i18n';
import { translateReason } from './reasons';

export interface PanelContext {
  /** Null for a tree read from a local file: read-only, no documents. */
  treeId: string | null;
  fileName: string;
  people: Map<string, Person>;
  rels: Map<string, Relationship>;
  /** Links of each person, for the person panel. */
  linksOf(personId: string): Relationship[];
  openPerson(id: string): void;
  openLink(id: string): void;
  /** Reloads the tree (lines, health) after a change; resolves once redrawn. */
  refresh(): Promise<void>;
  showOnMap(personId: string): void;
  toast(message: string): void;
}

type Choice = readonly [value: string, label: TreeMessageKey];

const SOURCE_KINDS: Choice[] = [
  ['original', 'sourceKind.original'],
  ['derivative', 'sourceKind.derivative'],
  ['authored', 'sourceKind.authored'],
];
const CLAIM_KINDS = ['baptism', 'birth', 'marriage', 'death', 'burial', 'parentage', 'residence', 'occupation', 'name', 'other'] as const;
const CLAIM_KIND_CHOICES: Choice[] = CLAIM_KINDS.map((k) => [k, `claimKind.${k}`]);
const INFORMATION: Choice[] = [
  ['primary', 'info.primary'],
  ['secondary', 'info.secondary'],
  ['undetermined', 'info.undetermined'],
];
const READING: Choice[] = [
  ['clear', 'reading.clear'],
  ['likely', 'reading.likely'],
  ['uncertain', 'reading.uncertain'],
];

const options = (list: readonly Choice[], selected?: string) =>
  list.map(([v, label]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(t(label))}</option>`).join('');

/** Runs a change against the server; tells the visitor when it fails. */
async function attempt(ctx: PanelContext, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    ctx.toast(t('error.save', { detail: errorText(e) }));
  }
}

const isImage = (s: Source) => s.document?.mediaType.startsWith('image/') && s.document.mediaType !== 'image/tiff';

function documentPreview(s: Source, large = false): string {
  const d = s.document;
  if (!d) return '';
  const url = apiUrl(d.url);
  if (isImage(s)) {
    return `<a class="doc-thumb${large ? ' large' : ''}" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(d.fileName)}" loading="lazy" /></a>`;
  }
  return `<a class="doc-file" href="${esc(url)}" target="_blank" rel="noopener">📄 ${esc(d.fileName)}</a>`;
}

function claimMeta(c: Claim, relId?: string): string {
  const link = relId ? c.relationships.find((r) => r.relationshipId === relId) : undefined;
  const bits = [
    link && `<span class="tag ${link.stance}">${t(link.stance === 'supports' ? 'tag.supports' : 'tag.contradicts')}</span>`,
    link && `<span class="tag">${t(link.evidence === 'direct' ? 'tag.direct' : 'tag.indirect')}</span>`,
    `<span class="tag">${t(c.information === 'primary' ? 'tag.primary' : c.information === 'secondary' ? 'tag.secondary' : 'tag.undetermined')}</span>`,
    c.reading !== 'clear' ? `<span class="tag warn">${t(c.reading === 'likely' ? 'tag.likely' : 'tag.uncertain')}</span>` : '',
    c.extractedBy.kind === 'ai'
      ? `<span class="tag ai">${t(c.review === 'proposed' ? 'tag.aiProposed' : c.review === 'rejected' ? 'tag.aiRejected' : 'tag.aiConfirmed')}</span>`
      : '',
    c.review === 'rejected' && c.extractedBy.kind !== 'ai' ? `<span class="tag">${t('tag.rejected')}</span>` : '',
  ];
  return `<div class="tags">${bits.filter(Boolean).join('')}</div>`;
}

// ---------- Person ----------

export async function renderPersonPanel(el: HTMLElement, ctx: PanelContext, personId: string) {
  const p = ctx.people.get(personId);
  if (!p) return;
  let evidence: PersonEvidence | null = null;
  if (ctx.treeId) {
    el.innerHTML = personHeader(ctx, p) + `<p class="muted">${t('person.loading')}</p>`;
    try {
      evidence = await api.personEvidence(ctx.treeId, personId);
    } catch (e) {
      el.innerHTML = personHeader(ctx, p) + `<p class="error">${esc(errorText(e))}</p>`;
      return;
    }
  }
  const person = evidence?.person ?? p;
  const links = ctx.linksOf(personId);
  el.innerHTML = `
    ${personHeader(ctx, person)}
    ${links.length ? `<h3>${t('person.familyLinks')}</h3><ul class="link-list">${links.map((r) => linkItem(ctx, r, personId)).join('')}</ul>` : ''}
    <h3>${t('person.documents')}</h3>
    ${timeline(ctx, evidence, person)}
    ${ctx.treeId ? `<details class="add-evidence"><summary class="btn">${esc(t('person.addDocument', { name: shortNameOf(person) }))}</summary>${evidenceForm({ kind: 'person', person, links, ctx })}</details>` : ''}
    <button class="btn wide tv-show-map" type="button">${t('person.showOnMap')}</button>
  `;
  el.querySelector('.tv-show-map')!.addEventListener('click', () => ctx.showOnMap(personId));
  el.querySelectorAll<HTMLElement>('[data-open-link]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.openLink(a.dataset.openLink!);
    }),
  );
  bindPrivacy(el, ctx, person);
  bindEvidenceForm(el, ctx, { kind: 'person', person, links });
}

function personHeader(ctx: PanelContext, p: Person): string {
  const row = (label: TreeMessageKey, ev: Person['birth']) =>
    ev && (ev.date || ev.place)
      ? `<tr><th>${t(label)}</th><td>${esc(ev.date ? gedcomDate(ev.date) : '')}${ev.date && ev.place ? '<br>' : ''}${esc(ev.place ?? '')}</td></tr>`
      : '';
  const privacy = ctx.treeId
    ? `<label class="privacy">${t('privacy.label')}
        <select class="tv-privacy">
          <option value="auto"${p.privacyOverride === null ? ' selected' : ''}>${t(p.presumedLiving ? 'privacy.autoLiving' : 'privacy.autoDeceased')}</option>
          <option value="private"${p.privacyOverride === 'private' ? ' selected' : ''}>${t('privacy.private')}</option>
          <option value="public"${p.privacyOverride === 'public' ? ' selected' : ''}>${t('privacy.public')}</option>
        </select></label>`
    : '';
  const living = p.presumedLiving && p.privacyOverride === null;
  return `
    ${p.isPrivate ? `<div class="private-badge" title="${esc(t('privacy.badgeTitle'))}">${t(living ? 'privacy.badgeLiving' : 'privacy.badge')}</div>` : ''}
    <h2>${esc(nameOf(p))}</h2>
    <p class="muted">${esc([lifespan(p), p.sex === 'M' ? t('sex.M') : p.sex === 'F' ? t('sex.F') : ''].filter(Boolean).join(' · '))}</p>
    <table class="events">
      ${row('event.birth', p.birth)}${row('event.baptism', p.baptism)}${row('event.death', p.death)}${row('event.burial', p.burial)}
      ${p.occupation ? `<tr><th>${t('event.occupation')}</th><td>${esc(p.occupation)}</td></tr>` : ''}
    </table>
    ${privacy}`;
}

function linkItem(ctx: PanelContext, r: Relationship, personId: string): string {
  const other = ctx.people.get(r.from === personId ? r.to : r.from);
  return `<li><a href="#" data-open-link="${r.id}"><span class="role">${esc(roleOf(r, personId, ctx.people))}</span> ${esc(other ? nameOf(other) : '?')}</a>${badge(r.confidence)}</li>`;
}

function timeline(ctx: PanelContext, ev: PersonEvidence | null, p: Person): string {
  if (!ctx.treeId) {
    return `<p class="note">${t('timeline.localNote', { file: esc(ctx.fileName) })}</p>`;
  }
  if (!ev) return '';
  const claimsBySource = new Map<string, Claim[]>();
  for (const c of ev.claims) claimsBySource.set(c.sourceId, [...(claimsBySource.get(c.sourceId) ?? []), c]);
  const yearOf = (s: Source) => s.recordYear ?? Math.min(...(claimsBySource.get(s.id) ?? []).map((c) => c.eventYear ?? Infinity));
  const sources = [...ev.sources].sort((a, b) => yearOf(a) - yearOf(b));
  const docs = sources.filter((s) => s.origin !== 'gedcom');
  const imported = sources.filter((s) => s.origin === 'gedcom');
  const items = docs.map((s) => {
    const y = yearOf(s);
    return `<li class="tl-item">
      <span class="tl-year">${Number.isFinite(y) ? y : '—'}</span>
      <div class="tl-card">
        <b>${esc(s.title)}</b>
        <div class="muted small">${esc(citationLine(s))}</div>
        ${documentPreview(s)}
        <ul class="claims">${(claimsBySource.get(s.id) ?? []).map((c) => `<li>${esc(c.statement)}</li>`).join('')}</ul>
      </div></li>`;
  });
  return `
    ${items.length ? `<ol class="tv-timeline">${items.join('')}</ol>` : `<p class="note">${esc(t('timeline.none', { name: shortNameOf(p) }))}</p>`}
    ${imported.map((s) => `<p class="muted small">${esc(t('timeline.imported', { file: s.document?.fileName ?? s.title }))}</p>`).join('')}`;
}

function bindPrivacy(el: HTMLElement, ctx: PanelContext, p: Person) {
  el.querySelector<HTMLSelectElement>('.tv-privacy')?.addEventListener('change', async (e) => {
    const v = (e.target as HTMLSelectElement).value as 'auto' | 'private' | 'public';
    await attempt(ctx, async () => {
      await api.setPrivacy(ctx.treeId!, p.id, v);
      await ctx.refresh();
    });
    ctx.openPerson(p.id);
  });
}

// ---------- Link ----------

export async function renderLinkPanel(el: HTMLElement, ctx: PanelContext, relId: string) {
  const r = ctx.rels.get(relId);
  if (!r) return;
  const a = ctx.people.get(r.from)!;
  const b = ctx.people.get(r.to)!;
  const title =
    r.kind === 'parent'
      ? `<a href="#" data-open-person="${a.id}">${esc(nameOf(a))}</a> <span class="muted">${esc(t('link.roleOf', { role: roleOf(r, b.id, ctx.people).toLowerCase() }))}</span> <a href="#" data-open-person="${b.id}">${esc(nameOf(b))}</a>`
      : `<a href="#" data-open-person="${a.id}">${esc(nameOf(a))}</a> <span class="muted">${t('link.and')}</span> <a href="#" data-open-person="${b.id}">${esc(nameOf(b))}</a>`;
  const headFor = (rel: Relationship) =>
    `${badge(rel.confidence)}<h2 class="link-title">${title}</h2><p class="muted">${t(rel.kind === 'parent' ? 'link.kind.parent' : 'link.kind.spouse')}</p>`;
  const head = headFor(r);
  const bindPeople = () =>
    el.querySelectorAll<HTMLElement>('[data-open-person]').forEach((x) =>
      x.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.openPerson(x.dataset.openPerson!);
      }),
    );

  if (!ctx.treeId) {
    el.innerHTML = `${head}<p class="note">${t('link.localNote', { file: esc(ctx.fileName) })}</p>`;
    bindPeople();
    return;
  }
  el.innerHTML = head + `<p class="muted">${t('link.loading')}</p>`;
  let ev: RelationshipEvidence;
  try {
    ev = await api.relationshipEvidence(ctx.treeId, relId);
  } catch (e) {
    el.innerHTML = head + `<p class="error">${esc(errorText(e))}</p>`;
    return;
  }
  // Someone else (another tab, the AI reader) may have changed it since the chart loaded.
  if (ev.relationship.confidence !== r.confidence) void ctx.refresh();
  const sources = new Map(ev.sources.map((s) => [s.id, s]));
  el.innerHTML = `
    ${headFor(ev.relationship)}
    <ul class="reasons">${ev.explanation.reasons.map((x) => `<li>${esc(translateReason(x))}</li>`).join('')}</ul>
    <h3>${t('link.argument')}</h3>
    <textarea class="tv-argument" rows="3" aria-label="${esc(t('link.argument'))}" placeholder="${esc(t('link.argumentPlaceholder'))}">${esc(ev.relationship.argument ?? '')}</textarea>
    <button class="small-btn tv-save-argument" type="button">${t('link.saveArgument')}</button>
    <h3>${t('link.evidence')} <span class="muted">(${formatNumber(ev.claims.length)})</span></h3>
    ${ev.claims.length ? '' : `<p class="note">${t('link.noEvidence')}</p>`}
    <ul class="evidence">${ev.claims
      .map((c) => {
        const s = sources.get(c.sourceId);
        return `<li class="claim-card">
          ${claimMeta(c, relId)}
          <p class="statement">${esc(c.statement)}</p>
          ${s ? `<div class="source"><b>${esc(s.title)}</b><div class="muted small">${esc(citationLine(s))}</div>${documentPreview(s, true)}
            ${s.transcription ? `<details><summary>${t('link.transcription')}</summary><p class="transcription">${esc(s.transcription)}</p></details>` : ''}</div>` : ''}
          <div class="claim-actions">
            ${c.review === 'proposed' ? `<button class="small-btn" data-review="accepted" data-claim="${c.id}">${t('claim.confirm')}</button><button class="small-btn" data-review="rejected" data-claim="${c.id}">${t('claim.reject')}</button>` : ''}
            <button class="link-btn" data-unlink="${c.id}">${t('claim.unlink')}</button>
          </div>
        </li>`;
      })
      .join('')}</ul>
    <details class="add-evidence"${ev.claims.length ? '' : ' open'}><summary class="btn">${t('link.addEvidence')}</summary>${evidenceForm({ kind: 'link', rel: r, ctx })}</details>
  `;
  bindPeople();
  el.querySelector('.tv-save-argument')!.addEventListener('click', () =>
    attempt(ctx, async () => {
      await api.setArgument(ctx.treeId!, relId, el.querySelector<HTMLTextAreaElement>('.tv-argument')!.value);
      ctx.toast(t('link.argumentSaved'));
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((btn) =>
    btn.addEventListener('click', () =>
      attempt(ctx, async () => {
        const res = await api.reviewClaim(ctx.treeId!, btn.dataset.claim!, btn.dataset.review as 'accepted' | 'rejected');
        await afterChange(ctx, relId, res.changed);
      }),
    ),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach((btn) =>
    btn.addEventListener('click', () =>
      attempt(ctx, async () => {
        const res = await api.unlinkClaim(ctx.treeId!, btn.dataset.unlink!, relId);
        await afterChange(ctx, relId, res.changed);
      }),
    ),
  );
  bindEvidenceForm(el, ctx, { kind: 'link', rel: r });
}

async function afterChange(ctx: PanelContext, relId: string, changed: Relationship[]) {
  await ctx.refresh();
  const mine = changed.find((c) => c.id === relId);
  if (mine) ctx.toast(t('toast.linkNow', { level: levelLabel(mine.confidence) }));
  else if (changed.length) ctx.toast(t('toast.linksChanged', { count: changed.length }));
  ctx.openLink(relId);
}

// ---------- Add evidence ----------

type Target = { kind: 'link'; rel: Relationship } | { kind: 'person'; person: Person; links: Relationship[] };

function evidenceForm(target: Target & { ctx: PanelContext }): string {
  const linkChoice =
    target.kind === 'person'
      ? `<label>${t('form.forLink')}
          <select name="relationshipId"><option value="">${esc(t('form.noLink', { name: shortNameOf(target.person) }))}</option>
          ${target.links
            .map((r) => {
              const other = target.ctx.people.get(r.from === target.person.id ? r.to : r.from);
              return `<option value="${r.id}">${esc(roleOf(r, target.person.id, target.ctx.people))}: ${esc(other ? nameOf(other) : '?')}</option>`;
            })
            .join('')}</select></label>`
      : '';
  const ph = (key: TreeMessageKey) => `placeholder="${esc(t(key))}"`;
  const defaultKind = target.kind === 'link' && target.rel.kind === 'spouse' ? 'marriage' : 'baptism';
  return `<form class="evidence-form">
    <fieldset>
      <legend>${t('form.document')}</legend>
      <div class="segmented small">
        <label><input type="radio" name="sourceMode" value="new" checked /><span>${t('form.uploadNew')}</span></label>
        <label><input type="radio" name="sourceMode" value="existing" /><span>${t('form.existing')}</span></label>
      </div>
      <div class="src-new">
        <label>${t('form.file')} <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" /></label>
        <label>${t('form.title')} <input name="title" ${ph('form.titlePlaceholder')} /></label>
        <label>${t('form.kind')} <select name="kind">${options(SOURCE_KINDS)}</select></label>
        <div class="row">
          <label>${t('form.recordDate')} <input name="recordDate" ${ph('form.datePlaceholder')} /></label>
          <label>${t('form.language')} <input name="language" ${ph('form.languagePlaceholder')} size="4" /></label>
        </div>
        <label>${t('form.archive')} <input name="archive" ${ph('form.archivePlaceholder')} /></label>
        <div class="row">
          <label>${t('form.book')} <input name="book" /></label><label>${t('form.folio')} <input name="folio" /></label><label>${t('form.entry')} <input name="entry" /></label>
        </div>
        <label>${t('form.url')} <input name="url" type="url" placeholder="https://" /></label>
        <label>${t('form.transcription')} <textarea name="transcription" rows="2"></textarea></label>
      </div>
      <div class="src-existing" hidden><select name="sourceId" aria-label="${esc(t('form.document'))}"><option value="">${t('form.loading')}</option></select></div>
    </fieldset>
    <fieldset>
      <legend>${t('form.says')}</legend>
      <label>${t('form.statement')} <textarea name="statement" rows="3" required ${ph('form.statementPlaceholder')}></textarea></label>
      <div class="row">
        <label>${t('form.about')} <select name="claimKind">${options(CLAIM_KIND_CHOICES, defaultKind)}</select></label>
        <label>${t('form.eventDate')} <input name="eventDate" ${ph('form.datePlaceholder')} /></label>
      </div>
      <label>${t('form.informant')} <select name="information">${options(INFORMATION)}</select></label>
      <label>${t('form.reading')} <select name="reading">${options(READING)}</select></label>
      ${linkChoice}
      <div class="row">
        <label>${t('form.stance')} <select name="stance"><option value="supports">${t('form.supports')}</option><option value="contradicts">${t('form.contradicts')}</option></select></label>
        <label>${t('form.evidence')} <select name="evidence"><option value="direct">${t('form.direct')}</option><option value="indirect">${t('form.indirect')}</option></select></label>
      </div>
    </fieldset>
    <p class="error" hidden></p>
    <button class="btn primary" type="submit">${t('form.submit')}</button>
  </form>`;
}

function rolesFor(r: Relationship, people: Map<string, Person>): ClaimPersonLink[] {
  if (r.kind === 'spouse') return [{ personId: r.from, role: 'spouse' }, { personId: r.to, role: 'spouse' }];
  const sex = people.get(r.from)?.sex;
  const parentRole: ClaimRole = sex === 'M' ? 'father' : sex === 'F' ? 'mother' : 'parent';
  return [{ personId: r.to, role: 'subject' }, { personId: r.from, role: parentRole }];
}

function bindEvidenceForm(el: HTMLElement, ctx: PanelContext, target: Target) {
  const form = el.querySelector<HTMLFormElement>('.evidence-form');
  if (!form || !ctx.treeId) return;
  const treeId = ctx.treeId;
  const existing = form.querySelector<HTMLSelectElement>('[name=sourceId]')!;
  let loaded = false;
  form.querySelectorAll<HTMLInputElement>('[name=sourceMode]').forEach((radio) =>
    radio.addEventListener('change', async () => {
      const useExisting = radio.value === 'existing' && radio.checked;
      form.querySelector<HTMLElement>('.src-new')!.hidden = useExisting;
      form.querySelector<HTMLElement>('.src-existing')!.hidden = !useExisting;
      if (useExisting && !loaded) {
        loaded = true;
        try {
          const sources = (await api.listSources(treeId)).filter((s) => s.origin !== 'gedcom');
          existing.innerHTML = sources.length
            ? sources.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')
            : `<option value="">${t('form.noDocuments')}</option>`;
          // A choice kept across a language change (see the Tree view's re-render).
          if (existing.dataset.keep) existing.value = existing.dataset.keep;
        } catch (e) {
          loaded = false;
          existing.innerHTML = `<option value="">${esc(errorText(e))}</option>`;
        }
      }
    }),
  );
  // The stance / evidence pickers only matter when the claim is linked to a relationship.
  const relSelect = form.querySelector<HTMLSelectElement>('[name=relationshipId]');
  const syncStance = () => {
    const row = form.querySelector<HTMLElement>('[name=stance]')!.closest<HTMLElement>('.row')!;
    row.hidden = !!relSelect && !relSelect.value;
  };
  relSelect?.addEventListener('change', syncStance);
  syncStance();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector<HTMLElement>('.error')!;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    err.hidden = true;
    button.disabled = true;
    try {
      let sourceId = get('sourceId');
      if (get('sourceMode') === 'new') {
        const file = f.get('file');
        const upload = file instanceof File && file.size ? file : undefined;
        if (!upload && !get('title')) throw new Error(t('form.needFileOrTitle'));
        const fields = Object.fromEntries(
          ['title', 'kind', 'recordDate', 'language', 'archive', 'book', 'folio', 'entry', 'url', 'transcription'].map((k) => [k, get(k)]),
        );
        sourceId = (await api.createSource(treeId, fields, upload)).id;
      } else if (!sourceId) throw new Error(t('form.needDocument'));

      const rel = target.kind === 'link' ? target.rel : ctx.rels.get(get('relationshipId'));
      const persons = rel ? rolesFor(rel, ctx.people) : [];
      if (target.kind === 'person' && !persons.some((p) => p.personId === target.person.id)) persons.push({ personId: target.person.id, role: 'subject' });
      const claim: NewClaim = {
        kind: get('claimKind') as NewClaim['kind'],
        statement: get('statement'),
        eventDate: get('eventDate') || undefined,
        information: get('information') as NewClaim['information'],
        reading: get('reading') as NewClaim['reading'],
        persons,
        relationships: rel
          ? [{ relationshipId: rel.id, stance: get('stance') as 'supports' | 'contradicts', evidence: get('evidence') as 'direct' | 'indirect' }]
          : [],
      };
      const res = await api.addClaim(treeId, sourceId, claim);
      if (target.kind === 'link') await afterChange(ctx, target.rel.id, res.changed);
      else {
        await ctx.refresh();
        if (res.changed.length) ctx.toast(t('toast.otherLinkNow', { level: levelLabel(res.changed[0].confidence) }));
        else ctx.toast(t('toast.documentAdded'));
        ctx.openPerson(target.person.id);
      }
    } catch (x) {
      err.textContent = errorText(x);
      err.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}
