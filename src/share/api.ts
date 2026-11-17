// Browser client for the share routes (server/shares.ts).

import { API_BASE, ApiError } from '../tree/api';
import type { SharedMap, ShareInfo, ShareSnapshot } from './snapshot';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | undefined)?.error ?? res.statusText);
  return data as T;
}

export const shareApi = {
  create: (snapshot: ShareSnapshot) => request<ShareInfo>('POST', '/api/shares', snapshot),
  mine: () => request<ShareInfo[]>('GET', '/api/shares'),
  remove: (id: string) => request<void>('DELETE', `/api/shares/${encodeURIComponent(id)}`),
  get: (id: string) => request<SharedMap>('GET', `/api/shares/${encodeURIComponent(id)}`),
};

/** The link to send: the server's preview page (so WhatsApp & co. show a picture), which opens share.html. */
export const shareLink = (s: Pick<ShareInfo, 'path'>) => `${API_BASE || location.origin}${s.path}`;

/** WhatsApp's "send to…" link with the message filled in. */
export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
