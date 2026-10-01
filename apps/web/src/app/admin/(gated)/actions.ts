'use server';

/**
 * Admin actions (docs/07). Each one re-checks the admin (a layout doesn't
 * guard actions), validates with Zod, makes its change and writes the audit
 * row in one transaction, with the reason the admin gave.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  and,
  apiKeys,
  applyCredit,
  eq,
  inArray,
  InsufficientCreditsError,
  isNotNull,
  isNull,
  jobs,
  ledgerMismatches,
  sql,
  uploads,
  sessions,
  systemChecks,
  toolFlags,
  users,
} from '@etb/db';
import { tools } from '@etb/registry';
import { creditRuleSchema, limitsSchema, STATUSES, SURFACES } from '@etb/registry/schema';

import { log } from '../../../lib/log';
import { deleteAccount } from '../../../server/account';
import { audit, requireAdmin } from '../../../server/admin';
import { db } from '../../../server/db';
import { invalidateToolFlags } from '../../../server/flags';
import { field } from '../../../server/form';
import { stopJob } from '../../../server/jobs';
import { hasView } from '../../../tools/ids';

const Reason = z.string().trim().min(3).max(500);

/** JSON typed into a textarea: empty means "no override". */
const jsonOr = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .trim()
    .transform((text, ctx) => {
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'not valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema.nullable());

const ToolForm = z.strictObject({
  status: z.enum(['default', ...STATUSES]),
  maintenanceMessage: z.string().trim().max(300),
  surfaces: z.array(z.enum(SURFACES)),
  serverEnabled: z.boolean(),
  costOverride: jsonOr(creditRuleSchema),
  limitsOverride: jsonOr(limitsSchema),
  reason: Reason,
});

export async function saveToolFlag(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = field(formData, 'toolId');
  const tool = tools.find((candidate) => candidate.id === id);
  if (!tool) redirect('/admin/tools');
  const parsed = ToolForm.safeParse({
    status: field(formData, 'status'),
    maintenanceMessage: field(formData, 'maintenanceMessage'),
    surfaces: formData.getAll('surfaces').filter((value) => typeof value === 'string'),
    serverEnabled: formData.get('serverEnabled') === 'on',
    costOverride: field(formData, 'costOverride'),
    limitsOverride: field(formData, 'limitsOverride'),
    reason: field(formData, 'reason'),
  });
  const back = `/admin/tools/${tool.id}`;
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    redirect(
      `${back}?error=${encodeURIComponent(`${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`)}`,
    );
  }
  const form = parsed.data;
  // A tool with no page can't be switched on: that would be a page with nothing on it.
  if ((form.status === 'live' || form.status === 'beta') && !hasView(tool.id)) {
    redirect(
      `${back}?error=${encodeURIComponent('status: this tool has no page yet, so it can only be soon or disabled')}`,
    );
  }
  const next = {
    status: form.status === 'default' ? null : form.status,
    maintenanceMessage: form.maintenanceMessage || null,
    surfacesOverride: form.surfaces.length > 0 ? form.surfaces : null,
    serverEnabled: form.serverEnabled,
    costOverride: form.costOverride,
    limitsOverride: form.limitsOverride,
    updatedBy: admin.id,
    updatedAt: new Date(),
  };
  await db().transaction(async (tx) => {
    const [before] = await tx.select().from(toolFlags).where(eq(toolFlags.toolId, tool.id));
    await tx
      .insert(toolFlags)
      .values({ toolId: tool.id, ...next })
      .onConflictDoUpdate({ target: toolFlags.toolId, set: next });
    await audit(tx, {
      adminId: admin.id,
      action: 'tool.flags',
      targetType: 'tool',
      targetId: tool.id,
      before: before ?? null,
      after: next,
      reason: form.reason,
    });
  });
  log.info({ tool_id: tool.id, user_ref: admin.id }, 'admin.tool_flags');
  // This process shows it at once; others within the 30 s cache.
  invalidateToolFlags();
  revalidatePath('/', 'layout');
  redirect(`${back}?saved=1`);
}

const Credits = z.strictObject({
  direction: z.enum(['grant', 'debit']),
  amount: z.coerce.number().int().min(1).max(1_000_000),
  reason: Reason,
});

export async function changeCredits(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = field(formData, 'userId');
  const back = `/admin/users/${userId}`;
  const parsed = Credits.safeParse({
    direction: field(formData, 'direction'),
    amount: field(formData, 'amount'),
    reason: field(formData, 'reason'),
  });
  if (!parsed.success) redirect(`${back}?error=credits`);
  const { direction, amount, reason } = parsed.data;
  try {
    await db().transaction(async (tx) => {
      const row = await applyCredit(
        tx,
        userId,
        direction === 'grant' ? 'admin_grant' : 'admin_debit',
        direction === 'grant' ? amount : -amount,
        { adminId: admin.id, reason },
      );
      await audit(tx, {
        adminId: admin.id,
        action: `credits.${direction}`,
        targetType: 'user',
        targetId: userId,
        before: { balance: row.balanceAfter - row.amount },
        after: { balance: row.balanceAfter },
        reason,
      });
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) redirect(`${back}?error=balance`);
    throw error;
  }
  redirect(`${back}?saved=credits`);
}

export async function setDisabled(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = field(formData, 'userId');
  const back = `/admin/users/${userId}`;
  const disable = field(formData, 'disable') === '1';
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(`${back}?error=reason`);
  if (userId === admin.id) redirect(`${back}?error=self`);
  await db().transaction(async (tx) => {
    const [before] = await tx
      .select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, userId));
    const disabledAt = disable ? new Date() : null;
    await tx.update(users).set({ disabledAt }).where(eq(users.id, userId));
    // Disabling signs the account out everywhere.
    if (disable) await tx.delete(sessions).where(eq(sessions.userId, userId));
    await audit(tx, {
      adminId: admin.id,
      action: disable ? 'user.disable' : 'user.enable',
      targetType: 'user',
      targetId: userId,
      before,
      after: { disabledAt },
      reason: reason.data,
    });
  });
  redirect(`${back}?saved=1`);
}

export async function revokeKeys(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = field(formData, 'userId');
  const back = `/admin/users/${userId}`;
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(`${back}?error=reason`);
  await db().transaction(async (tx) => {
    const revoked = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning({ prefix: apiKeys.prefix });
    await audit(tx, {
      adminId: admin.id,
      action: 'user.revoke_keys',
      targetType: 'user',
      targetId: userId,
      after: { revoked: revoked.map((key) => key.prefix) },
      reason: reason.data,
    });
  });
  redirect(`${back}?saved=1`);
}

export async function deleteUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = field(formData, 'userId');
  const back = `/admin/users/${userId}`;
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(`${back}?error=reason`);
  if (userId === admin.id) redirect(`${back}?error=self`);
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (
    !user?.email ||
    field(formData, 'confirm').trim().toLowerCase() !== user.email.toLowerCase()
  ) {
    redirect(`${back}?error=confirm`);
  }
  await deleteAccount(userId);
  await audit(db(), {
    adminId: admin.id,
    action: 'user.delete',
    targetType: 'user',
    targetId: userId,
    reason: reason.data,
  });
  redirect(`${back}?saved=1`);
}

