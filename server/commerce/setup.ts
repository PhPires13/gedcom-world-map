// Builds the shop from the environment (used by server/main.ts).
//
//   CATALOGUE_PATH          default config/catalogue.json
//   STRIPE_SECRET_KEY       sk_test_… (live keys are refused)        } without them, checkout is
//   STRIPE_WEBHOOK_SECRET   whsec_… (from `stripe listen` or the Dashboard) } off, unless:
//   FAKE_PAYMENTS=yes       dev only: a local simulated Checkout instead of Stripe (fake-stripe.ts)
//   STRIPE_PIX=yes          offer Pix for BRL orders (enable Pix in the Stripe Dashboard too)
//   PRODIGI_API_KEY         sandbox_… (live keys are refused); without it Prodigi orders wait for an operator
//   PRODIGI_WEBHOOK_SECRET  secret of the Prodigi webhook subscription
//   PUBLIC_API_URL          the API's address as partners and Stripe see it (default http://localhost:PORT);
//                           Prodigi must be able to download print files from it (use a tunnel in dev)
//   APP_URL                 the web app's address for Stripe's return pages (default http://localhost:5173)
//   FILE_LINK_SECRET        signs file links (default: a random secret kept in DATA_DIR/file-link-secret)
//   OPERATOR_EMAILS         comma-separated; default dev@localhost (the dev user)

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCatalogue } from '../../src/commerce/catalogue';
import { designOptionIds } from '../print/assets';
import { renderInWorker } from '../print/worker';
import type { Db } from '../db';
import type { DocumentStorage } from '../storage';
import { fakeStripe } from './fake-stripe';
import { manualFulfilment } from './fulfilment/manual';
import { prodigiFulfilment } from './fulfilment/prodigi';
import type { FulfilmentAdapter } from './fulfilment/types';
import { LinkSigner } from './links';
import { paymentsFromEnv, stripePayments, type Payments } from './payments';
import { createCommerce, type CommerceDeps } from './routes';
import type { RenderFiles } from './pipeline';

export const DEFAULT_CATALOGUE = fileURLToPath(new URL('../../config/catalogue.json', import.meta.url));

export function loadCatalogue(path = DEFAULT_CATALOGUE) {
  return parseCatalogue(JSON.parse(readFileSync(path, 'utf8')));
}

/** The real print renderer (public view in, PNG/PDF/SVG out), in a worker thread. */
export const renderFiles: RenderFiles = (detail, design, paper) => renderInWorker(detail, design, paper);

function linkSecret(env: NodeJS.ProcessEnv, dataDir: string) {
  if (env.FILE_LINK_SECRET) return env.FILE_LINK_SECRET;
  const file = `${dataDir}/file-link-secret`;
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

export function commerceFromEnv(env: NodeJS.ProcessEnv, opts: { db: Db; storage: DocumentStorage; now: () => Date; dataDir: string; port: number }) {
  const catalogue = loadCatalogue(env.CATALOGUE_PATH || DEFAULT_CATALOGUE);
  const apiUrl = (env.PUBLIC_API_URL || `http://localhost:${opts.port}`).replace(/\/$/, '');
  const notes: string[] = [];

  let payments: Payments | undefined = paymentsFromEnv(env, catalogue.placeholderPrices);
  let devRoutes: CommerceDeps['devRoutes'];
  if (payments) notes.push(`Stripe ${payments.mode} mode`);
  else if (env.FAKE_PAYMENTS === 'yes') {
    const secret = 'whsec_fake_local_only';
    const fake = fakeStripe(apiUrl, secret);
    payments = stripePayments(fake.stripe, 'sk_test_fake_local_only', secret);
    devRoutes = fake.mount;
    notes.push('SIMULATED payments (FAKE_PAYMENTS=yes, no Stripe keys)');
  } else notes.push('payments OFF (set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET, or FAKE_PAYMENTS=yes)');

  const fulfilment: Partial<Record<'prodigi' | 'manual', FulfilmentAdapter>> = { manual: manualFulfilment };
  if (env.PRODIGI_API_KEY) {
    fulfilment.prodigi = prodigiFulfilment({ apiKey: env.PRODIGI_API_KEY, webhookSecret: env.PRODIGI_WEBHOOK_SECRET });
    notes.push('Prodigi sandbox');
  } else notes.push('Prodigi OFF (orders for Prodigi markets wait for an operator)');

  const commerce = createCommerce(opts.db, opts.storage, opts.now, {
    catalogue,
    payments,
    fulfilment,
    links: new LinkSigner(linkSecret(env, opts.dataDir), apiUrl),
    render: renderFiles,
    designOptions: designOptionIds(),
    appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    operators: (env.OPERATOR_EMAILS || 'dev@localhost').split(',').map((s) => s.trim()).filter(Boolean),
    devRoutes,
  });
  if (catalogue.placeholderPrices) notes.push('PLACEHOLDER prices');
  return { commerce, summary: `Shop: ${notes.join('; ')}` };
}
