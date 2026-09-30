'use server';

/**
 * Admin two-factor: set up TOTP, and pass a code (or a backup code) before
 * /admin opens. Five wrong codes in 15 minutes lock it for the rest of them.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { log } from '../../../lib/log';
import { grantStepUp, requireAdminAccount } from '../../../server/admin';
import { auth } from '../../../server/auth';
import { field } from '../../../server/form';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, number[]>();

function locked(userId: string, now = Date.now()): boolean {
  const recent = (failures.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  failures.set(userId, recent);
  return recent.length >= MAX_FAILURES;
}

function fail(userId: string): never {
  failures.set(userId, [...(failures.get(userId) ?? []), Date.now()]);
  log.warn({ user_ref: userId }, 'admin.two_factor_failed');
  redirect('/admin/two-factor?error=code');
}

const Code = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
const BackupCode = z.string().trim().min(6).max(64);

export async function startSetup(): Promise<void> {
  const { user } = await requireAdminAccount();
  if (!user.twoFactorEnabled) {
    await auth().api.enableTwoFactor({ body: {}, headers: await headers() });
  }
  redirect('/admin/two-factor');
}

/** Confirms setup, or passes the step-up: the same TOTP check either way. */
export async function verifyCode(formData: FormData): Promise<void> {
  const { user } = await requireAdminAccount();
  if (locked(user.id)) redirect('/admin/two-factor?error=locked');
  const code = Code.safeParse(field(formData, 'code'));
  if (!code.success) fail(user.id);
  const ok = await auth()
    .api.verifyTOTP({ body: { code: code.data }, headers: await headers() })
    .then((result) => Boolean(result.token))
    .catch(() => false);
  if (!ok) fail(user.id);
  failures.delete(user.id);
  await grantStepUp(user.id);
  log.info({ user_ref: user.id }, 'admin.stepped_up');
  redirect('/admin');
}

export async function verifyBackup(formData: FormData): Promise<void> {
  const { user } = await requireAdminAccount();
  if (!user.twoFactorEnabled) redirect('/admin/two-factor');
  if (locked(user.id)) redirect('/admin/two-factor?error=locked');
  const code = BackupCode.safeParse(field(formData, 'backupCode'));
  if (!code.success) fail(user.id);
  const ok = await auth()
    .api.verifyBackupCode({
      body: { code: code.data, disableSession: true },
      headers: await headers(),
    })
    .then(() => true)
    .catch(() => false);
  if (!ok) fail(user.id);
  failures.delete(user.id);
  await grantStepUp(user.id);
  log.info({ user_ref: user.id }, 'admin.stepped_up_backup_code');
  redirect('/admin');
}
