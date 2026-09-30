/**
 * Sign-in email. SMTP when SMTP_URL is set (Mailpit on the local stack, a
 * provider after Go public); on local and test runs MAIL_OUTBOX_DIR can
 * instead hold each email as a JSON file, which the end-to-end tests read.
 * Never logs an address (docs/07 → Never log).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import nodemailer, { type Transporter } from 'nodemailer';

import { log } from '../lib/log';
import { serverEnv } from './env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: Transporter | undefined;

export async function sendMail(mail: Mail): Promise<void> {
  const env = serverEnv();
  const from = env.MAIL_FROM ?? `EditToolbelt <no-reply@${new URL(env.SITE_URL).hostname}>`;
  if (env.SMTP_URL) {
    transport ??= nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from, ...mail });
  } else if (env.MAIL_OUTBOX_DIR) {
    await mkdir(env.MAIL_OUTBOX_DIR, { recursive: true });
    await writeFile(
      join(env.MAIL_OUTBOX_DIR, `${String(Date.now())}-${randomUUID()}.json`),
      JSON.stringify({ from, ...mail }, null, 2),
    );
  } else {
    throw new Error('No mail transport: set SMTP_URL');
  }
  log.info('mail.sent');
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/** The magic-link email: plain words, the link, how long it lasts. */
export function signInMail(to: string, url: string): Mail {
  const lines = [
    'Here is your link to sign in to EditToolbelt:',
    '',
    url,
    '',
    'It works once, for 15 minutes. If you didn’t ask for it, ignore this email: nothing happens without the link.',
  ];
  return {
    to,
    subject: 'Sign in to EditToolbelt',
    text: lines.join('\n'),
    html: [
      '<p>Here is your link to sign in to EditToolbelt:</p>',
      `<p><a href="${escape(url)}">Sign in to EditToolbelt</a></p>`,
      '<p>It works once, for 15 minutes. If you didn’t ask for it, ignore this email: nothing happens without the link.</p>',
    ].join('\n'),
  };
}
