// Starts the API server.
//
//   npm run server              → http://localhost:8787, data in server/.data/ (sign-in required)
//   npm run dev:all             → the same with AUTH_MODE=dev, plus the web app on :5173
//
// Environment (all of them, with what needs a human, in server/README.md):
//   PORT           default 8787
//   DATA_DIR       where the dev database and documents live (default server/.data)
//   CORS_ORIGINS   comma-separated browser origins allowed to call the API (default: any localhost port)
//   AUTH_MODE      required (default: tree and account routes need a signed-in user) | dev (no session →
//                  the dev user; set by `npm run dev:all` and the tests; never on a reachable server)
//   PUBLIC_API_URL the API's address as browsers and partners see it (sign-in links point here)
//   APP_URL        the web app's address (where people land after signing in; Stripe's return pages)
//   COOKIE_SECURE  yes | no: session cookie only over HTTPS (default: yes unless AUTH_MODE=dev)
//   TRUST_PROXY    yes: take the client IP (for rate limits) from X-Forwarded-For; only behind a proxy
//   Mail (MAIL_PROVIDER, MAIL_FROM, RESEND_API_KEY, MAIL_DIR, MAIL_BRAND, REVIEW_URL): server/mail/index.ts
//   Shop settings (Stripe, Prodigi, links, OPERATOR_EMAILS): server/commerce/setup.ts

import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { authModeFromEnv, ensureDevUser } from './auth';
import { migrate, openPglite } from './db';
import { commerceFromEnv } from './commerce/setup';
import { mailerFromEnv } from './mail';
import { LocalDiskStorage } from './storage';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('./.data/', import.meta.url));
const mode = authModeFromEnv(process.env);
const yesNo = (v: string | undefined, fallback: boolean) => (v ? /^(yes|true|1)$/i.test(v) : fallback);

mkdirSync(`${dataDir}/pg`, { recursive: true });
const db = await openPglite(`${dataDir}/pg`);
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
if (mode === 'dev') await ensureDevUser(db);

const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim());
const storage = new LocalDiskStorage(`${dataDir}/documents`);
const now = () => new Date();
const { mailer, summary: mailSummary } = mailerFromEnv(process.env);
const { commerce, summary } = commerceFromEnv(process.env, { db, storage, now, dataDir, port, mode, mailer });
const apiUrl = (process.env.PUBLIC_API_URL || `http://localhost:${port}`).replace(/\/$/, '');
const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
console.log(summary);
console.log(mailSummary);
console.log(
  mode === 'dev'
    ? 'Accounts: AUTH_MODE=dev — requests without a session are the dev user (dev@localhost). Never expose this server.'
    : 'Accounts: sign-in required (AUTH_MODE=required)',
);
if (mode === 'required' && mailer.name === 'console') console.warn('WARNING: MAIL_PROVIDER is console: sign-in links and order e-mails are only logged, not sent.');

const app = createApp({
  db,
  storage,
  now,
  commerce,
  mailer,
  auth: {
    mode,
    apiUrl,
    appUrl,
    secureCookies: yesNo(process.env.COOKIE_SECURE, mode === 'required'),
    trustProxy: yesNo(process.env.TRUST_PROXY, false),
    brand: process.env.MAIL_BRAND || undefined,
  },
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
