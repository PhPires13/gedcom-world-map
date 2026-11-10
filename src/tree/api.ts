// Browser client for the evidence API (`server/`).

import type {
  Claim,
  ClaimKind,
  ClaimPersonLink,
  ClaimRelationshipLink,
  InformationQuality,
  Person,
  PersonEvidence,
  ReadingConfidence,
  Relationship,
  RelationshipEvidence,
  ReviewStatus,
  Source,
  TreeDetail,
  TreeSummary,
} from '../model';

/**
 * Where the API lives. In dev the server runs on its own port (`npm run server`); set
 * `VITE_API_URL` to point elsewhere, or to '' when the API is served from the same origin.
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Absolute URL for a path the API returned (e.g. a document's `url`). */
export const apiUrl = (path: string) => `${API_BASE}${path}`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(apiUrl(path), init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | undefined)?.error ?? res.statusText);
  return data as T;
}

/** True when the API answers within `timeoutMs`. */
export async function serverAvailable(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface NewClaim {
  kind: ClaimKind;
  statement: string;
  eventDate?: string;
  eventPlace?: string;
  information: InformationQuality;
  reading: ReadingConfidence;
  persons: ClaimPersonLink[];
  relationships: Omit<ClaimRelationshipLink, 'note'>[];
}

type Changed = { claim: Claim; changed: Relationship[] };

const t = (treeId: string) => `/api/trees/${treeId}`;

export const api = {
  listTrees: () => request<TreeSummary[]>('GET', '/api/trees'),
  createTree: (name: string) => request<TreeSummary>('POST', '/api/trees', { name }),
  getTree: (treeId: string) => request<TreeDetail>('GET', t(treeId)),
  deleteTree: (treeId: string) => request<void>('DELETE', t(treeId)),
  importGedcom: (treeId: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return request<{ peopleCreated: number; relationshipsCreated: number }>('POST', `${t(treeId)}/import`, form);
  },
  importGedcomText: (treeId: string, fileName: string, text: string) =>
    request<{ peopleCreated: number }>('POST', `${t(treeId)}/import`, { fileName, text }),
  listSources: (treeId: string) => request<Source[]>('GET', `${t(treeId)}/sources`),
  /** `fields`: title, kind, recordDate, language, transcription, archive, collection, book, folio, entry, url. */
  createSource: (treeId: string, fields: Record<string, string>, file?: File) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v.trim()) form.set(k, v.trim());
    if (file) form.set('file', file);
    return request<Source>('POST', `${t(treeId)}/sources`, form);
  },
  addClaim: (treeId: string, sourceId: string, claim: NewClaim) =>
    request<Changed>('POST', `${t(treeId)}/sources/${sourceId}/claims`, claim),
  reviewClaim: (treeId: string, claimId: string, review: ReviewStatus) =>
    request<Changed>('PATCH', `${t(treeId)}/claims/${claimId}`, { review }),
  unlinkClaim: (treeId: string, claimId: string, relId: string) =>
    request<Changed>('DELETE', `${t(treeId)}/claims/${claimId}/relationships/${relId}`),
  personEvidence: (treeId: string, personId: string) =>
    request<PersonEvidence>('GET', `${t(treeId)}/people/${personId}/evidence`),
  setPrivacy: (treeId: string, personId: string, privacy: 'private' | 'public' | 'auto') =>
    request<Person>('PUT', `${t(treeId)}/people/${personId}/privacy`, { privacy }),
  relationshipEvidence: (treeId: string, relId: string) =>
    request<RelationshipEvidence>('GET', `${t(treeId)}/relationships/${relId}/evidence`),
  setArgument: (treeId: string, relId: string, argument: string) =>
    request<Relationship>('PATCH', `${t(treeId)}/relationships/${relId}`, { argument }),
  recompute: (treeId: string) => request<{ changed: Relationship[] }>('POST', `${t(treeId)}/recompute`),
};
