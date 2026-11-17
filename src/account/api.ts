// Browser client for accounts (server/accounts.ts): who am I, ask for a sign-in link, sign out.
// The session is an httpOnly cookie set by the API, so every request sends credentials.

import { API_BASE, ApiError } from '../tree/api';
import type { Locale } from '../i18n/core';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  /** May use the operations page (OPERATOR_EMAILS). */
  operator: boolean;
}

/** The dev user of AUTH_MODE=dev (server/auth.ts). */
export const DEV_EMAIL = 'dev@localhost';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
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

export const account = {
  /** The signed-in user, or undefined when nobody is (401). Other failures throw. */
  async me(): Promise<Me | undefined> {
    try {
      return await request<Me>('GET', '/api/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return undefined;
      throw e;
    }
  },
  requestLink: (email: string, next: string | undefined, lang: Locale) => request<{ ok: true }>('POST', '/api/auth/request', { email, next, lang }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
};

/** This page's address as a `next` path for the sign-in page. */
export const herePath = () => location.pathname + location.search + location.hash;

/** The sign-in page, coming back to `next` (default: this page). */
export const loginUrl = (next = herePath()) => `./login.html?next=${encodeURIComponent(next)}`;
