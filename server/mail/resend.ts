// Resend (https://resend.com), over its HTTP API with `fetch`: no SDK, no dependency.
//
//   POST https://api.resend.com/emails   Authorization: Bearer re_…
//   { from, to: [..], subject, html, text, reply_to? }   → 200 { id }
//
// The sending domain must be verified in Resend (SPF and DKIM DNS records) before mail to
// customers is delivered; see server/README.md.

import type { Mail, Mailer } from './types';

export interface ResendOptions {
  apiKey: string;
  /** "Mapa de família <pedidos@example.com>": the address must be on a domain verified in Resend. */
  from: string;
  replyTo?: string;
  fetch?: typeof fetch;
  /** Default https://api.resend.com */
  baseUrl?: string;
}

export class ResendMailer implements Mailer {
  readonly name = 'resend';
  constructor(private readonly opts: ResendOptions) {
    if (!opts.apiKey) throw new Error('RESEND_API_KEY is required for MAIL_PROVIDER=resend');
    if (!opts.from) throw new Error('MAIL_FROM is required for MAIL_PROVIDER=resend');
  }

  async send(mail: Mail): Promise<void> {
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        ...(mail.idempotencyKey ? { 'Idempotency-Key': mail.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.opts.from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(this.opts.replyTo ? { reply_to: this.opts.replyTo } : {}),
        tags: [{ name: 'kind', value: mail.tag }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend answered ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}
