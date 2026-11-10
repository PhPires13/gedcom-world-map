// The side panel: a person's documents on a timeline, or a link's evidence, plus the form to add
// a document and a claim.

import {
  CONFIDENCE_LABELS,
  type Claim,
  type ClaimPersonLink,
  type ClaimRole,
  type Person,
  type PersonEvidence,
  type Relationship,
  type RelationshipEvidence,
  type Source,
} from '../model';
import { api, apiUrl, type NewClaim } from './api';
import { badge, citationLine, esc, lifespan, roleOf } from './format';

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

const SOURCE_KINDS = [
  ['original', 'Original record (register, certificate)'],
  ['derivative', 'Copy, extract or index'],
  ['authored', 'Compiled tree or book'],
] as const;
const CLAIM_KINDS = ['baptism', 'birth', 'marriage', 'death', 'burial', 'parentage', 'residence', 'occupation', 'name', 'other'] as const;
const INFORMATION = [
  ['primary', 'First-hand (the informant was there)'],
  ['secondary', 'Second-hand (repeated from others)'],
  ['undetermined', 'Can’t tell'],
] as const;
const READING = [
  ['clear', 'Clear'],
  ['likely', 'Mostly legible'],
  ['uncertain', 'Uncertain reading'],
] as const;

const options = (list: readonly (readonly [string, string])[] | readonly string[], selected?: string) =>
  list
    .map((o) => {
      const [v, label] = typeof o === 'string' ? [o, o[0].toUpperCase() + o.slice(1)] : o;
      return `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');

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
    link && `<span class="tag ${link.stance}">${link.stance === 'supports' ? 'Supports' : 'Contradicts'}</span>`,
    link && `<span class="tag">${link.evidence === 'direct' ? 'Direct' : 'Indirect'}</span>`,
    `<span class="tag">${c.information === 'primary' ? 'First-hand' : c.information === 'secondary' ? 'Second-hand' : 'Informant unknown'}</span>`,
    c.reading !== 'clear' ? `<span class="tag warn">${c.reading === 'likely' ? 'Mostly legible' : 'Uncertain reading'}</span>` : '',
    c.extractedBy.kind === 'ai'
      ? `<span class="tag ai">AI${c.review === 'proposed' ? ' · not reviewed' : c.review === 'rejected' ? ' · rejected' : ' · confirmed'}</span>`
      : '',
    c.review === 'rejected' && c.extractedBy.kind !== 'ai' ? '<span class="tag">Rejected</span>' : '',
  ];
  return `<div class="tags">${bits.filter(Boolean).join('')}</div>`;
}

// ---------- Person ----------

export async function renderPersonPanel(el: HTMLElement, ctx: PanelContext, personId: string) {
  const p = ctx.people.get(personId);
  if (!p) return;
  let evidence: PersonEvidence | null = null;
  el.innerHTML = personHeader(ctx, p) + '<p class="muted">Loading documents…</p>';
  if (ctx.treeId) {
    try {
      evidence = await api.personEvidence(ctx.treeId, personId);
    } catch (e) {
      el.innerHTML = personHeader(ctx, p) + `<p class="error">${esc(String(e))}</p>`;
      return;
    }
  }
  const person = evidence?.person ?? p;
  const links = ctx.linksOf(personId);
  el.innerHTML = `
    ${personHeader(ctx, person)}
    ${links.length ? `<h3>Family links</h3><ul class="link-list">${links.map((r) => linkItem(ctx, r, personId)).join('')}</ul>` : ''}
    <h3>Documents</h3>
    ${timeline(ctx, evidence, person)}
    ${ctx.treeId ? `<details class="add-evidence"><summary class="btn">Add a document about ${esc(person.givenName || person.name)}</summary>${evidenceForm({ kind: 'person', person, links, ctx })}</details>` : ''}
    <button class="btn wide tv-show-map" type="button">Show on map</button>
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
  const row = (label: string, ev: Person['birth']) =>
    ev && (ev.date || ev.place) ? `<tr><th>${label}</th><td>${esc(ev.date ?? '')}${ev.date && ev.place ? '<br>' : ''}${esc(ev.place ?? '')}</td></tr>` : '';
  const privacy = ctx.treeId
    ? `<label class="privacy">Visibility
        <select class="tv-privacy">
          <option value="auto"${p.privacyOverride === null ? ' selected' : ''}>Automatic (${p.presumedLiving ? 'presumed living: private' : 'deceased: visible'})</option>
          <option value="private"${p.privacyOverride === 'private' ? ' selected' : ''}>Always private</option>
          <option value="public"${p.privacyOverride === 'public' ? ' selected' : ''}>Visible to people I share with</option>
        </select></label>`
    : '';
  return `
    ${p.isPrivate ? `<div class="private-badge" title="Hidden from anyone you share the tree with">Private${p.presumedLiving && p.privacyOverride === null ? ' · presumed living' : ''}</div>` : ''}
    <h2>${esc(p.name)}</h2>
    <p class="muted">${[lifespan(p), p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : ''].filter(Boolean).join(' · ')}</p>
    <table class="events">
      ${row('Born', p.birth)}${row('Baptised', p.baptism)}${row('Died', p.death)}${row('Buried', p.burial)}
      ${p.occupation ? `<tr><th>Occupation</th><td>${esc(p.occupation)}</td></tr>` : ''}
    </table>
    ${privacy}`;
}

function linkItem(ctx: PanelContext, r: Relationship, personId: string): string {
  const other = ctx.people.get(r.from === personId ? r.to : r.from);
  return `<li><a href="#" data-open-link="${r.id}"><span class="role">${roleOf(r, personId, ctx.people)}</span> ${esc(other?.name ?? '?')}</a>${badge(r.confidence)}</li>`;
}

function timeline(ctx: PanelContext, ev: PersonEvidence | null, p: Person): string {
  if (!ctx.treeId) {
    return `<p class="note">Read from <b>${esc(ctx.fileName)}</b>. A GEDCOM file holds conclusions, not documents, so every link is Unsupported.
      Run the server (<code>npm run dev:all</code>) and import the file there to attach records.</p>`;
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
    ${items.length ? `<ol class="tv-timeline">${items.join('')}</ol>` : `<p class="note">No documents yet for ${esc(p.givenName || p.name)}.</p>`}
    ${imported.map((s) => `<p class="muted small">Imported from ${esc(s.document?.fileName ?? s.title)}: a compiled tree, not counted as evidence.</p>`).join('')}`;
}

function bindPrivacy(el: HTMLElement, ctx: PanelContext, p: Person) {
  el.querySelector<HTMLSelectElement>('.tv-privacy')?.addEventListener('change', async (e) => {
    const v = (e.target as HTMLSelectElement).value as 'auto' | 'private' | 'public';
    await api.setPrivacy(ctx.treeId!, p.id, v);
    await ctx.refresh();
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
      ? `<a href="#" data-open-person="${a.id}">${esc(a.name)}</a> <span class="muted">${roleOf(r, b.id, ctx.people).toLowerCase()} of</span> <a href="#" data-open-person="${b.id}">${esc(b.name)}</a>`
      : `<a href="#" data-open-person="${a.id}">${esc(a.name)}</a> <span class="muted">and</span> <a href="#" data-open-person="${b.id}">${esc(b.name)}</a>`;
  const headFor = (rel: Relationship) =>
    `${badge(rel.confidence)}<h2 class="link-title">${title}</h2><p class="muted">${rel.kind === 'parent' ? 'Parent and child' : 'Spouses'}</p>`;
  const head = headFor(r);
  const bindPeople = () =>
    el.querySelectorAll<HTMLElement>('[data-open-person]').forEach((x) =>
      x.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.openPerson(x.dataset.openPerson!);
      }),
    );

  if (!ctx.treeId) {
    el.innerHTML = `${head}<p class="note">Read from <b>${esc(ctx.fileName)}</b>, with no documents behind it. Run the server and import the file to attach evidence.</p>`;
    bindPeople();
    return;
  }
  el.innerHTML = head + '<p class="muted">Loading evidence…</p>';
  let ev: RelationshipEvidence;
  try {
    ev = await api.relationshipEvidence(ctx.treeId, relId);
  } catch (e) {
    el.innerHTML = head + `<p class="error">${esc(String(e))}</p>`;
    return;
  }
  // Someone else (another tab, the AI reader) may have changed it since the chart loaded.
  if (ev.relationship.confidence !== r.confidence) void ctx.refresh();
  const sources = new Map(ev.sources.map((s) => [s.id, s]));
  el.innerHTML = `
    ${headFor(ev.relationship)}
    <ul class="reasons">${ev.explanation.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>Argument</h3>
    <textarea class="tv-argument" rows="3" placeholder="Why do you conclude this? E.g. “The 1898 baptism names both parents; the 1921 marriage record agrees.”">${esc(ev.relationship.argument ?? '')}</textarea>
    <button class="small-btn tv-save-argument" type="button">Save argument</button>
    <h3>Evidence <span class="muted">(${ev.claims.length})</span></h3>
    ${ev.claims.length ? '' : '<p class="note">No documents support or contradict this link yet.</p>'}
    <ul class="evidence">${ev.claims
      .map((c) => {
        const s = sources.get(c.sourceId);
        return `<li class="claim-card">
          ${claimMeta(c, relId)}
          <p class="statement">${esc(c.statement)}</p>
          ${s ? `<div class="source"><b>${esc(s.title)}</b><div class="muted small">${esc(citationLine(s))}</div>${documentPreview(s, true)}
            ${s.transcription ? `<details><summary>Transcription</summary><p class="transcription">${esc(s.transcription)}</p></details>` : ''}</div>` : ''}
          <div class="claim-actions">
            ${c.review === 'proposed' ? `<button class="small-btn" data-review="accepted" data-claim="${c.id}">Confirm</button><button class="small-btn" data-review="rejected" data-claim="${c.id}">Reject</button>` : ''}
            <button class="link-btn" data-unlink="${c.id}">Remove from this link</button>
          </div>
        </li>`;
      })
      .join('')}</ul>
    <details class="add-evidence"${ev.claims.length ? '' : ' open'}><summary class="btn">Add evidence</summary>${evidenceForm({ kind: 'link', rel: r, ctx })}</details>
  `;
  bindPeople();
  el.querySelector('.tv-save-argument')!.addEventListener('click', async () => {
    await api.setArgument(ctx.treeId!, relId, el.querySelector<HTMLTextAreaElement>('.tv-argument')!.value);
    ctx.toast('Argument saved');
  });
  el.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const res = await api.reviewClaim(ctx.treeId!, btn.dataset.claim!, btn.dataset.review as 'accepted' | 'rejected');
      await afterChange(ctx, relId, res.changed);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const res = await api.unlinkClaim(ctx.treeId!, btn.dataset.unlink!, relId);
      await afterChange(ctx, relId, res.changed);
    }),
  );
  bindEvidenceForm(el, ctx, { kind: 'link', rel: r });
}

async function afterChange(ctx: PanelContext, relId: string, changed: Relationship[]) {
  await ctx.refresh();
  const mine = changed.find((c) => c.id === relId);
  if (mine) ctx.toast(`This link is now ${CONFIDENCE_LABELS[mine.confidence]}`);
  else if (changed.length) ctx.toast(`${changed.length} link${changed.length > 1 ? 's' : ''} changed confidence`);
  ctx.openLink(relId);
}

// ---------- Add evidence ----------

type Target = { kind: 'link'; rel: Relationship } | { kind: 'person'; person: Person; links: Relationship[] };

function evidenceForm(t: Target & { ctx: PanelContext }): string {
  const linkChoice =
    t.kind === 'person'
      ? `<label>Counts as evidence for
          <select name="relationshipId"><option value="">No family link (just about ${esc(t.person.givenName || t.person.name)})</option>
          ${t.links
            .map((r) => {
              const other = t.ctx.people.get(r.from === t.person.id ? r.to : r.from);
              return `<option value="${r.id}">${roleOf(r, t.person.id, t.ctx.people)}: ${esc(other?.name ?? '?')}</option>`;
            })
            .join('')}</select></label>`
      : '';
  return `<form class="evidence-form">
    <fieldset>
      <legend>Document</legend>
      <div class="segmented small">
        <label><input type="radio" name="sourceMode" value="new" checked /><span>Upload new</span></label>
        <label><input type="radio" name="sourceMode" value="existing" /><span>Already uploaded</span></label>
      </div>
      <div class="src-new">
        <label>Scan or photo <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" /></label>
        <label>Title <input name="title" placeholder="Baptism of Miguel Costa, Porto 1898" /></label>
        <label>Type <select name="kind">${options(SOURCE_KINDS)}</select></label>
        <div class="row">
          <label>Record date <input name="recordDate" placeholder="3 JAN 1898" /></label>
          <label>Language <input name="language" placeholder="pt" size="4" /></label>
        </div>
        <label>Archive <input name="archive" placeholder="Arquivo Distrital do Porto" /></label>
        <div class="row">
          <label>Book <input name="book" /></label><label>Folio <input name="folio" /></label><label>Entry <input name="entry" /></label>
        </div>
        <label>Online link <input name="url" type="url" placeholder="https://" /></label>
        <label>Transcription <textarea name="transcription" rows="2"></textarea></label>
      </div>
      <div class="src-existing" hidden><select name="sourceId"><option value="">Loading…</option></select></div>
    </fieldset>
    <fieldset>
      <legend>What it says</legend>
      <label>Statement <textarea name="statement" rows="3" required placeholder="Miguel, son of Manuel Costa and Rosa Lima, baptised 3 Jan 1898 in Sé, Porto."></textarea></label>
      <div class="row">
        <label>About <select name="claimKind">${options(CLAIM_KINDS, t.kind === 'link' ? (t.rel.kind === 'spouse' ? 'marriage' : 'baptism') : 'baptism')}</select></label>
        <label>Event date <input name="eventDate" placeholder="3 JAN 1898" /></label>
      </div>
      <label>Who gave the information <select name="information">${options(INFORMATION)}</select></label>
      <label>Reading <select name="reading">${options(READING)}</select></label>
      ${linkChoice}
      <div class="row">
        <label>It <select name="stance"><option value="supports">supports</option><option value="contradicts">contradicts</option></select> the link</label>
        <label>by <select name="evidence"><option value="direct">stating it directly</option><option value="indirect">indirect evidence</option></select></label>
      </div>
    </fieldset>
    <p class="error" hidden></p>
    <button class="btn primary" type="submit">Add evidence</button>
  </form>`;
}

function rolesFor(r: Relationship, people: Map<string, Person>): ClaimPersonLink[] {
  if (r.kind === 'spouse') return [{ personId: r.from, role: 'spouse' }, { personId: r.to, role: 'spouse' }];
  const sex = people.get(r.from)?.sex;
  const parentRole: ClaimRole = sex === 'M' ? 'father' : sex === 'F' ? 'mother' : 'parent';
  return [{ personId: r.to, role: 'subject' }, { personId: r.from, role: parentRole }];
}

function bindEvidenceForm(el: HTMLElement, ctx: PanelContext, t: Target) {
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
        const sources = (await api.listSources(treeId)).filter((s) => s.origin !== 'gedcom');
        existing.innerHTML = sources.length
          ? sources.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')
          : '<option value="">No documents uploaded yet</option>';
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
        if (!upload && !get('title')) throw new Error('Choose a file or give the source a title.');
        const fields = Object.fromEntries(
          ['title', 'kind', 'recordDate', 'language', 'archive', 'book', 'folio', 'entry', 'url', 'transcription'].map((k) => [k, get(k)]),
        );
        sourceId = (await api.createSource(treeId, fields, upload)).id;
      } else if (!sourceId) throw new Error('Choose a document.');

      const rel = t.kind === 'link' ? t.rel : ctx.rels.get(get('relationshipId'));
      const persons = rel ? rolesFor(rel, ctx.people) : [];
      if (t.kind === 'person' && !persons.some((p) => p.personId === t.person.id)) persons.push({ personId: t.person.id, role: 'subject' });
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
      if (t.kind === 'link') await afterChange(ctx, t.rel.id, res.changed);
      else {
        await ctx.refresh();
        if (res.changed.length) ctx.toast(`Link is now ${CONFIDENCE_LABELS[res.changed[0].confidence]}`);
        else ctx.toast('Document added');
        ctx.openPerson(t.person.id);
      }
    } catch (x) {
      err.textContent = x instanceof Error ? x.message : String(x);
      err.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}
