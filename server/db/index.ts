// Database access. The app only sees the small `Db` interface, so the same code runs on PGlite
// (Postgres compiled to WebAssembly: no install, used in dev and tests) and on a real Postgres in
// production (add an adapter for `pg` / `postgres.js` that implements these three methods).

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export interface Db {
  /** Runs one parameterised statement ($1, $2, …) and returns its rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction: committed if it resolves, rolled back if it throws. */
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

function wrap(conn: PgliteLike, tx: (fn: (tx: Db) => Promise<unknown>) => Promise<unknown>, close: () => Promise<void>): Db {
  return {
    query: async <T>(sql: string, params?: unknown[]) => (await conn.query<T>(sql, params)).rows,
    exec: async (sql) => void (await conn.exec(sql)),
    transaction: <R>(fn: (tx: Db) => Promise<R>) => tx(fn) as Promise<R>,
    close,
  };
}

/**
 * Opens a PGlite database: in memory when `dataDir` is undefined (tests), otherwise persisted in
 * that folder (dev).
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const pg = await PGlite.create(dataDir);
  const nested = (): never => {
    throw new Error('Nested transactions are not supported');
  };
  return wrap(
    pg,
    (fn) =>
      pg.transaction((t) =>
        fn(
          wrap(t, nested, async () => {
            /* closing a transaction handle is a no-op */
          }),
        ),
      ),
    () => pg.close(),
  );
}

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/**
 * Applies the `NNN_name.sql` files in `migrations/` that have not run yet, in order, each in its
 * own transaction. Applied names are kept in `schema_migrations`. Never edit an applied file; add
 * a new one.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(`${dir}/${file}`, 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
