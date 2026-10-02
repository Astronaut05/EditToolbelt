/**
 * Shared by the server build's end-to-end tests: the test database, signing
 * in through the email outbox the server writes (MAIL_OUTBOX_DIR), and TOTP
 * codes for the admin's two-factor step.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDb, eq, users, type Db } from '@etb/db';
import { expect, type Page } from '@playwright/test';

import { OUTBOX } from '../scripts/server-env.ts';

let made: ReturnType<typeof createDb> | null = null;

/** The test database (TEST_DATABASE_URL), opened on first use. */
export function testDb(): Db {
  made ??= createDb(process.env.TEST_DATABASE_URL ?? '', { max: 2 });
  return made.db;
}

export async function closeTestDb(): Promise<void> {
  const pool = made?.pool;
  made = null;
  await pool?.end();
}

export const newEmail = () => `e2e-${randomUUID()}@example.test`;

interface Mail {
  to: string;
  text: string;
}

/** The newest sign-in link sent to `email` once more than `after` have arrived. */
export async function linkFor(email: string, after = 0): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    let mails: Mail[] = [];
    try {
      mails = readdirSync(OUTBOX)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => JSON.parse(readFileSync(join(OUTBOX, name), 'utf8')) as Mail);
    } catch {
      // No outbox yet.
    }
    const mine = mails.filter((mail) => mail.to === email);
    if (mine.length > after) {
      const url = /https?:\/\/\S+/.exec(mine[mine.length - 1]?.text ?? '')?.[0];
      if (url) return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No sign-in email arrived');
}

export async function askForLink(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

export async function signIn(page: Page, email: string, earlier = 0) {
  await askForLink(page, email);
  await page.goto(await linkFor(email, earlier));
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
}

function base32(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error('not base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** The current 6-digit TOTP code for a base32 key (RFC 6238: SHA-1, 30 s). */
export function totp(key: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', base32(key)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Signs in a new account, makes it an admin and sets up TOTP; returns its id and the key. */
export async function becomeAdmin(page: Page): Promise<{ id: string; key: string }> {
  const email = newEmail();
  await signIn(page, email);
  const [admin] = await testDb()
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!admin) throw new Error('no user');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/two-factor$/);
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = (await page.getByText(/^Key:/).innerText()).replace('Key:', '').trim();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(10);
  await page.getByLabel('3. Enter the code the app shows').fill(totp(key));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Account' })).toBeVisible();
  return { id: admin.id, key };
}

/**
 * Switches the page to a colour scheme and waits until its CSS transitions
 * have finished. Fields and buttons fade their colours over a few hundred
 * ms; axe run straight after the switch can measure a colour halfway, as
 * light text on a still-light field, and report a contrast failure that no
 * one ever sees.
 */
export async function setScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  // Polls each frame until no animation that ends is still running. Not the
  // animations' `finished` promises: Chromium can leave those unsettled after
  // the transition has finished (seen on /admin/payments), and a loop, such
  // as a progress bar's pulse, never finishes at all.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      ),
  );
}
