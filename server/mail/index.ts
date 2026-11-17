// Picks the mailer from the environment (used by server/main.ts):
//
//   MAIL_PROVIDER   console (default) | resend
//   MAIL_FROM       sender, e.g. "Mapa de família <pedidos@example.com>" (required for resend; the
//                   domain must be verified in Resend: SPF + DKIM records)
//   MAIL_REPLY_TO   optional Reply-To (customers answer review requests by replying)
//   RESEND_API_KEY  re_… (MAIL_PROVIDER=resend); never commit it
//   MAIL_DIR        console mailer: where .eml copies are written (default: <OS temp>/heritage-map-mail)
//   MAIL_BRAND      name at the top of every mail (default: "Mapa de família" / "Family map" / "Mapa familiar")
//   REVIEW_URL      where the delivered mail's "Leave a review" button goes (default: ask to reply)

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleMailer } from './console';
import { ResendMailer } from './resend';
import type { Mailer } from './types';

export type { Mail, Mailer } from './types';
export { ConsoleMailer } from './console';
export { ResendMailer } from './resend';

export function mailerFromEnv(env: NodeJS.ProcessEnv): { mailer: Mailer; summary: string } {
  const provider = (env.MAIL_PROVIDER || 'console').toLowerCase();
  if (provider === 'resend') {
    const mailer = new ResendMailer({ apiKey: env.RESEND_API_KEY ?? '', from: env.MAIL_FROM ?? '', replyTo: env.MAIL_REPLY_TO || undefined });
    return { mailer, summary: `Mail: Resend, from ${env.MAIL_FROM}` };
  }
  if (provider !== 'console') throw new Error(`MAIL_PROVIDER must be "console" or "resend", not "${provider}"`);
  const dir = env.MAIL_DIR || join(tmpdir(), 'heritage-map-mail');
  return { mailer: new ConsoleMailer({ dir, from: env.MAIL_FROM || 'dev@localhost' }), summary: `Mail: console only (nothing is sent; copies in ${dir})` };
}
