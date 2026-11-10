// Starts the API server.
//
//   npm run server              → http://localhost:8787, data in server/.data/
//
// Environment:
//   PORT          default 8787
//   DATA_DIR      where the dev database and documents live (default server/.data)
//   CORS_ORIGINS  comma-separated browser origins allowed to call the API (default: any localhost port)

import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { ensureDevUser } from './auth';
import { migrate, openPglite } from './db';
import { LocalDiskStorage } from './storage';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('./.data/', import.meta.url));

const db = await openPglite(`${dataDir}/pg`);
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
await ensureDevUser(db);

const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim());
const app = createApp({
  db,
  storage: new LocalDiskStorage(`${dataDir}/documents`),
  corsOrigin: origins ? (o) => (origins.includes(o) ? o : null) : undefined,
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port} (data in ${dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void db.close().then(() => process.exit(0));
  });
}
