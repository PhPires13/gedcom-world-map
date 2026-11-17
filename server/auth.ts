// Who is making the request.
//
// People sign in with a link sent by e-mail (server/accounts.ts); signing in creates a session whose
// id lives in an httpOnly cookie (`hm_session`) and whose SHA-256 hash lives in `sessions`.
// `identify` reads that cookie on every API request and sets `c.var.user`; `requireUser` answers
// 401 when there is nobody. Every tree query is scoped to `owner_id = user.id`.
//
// AUTH_MODE
//   required (the default)  no session → no user: tree and account routes answer 401.
//   dev                     no session → the single dev user (dev@localhost), so local development
//                           and the tests work without signing in. Set by `npm run dev:all` and by
//                           vitest.config.ts. Never use it on a server others can reach.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Db } from './db';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export const DEV_USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'dev@localhost',
  displayName: 'Dev user',
};

export type AuthMode = 'dev' | 'required';

/** AUTH_MODE, defaulting to `required` (production). Anything unknown is refused at start. */
export function authModeFromEnv(env: NodeJS.ProcessEnv): AuthMode {
  const v = (env.AUTH_MODE || 'required').trim().toLowerCase();
  if (v !== 'dev' && v !== 'required') throw new Error(`AUTH_MODE must be "dev" or "required", not "${v}"`);
  return v;
}

/** Creates the dev user if it does not exist yet. */
export async function ensureDevUser(db: Db): Promise<User> {
  await db.query('insert into users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing', [
    DEV_USER.id,
    DEV_USER.email,
    DEV_USER.displayName,
  ]);
  return DEV_USER;
}

export type AuthEnv = { Variables: { user: User } };

// ---------- Tokens and sessions ----------

export const SESSION_COOKIE = 'hm_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** 256 random bits, URL-safe. Used for sign-in links and session ids. */
export const newToken = () => randomBytes(32).toString('base64url');
/** What the database keeps instead of a token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const toUser = (r: Record<string, unknown>): User => ({ id: r.id as string, email: r.email as string, displayName: r.display_name as string });

export async function createSession(db: Db, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.query('insert into sessions (id_hash, user_id, created_at, expires_at) values ($1, $2, $3, $4)', [hashToken(token), userId, now, expiresAt]);
  return { token, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('delete from sessions where id_hash = $1', [hashToken(token)]);
}

/** The user of a live session, if the token is one. */
export async function sessionUser(db: Db, token: string | undefined, now: Date): Promise<User | undefined> {
  if (!token || token.length > 100) return undefined;
  const [row] = await db.query('select u.* from sessions s join users u on u.id = s.user_id where s.id_hash = $1 and s.expires_at > $2', [hashToken(token), now]);
  return row ? toUser(row) : undefined;
}

/** Finds the account of a (verified) e-mail address, creating it on first sign-in. */
export async function userForEmail(db: Db, email: string, now: Date): Promise<User> {
  const [row] = await db.query(
    `insert into users (id, email, display_name, last_login_at) values ($1, $2, $3, $4)
     on conflict (email) do update set last_login_at = excluded.last_login_at returning *`,
    [randomUUID(), email, email.split('@')[0], now],
  );
  return toUser(row);
}

// ---------- Middleware ----------

/** Sets `c.var.user` from the session cookie (or, in dev mode only, to the dev user). Never refuses. */
export function identify(db: Db, mode: AuthMode, now: () => Date) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = await sessionUser(db, getCookie(c, SESSION_COOKIE), now());
    if (user) c.set('user', user);
    else if (mode === 'dev') c.set('user', DEV_USER);
    await next();
  });
}

/** The signed-in user, if any (for routes that also serve guests). */
export const currentUser = (c: Context<AuthEnv>): User | undefined => c.var.user as User | undefined;

/** 401 unless someone is signed in. */
export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  if (!currentUser(c)) return c.json({ error: 'Sign in to continue' }, 401);
  await next();
});
