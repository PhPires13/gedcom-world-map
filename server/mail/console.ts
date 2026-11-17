// The development mailer: nothing leaves the machine. Every mail is kept in memory (`sent`, read
// by tests), logged in one line, and — when given a folder — written there as an .eml file you
// can open in any mail app (in dev: the OS temp folder, see mailerFromEnv).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mail, Mailer } from './types';

/** Encodes a header value that may hold accents (RFC 2047). */
const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`);
const b64 = (s: string) =>
  Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/.{76}/g, '$&\r\n');

export function toEml(mail: Mail, from: string, date = new Date()): string {
  const boundary = `b_${date.getTime().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return [
    `From: ${header(from)}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    `X-Mail-Tag: ${mail.tag}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(mail.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export class ConsoleMailer implements Mailer {
  readonly name = 'console';
  /** Every mail "sent", oldest first. */
  readonly sent: Mail[] = [];
  /** Set to make the next sends fail (tests of failure handling). */
  failWith?: Error;

  constructor(private readonly opts: { dir?: string; from?: string; log?: boolean } = {}) {}

  async send(mail: Mail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(mail);
    let where = '';
    if (this.opts.dir) {
      mkdirSync(this.opts.dir, { recursive: true });
      const file = join(this.opts.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mail.tag}.eml`);
      writeFileSync(file, toEml(mail, this.opts.from ?? 'dev@localhost'));
      where = ` → ${file}`;
    }
    if (this.opts.log !== false) {
      console.log(`[mail] to ${mail.to}: ${mail.subject}${where}`);
      // A sign-in link is useless if you can't see it: print it in dev.
      if (mail.tag === 'magic_link') console.log(`[mail] sign-in link: ${/https?:\/\/\S+/.exec(mail.text)?.[0] ?? '(none)'}`);
    }
  }

  /** The last mail sent to `to` (optionally of a kind). */
  last(to?: string, tag?: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => (!to || m.to === to) && (!tag || m.tag === tag));
  }
}
