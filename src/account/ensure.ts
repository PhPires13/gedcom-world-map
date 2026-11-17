// Signing in without leaving the page: buying needs an account (orders and saved trees belong to
// one), but a customer in the middle of designing a map must not lose it. So the buy button asks
// for a sign-in link to the e-mail they already typed, and waits here: they open the link (in
// another tab or on their phone), and as soon as this browser has a session the purchase goes on.

import { currentLocale } from '../i18n/core';
import { account, type Me } from './api';

export interface EnsureOptions {
  /** Called once the link is sent, so the page can say where to look. */
  onSent(email: string): void;
  /** How often to check for the session, and for how long (ms). */
  every?: number;
  timeout?: number;
  /** Stops waiting (the customer changed their mind). */
  signal?: AbortSignal;
  /** Where the link's tab lands once signed in. */
  next?: string;
}

export class SignInTimeout extends Error {
  constructor() {
    super('Sign-in link not opened in time');
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(signal.reason ?? new Error('aborted'));
    });
  });

/**
 * The signed-in user; if there is none, sends a sign-in link to `email` and waits until this
 * browser is signed in (the link sets the session cookie for the whole site).
 */
export async function ensureSignedIn(email: string, opts: EnsureOptions): Promise<Me> {
  const me = await account.me();
  if (me) return me;
  await account.requestLink(email, opts.next ?? '/account.html?from=checkout', currentLocale());
  opts.onSent(email);
  const every = opts.every ?? 3000;
  const until = Date.now() + (opts.timeout ?? 20 * 60_000);
  while (Date.now() < until) {
    await sleep(every, opts.signal);
    const now = await account.me().catch(() => undefined);
    if (now) return now;
  }
  throw new SignInTimeout();
}
