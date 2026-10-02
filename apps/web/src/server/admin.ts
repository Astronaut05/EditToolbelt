/**
 * The admin gate and audit (docs/07 → Admin panel, docs/11 → Admin): role
 * `admin`, TOTP, an optional IP allowlist (in the proxy), and an audit row with
 * a reason for every write.
 *
 * TOTP is a step-up: after a code, a signed cookie (12 hours, /admin only,
 * SameSite=Strict) says this browser passed it for this user. Every admin page,
 * route and action checks it itself: a layout protects neither pages nor
 * actions, since a client navigation can render a page without its layout.
 * src/app/admin/(gated)/gate.test.ts fails if one doesn't.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { currentUser, type CurrentUser } from './account';
import { serverEnv } from './env';

export { audit, type AuditEntry } from './audit';

export const STEP_UP_COOKIE = 'etb.admin_2fa';
const STEP_UP_HOURS = 12;

function sign(value: string): string {
  return createHmac('sha256', `admin-step-up:${serverEnv().BETTER_AUTH_SECRET}`)
    .update(value)
    .digest('base64url');
}

/** The cookie value for `userId`, good until `until` (ms). */
export function stepUpValue(userId: string, until: number): string {
  const body = `${userId}.${String(until)}`;
  return `${body}.${sign(body)}`;
}

/** Whether a step-up cookie value is genuine, unexpired and for this user. */
export function stepUpValid(value: string | undefined, userId: string, now = Date.now()): boolean {
  if (!value) return false;
  const [id, until, mac] = value.split('.');
  if (!id || !until || !mac || id !== userId || Number(until) < now) return false;
  const expected = Buffer.from(sign(`${id}.${until}`));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** After a correct TOTP or backup code: this browser is stepped up for 12 hours. */
export async function grantStepUp(userId: string): Promise<void> {
  const until = Date.now() + STEP_UP_HOURS * 60 * 60 * 1000;
  (await cookies()).set(STEP_UP_COOKIE, stepUpValue(userId, until), {
    httpOnly: true,
    sameSite: 'strict',
    secure: serverEnv().SITE_URL.startsWith('https://'),
    path: '/admin',
    maxAge: STEP_UP_HOURS * 60 * 60,
  });
}

/** Signed in as an admin (TOTP not needed yet): the two-factor pages. Anyone else gets a 404. */
export async function requireAdminAccount(): Promise<{ user: CurrentUser; sessionId: string }> {
  const me = await currentUser();
  if (!me || me.user.role !== 'admin') notFound();
  return me;
}

/** An admin who passed TOTP in this browser. Every admin page and action starts here. */
export async function requireAdmin(): Promise<CurrentUser> {
  const { user } = await requireAdminAccount();
  if (!user.twoFactorEnabled) redirect('/admin/two-factor');
  if (!stepUpValid((await cookies()).get(STEP_UP_COOKIE)?.value, user.id)) {
    redirect('/admin/two-factor');
  }
  return user;
}
