// Passwordless sign-in by e-mail ("magic links"). Mounted by createApp before `requireUser`.
//
//   POST /api/auth/request  {email, next?, lang?}   e-mails a sign-in link → {ok: true}
//   GET  /api/auth/verify?token=…                   uses the link: starts a session, redirects to `next`
//   POST /api/auth/logout                           ends the session
//
// The flow:
//   1. The login page posts the address. A random 256-bit token is made; only its SHA-256 hash is
//      stored (login_tokens), with the address, the `next` path and an expiry 15 minutes away.
//   2. The e-mail links to GET /api/auth/verify?token=… on the API.
//   3. Verify marks the token used in the same statement that checks it (single use, even with two
//      clicks at once), finds or creates the account for that address, replaces any session the
//      browser already had (no session fixation), sets the session cookie and redirects to APP_URL
//      + `next`. A bad, used or expired link redirects to /login.html?error=link.
//
// `next` must be a same-site relative path ("/order.html?id=…"): absolute URLs, "//host",
// backslashes and control characters are refused, so the sign-in can't be used as an open redirect.
//
// Rate limits (in memory, per API process: see rate-limit.ts): link requests per e-mail address
// (default 5 per 15 minutes) and per client IP (default 20 per 15 minutes); over the limit → 429
// with Retry-After. The client IP is the socket's address, or the first X-Forwarded-For entry when
// TRUST_PROXY=yes (only behind a proxy that sets it).

import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createSession, deleteSession, hashToken, newToken, SESSION_COOKIE, SESSION_TTL_MS, userForEmail, type AuthEnv } from './auth';
import type { Db } from './db';
import { badRequest } from './errors';
import { magicLinkMail, type MailLang } from './mail/templates';
import type { Mailer } from './mail/types';
import { RateLimiter, type RateLimit } from './rate-limit';
import { obj, optStr, str } from './validate';

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_LIMITS = {
  perEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
};

export interface AccountOptions {
  mailer: Mailer;
  /** The API's address as browsers see it: the e-mailed link points here. */
  apiUrl: string;
  /** The web app's address: where people land after signing in. */
  appUrl: string;
  /** Send the cookie only over HTTPS (production). */
  secureCookies: boolean;
  /** Take the client IP from X-Forwarded-For (only behind a proxy that sets it). */
  trustProxy: boolean;
  limits: { perEmail: RateLimit; perIp: RateLimit };
  /** Name at the top of the e-mail (MAIL_BRAND). */
  brand?: string;
  now: () => Date;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const LANGS: readonly MailLang[] = ['pt', 'en', 'es'];

/** `v` if it is a same-site relative path (with its query and hash), else undefined. */
export function safeNextPath(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v || v.length > 1000) return undefined;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\x00-\x1f\x7f]/.test(v)) return undefined;
  try {
    const base = 'http://same-site.invalid';
    const u = new URL(v, base);
    if (u.origin !== base) return undefined;
    return u.pathname + u.search + u.hash;
  } catch {
    return undefined;
  }
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  // @hono/node-server passes the Node request as `env.incoming`.
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

export function mountAccountRoutes(app: Hono<AuthEnv>, db: Db, opts: AccountOptions) {
  const ms = () => opts.now().getTime();
  const perEmail = new RateLimiter(opts.limits.perEmail, ms);
  const perIp = new RateLimiter(opts.limits.perIp, ms);
  const cookie = { httpOnly: true, secure: opts.secureCookies, sameSite: 'Lax', path: '/' } as const;

  app.post('/api/auth/request', async (c) => {
    const b = obj(await c.req.json().catch(() => null));
    const email = str(b.email, 'email', 254).trim().toLowerCase();
    if (!isEmail(email)) throw badRequest('email is not a valid address');
    const rawNext = optStr(b.next, 'next', 1000);
    const next = rawNext === undefined ? undefined : safeNextPath(rawNext);
    if (rawNext !== undefined && !next) throw badRequest('next must be a path on this site, like /account.html');
    const lang = LANGS.includes(b.lang as MailLang) ? (b.lang as MailLang) : 'pt';

    for (const [limiter, key] of [
      [perIp, `ip:${clientIp(c, opts.trustProxy)}`],
      [perEmail, `email:${email}`],
    ] as const) {
      const r = limiter.hit(key);
      if (!r.ok) return c.json({ error: 'Too many sign-in requests; wait a few minutes and try again', retryAfter: r.retryAfter }, 429, { 'Retry-After': String(r.retryAfter) });
    }

    const now = opts.now();
    const token = newToken();
    await db.query('delete from login_tokens where expires_at < $1', [new Date(now.getTime() - 24 * 3600 * 1000)]);
    await db.query('insert into login_tokens (token_hash, email, next_path, created_at, expires_at) values ($1, $2, $3, $4, $5)', [
      hashToken(token),
      email,
      next ?? null,
      now,
      new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
    ]);
    const url = `${opts.apiUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
    try {
      await opts.mailer.send({ ...magicLinkMail({ lang, url, minutes: LOGIN_TOKEN_TTL_MS / 60_000, brand: opts.brand }), to: email, tag: 'magic_link' });
    } catch (e) {
      console.error(`Sign-in e-mail to ${email} failed:`, e);
      return c.json({ error: 'The e-mail could not be sent; try again in a moment' }, 502);
    }
    return c.json({ ok: true });
  });

  app.get('/api/auth/verify', async (c) => {
    const token = c.req.query('token') ?? '';
    const now = opts.now();
    const [row] =
      token && token.length <= 100
        ? await db.query<{ email: string; next_path: string | null }>(
            'update login_tokens set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2 returning email, next_path',
            [hashToken(token), now],
          )
        : [];
    if (!row) return c.redirect(`${opts.appUrl}/login.html?error=link`, 303);

    const user = await userForEmail(db, row.email, now);
    // A fresh session id on every sign-in; the browser's old one (if any) stops working.
    const old = getCookie(c, SESSION_COOKIE);
    if (old) await deleteSession(db, old);
    await db.query('delete from sessions where user_id = $1 and expires_at < $2', [user.id, now]);
    const session = await createSession(db, user.id, now);
    setCookie(c, SESSION_COOKIE, session.token, { ...cookie, maxAge: Math.floor(SESSION_TTL_MS / 1000), expires: session.expiresAt });
    return c.redirect(`${opts.appUrl}${safeNextPath(row.next_path) ?? '/account.html'}`, 303);
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, cookie);
    return c.json({ ok: true });
  });
}