export async function runLedgerCheck(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect('/admin/system?error=reason');
  const mismatches = await ledgerMismatches(db());
  const result = {
    name: 'ledger_invariant',
    ok: mismatches.length === 0,
    detail: { mismatches: mismatches.length, users: mismatches.slice(0, 10).map((m) => m.userId) },
    ranAt: new Date(),
  };
  await db().transaction(async (tx) => {
    await tx
      .insert(systemChecks)
      .values(result)
      .onConflictDoUpdate({ target: systemChecks.name, set: result });
    await audit(tx, {
      adminId: admin.id,
      action: 'system.ledger_check',
      targetType: 'system',
      targetId: 'ledger_invariant',
      after: result.detail,
      reason: reason.data,
    });
  });
  redirect('/admin/system?saved=1');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function jobFor(formData: FormData) {
  const id = field(formData, 'jobId');
  if (!UUID.test(id)) redirect('/admin/jobs');
  const [job] = await db().select().from(jobs).where(eq(jobs.id, id));
  if (!job) redirect('/admin/jobs');
  return job;
}

/** docs/07 → Jobs: cancel a queued or running job, with its credits back. */
export async function cancelJobAsAdmin(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const job = await jobFor(formData);
  const back = `/admin/jobs/${job.id}`;
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(`${back}?error=reason`);
  const stopped = await stopJob(job, (tx, row) =>
    audit(tx, {
      adminId: admin.id,
      action: 'job.cancel',
      targetType: 'job',
      targetId: row.id,
      before: { status: job.status },
      after: { status: row.status, credits_returned: row.creditsQuoted },
      reason: reason.data,
    }),
  );
  redirect(`${back}?${stopped ? 'saved=cancelled' : 'error=ended'}`);
}

/**
 * docs/07 → Jobs: run an ended job again, if its input is still there (it
 * usually goes when the job ends). On us: no credits, no free daily job.
 */
export async function retryJob(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const job = await jobFor(formData);
  const back = `/admin/jobs/${job.id}`;
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(`${back}?error=reason`);
  const retried = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(jobs)
      .set({
        status: 'queued',
        progress: 0,
        stage: null,
        errorCode: null,
        errorDetail: null,
        attempts: 0,
        workerId: null,
        heartbeatAt: null,
        startedAt: null,
        finishedAt: null,
        queuedAt: new Date(),
        funding: 'none',
        creditsQuoted: 0,
        creditsCharged: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, job.id),
          inArray(jobs.status, ['failed', 'cancelled', 'expired']),
          isNotNull(jobs.inputKey),
          sql`exists (select 1 from ${uploads} where ${uploads.storageKey} = ${jobs.inputKey} and ${uploads.deletedAt} is null)`,
        ),
      )
      .returning();
    if (!row) return null;
    await audit(tx, {
      adminId: admin.id,
      action: 'job.retry',
      targetType: 'job',
      targetId: row.id,
      before: { status: job.status, error_code: job.errorCode },
      after: { status: 'queued', funding: 'none' },
      reason: reason.data,
    });
    await tx.execute(sql`select pg_notify('etb_jobs', ${row.id})`);
    return row;
  });
  log.info({ job_id: job.id, retried: Boolean(retried) }, 'admin.job_retry');
  redirect(`${back}?${retried ? 'saved=retried' : 'error=input'}`);
}
