// Starts the API server.
//
//   npm run server              → http://localhost:8787, data in server/.data/
//
// Environment:
//   PORT          default 8787
//   DATA_DIR      where the dev database and documents live (default server/.data)
//   CORS_ORIGINS  comma-separated browser origins allowed to call the API (default: any localhost port)
//   Shop settings (Stripe, Prodigi, links, operators): see server/commerce/setup.ts

import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { ensureDevUser } from './auth';
import { migrate, openPglite } from './db';
import { commerceFromEnv } from './commerce/setup';
import { LocalDiskStorage } from './storage';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('./.data/', import.meta.url));

mkdirSync(`${dataDir}/pg`, { recursive: true });
const db = await openPglite(`${dataDir}/pg`);
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
await ensureDevUser(db);

const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim());
const storage = new LocalDiskStorage(`${dataDir}/documents`);
const now = () => new Date();
const { commerce, summary } = commerceFromEnv(process.env, { db, storage, now, dataDir, port });
console.log(summary);
const app = createApp({
  db,
  storage,
  now,
  commerce,
  corsOrigin: origins ? (o) => (origins.includes(o) ? o : null) : undefined,
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port} (data in ${dataDir})`);
  // Orders interrupted by a restart (paid but no print file yet, or not yet sent to the partner).
  void commerce.pipeline.resume().then((n) => n && console.log(`Resumed ${n} unfinished order(s)`));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void db.close().then(() => process.exit(0));
  });
}
