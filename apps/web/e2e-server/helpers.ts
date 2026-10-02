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
  // TEMPORARY (claude/debug-firefox-axe only): a bounded wait, then a report
  // of whatever is still running, so the Firefox hang prints instead of timing out.
  await page.emulateMedia({ colorScheme: scheme });
  const tag = `[setScheme-debug ${scheme}]`;
  const started = Date.now();
  const settled = () =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      );
  try {
    await page.waitForFunction(settled, undefined, { timeout: 3_000 });
    const count = await page.evaluate(() => document.getAnimations().length);
    console.log(
      `${tag} settled in ${String(Date.now() - started)} ms url=${page.url()} animations=${String(count)} pages=${String(page.context().pages().length)}`,
    );
    return;
  } catch (error) {
    console.log(
      `${tag} NOT settled after ${String(Date.now() - started)} ms url=${page.url()} pages=${String(page.context().pages().length)}: ${String(error).split('\n')[0] ?? ''}`,
    );
  }
  const snapshot = () =>
    page.evaluate(async () => {
      type Loose = Animation & {
        transitionProperty?: string;
        animationName?: string;
        effect: (AnimationEffect & { target?: Element | null; pseudoElement?: string | null }) | null;
      };
      const stuck = () =>
        (document.getAnimations() as Loose[]).filter(
          (a) =>
            a.playState === 'running' &&
            Number.isFinite(Number(a.effect?.getComputedTiming().endTime)),
        );
      const describe = (a: Loose) => {
        const timing = a.effect?.getComputedTiming();
        const target = a.effect?.target ?? null;
        const rect = target?.getBoundingClientRect();
        const details = target?.closest('details') ?? null;
        let detailsContent: string | null = null;
        if (details) {
          try {
            const cs = getComputedStyle(details, '::details-content');
            detailsContent = `${cs.display}/${cs.contentVisibility}`;
          } catch (error) {
            detailsContent = String(error);
          }
        }
        return {
          kind: a.constructor.name,
          playState: a.playState,
          pending: a.pending,
          startTime: a.startTime,
          currentTime: a.currentTime,
          endTime: timing?.endTime,
          activeDuration: timing?.activeDuration,
          progress: timing?.progress,
          property: a.transitionProperty ?? a.animationName ?? a.id,
          pseudo: a.effect?.pseudoElement ?? null,
          rect: rect
            ? [Math.round(rect.top), Math.round(rect.bottom), Math.round(rect.width), Math.round(rect.height)]
            : null,
          checkVisibility: target ? target.checkVisibility() : null,
          display: target ? getComputedStyle(target).display : null,
          inDetails: details ? (details.open ? 'open' : 'closed') : 'no',
          detailsContent,
          target: target ? target.outerHTML.slice(0, 200) : null,
        };
      };
      const t0 = document.timeline.currentTime;
      const p0 = performance.now();
      const before = stuck().map((a) => a.currentTime);
      let frames = 0;
      let counting = true;
      const tick = () => {
        frames += 1;
        if (counting) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise((resolve) => setTimeout(resolve, 500));
      counting = false;
      const t1 = document.timeline.currentTime;
      const p1 = performance.now();
      const all = document.getAnimations() as Loose[];
      const running = stuck();
      const count = (keys: string[]) =>
        keys.reduce<Record<string, number>>((acc, key) => {
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
      const described = running.map(describe);
      return {
        userAgent: navigator.userAgent,
        url: location.href,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        timeline: [t0, t1],
        performanceNow: [p0, p1],
        rafFramesIn500ms: frames,
        innerHeight,
        scrollY,
        animations: all.length,
        byPlayState: count(all.map((a) => a.playState)),
        stuck: running.length,
        stuckCurrentTimeBefore: before.slice(0, 8),
        stuckCurrentTimeAfter: running.slice(0, 8).map((a) => a.currentTime),
        stuckGroups: count(
          described.map(
            (d) =>
              `pending=${String(d.pending)} inDetails=${d.inDetails} visible=${String(d.checkVisibility)} display=${String(d.display)} onscreen=${String(d.rect ? d.rect[1] > 0 && d.rect[0] < innerHeight : null)}`,
          ),
        ),
        stuckDetails: described.slice(0, 40),
      };
    });
  console.log(`${tag} snapshot ${JSON.stringify(await snapshot())}`);
  // Experiment: bring the page to the front, then look again.
  await page.bringToFront();
  await page.waitForTimeout(1_000);
  const after = await page.evaluate(() => ({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    stuck: document
      .getAnimations()
      .filter(
        (a) =>
          a.playState === 'running' &&
          Number.isFinite(Number(a.effect?.getComputedTiming().endTime)),
      )
      .map((a) => [a.pending, a.startTime, a.currentTime]),
  }));
  console.log(
    `${tag} after bringToFront: ${JSON.stringify({ ...after, stuck: after.stuck.length, sample: after.stuck.slice(0, 5) })}`,
  );
  if (after.stuck.length > 0) {
    // Experiment: does one more second change anything?
    await page.waitForTimeout(2_000);
    console.log(`${tag} 2 s later: ${JSON.stringify(await snapshot())}`);
  }
}
