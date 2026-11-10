// Who is making the request. There are no accounts yet: every request is the single dev user.
// To add accounts, replace `devUser()` with a session / token lookup that sets `c.var.user` (and
// returns 401 when there is none). Every route already reads the user from there and every tree
// query is scoped to `owner_id = user.id`, so nothing else needs to change.

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

export const authenticate = createMiddleware<AuthEnv>(async (c, next) => {
  c.set('user', DEV_USER);
  await next();
});
