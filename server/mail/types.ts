// What the rest of the server sees of e-mail: one `send` call. Providers live next to this file.

export interface Mail {
  to: string;
  subject: string;
  /** Full HTML document (inline styles only: mail clients ignore <style> blocks unevenly). */
  html: string;
  /** Plain-text version, for clients that don't show HTML and for spam filters. */
  text: string;
  /** What kind of mail this is (magic_link, order_paid, …), for logs and tests. */
  tag: string;
  /** Same key → the provider sends it once, even if we retry (Resend keeps keys for 24 h). */
  idempotencyKey?: string;
}

export interface Mailer {
  /** Short name for logs: console, resend. */
  readonly name: string;
  /** Resolves once the provider accepted the mail; throws if it didn't. */
  send(mail: Mail): Promise<void>;
}
