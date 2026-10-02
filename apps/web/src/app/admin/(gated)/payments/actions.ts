'use server';

/**
 * Admin → Payments actions (docs/07). Each re-checks the admin and TOTP,
 * takes a reason and writes the audit log, like every admin action.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { eq, purchases } from '@etb/db';

import { log } from '../../../../lib/log';
import { audit, requireAdmin } from '../../../../server/admin';
import { db } from '../../../../server/db';
import { field } from '../../../../server/form';
import { providerContext } from '../../../../server/payments/checkout';
import { PROVIDER_IDS, type ProviderId } from '../../../../server/payments/contract';
import { createPurchaseStore, toRecord } from '../../../../server/payments/store';
import {
  enabledProvider,
  paymentEnv,
  PROVIDER_NAMES,
  setProviderSwitch,
} from '../../../../server/payments/switches';

const BACK = '/admin/payments';
const Provider = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);
const Reason = z.string().trim().min(3).max(500);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const back = (params: Record<string, string>) =>
  `${BACK}?${new URLSearchParams(params).toString()}#${params.provider ?? 'purchases'}`;

/** The admin switch for one provider. Turning on is refused while anything it needs is missing. */
export async function setPaymentSwitch(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const provider = Provider.safeParse(field(formData, 'provider'));
  if (!provider.success) redirect(BACK);
  const enabled = field(formData, 'enabled') === '1';
  const result = await setProviderSwitch(db(), {
    adminId: admin.id,
    provider: provider.data,
    enabled,
    reason: field(formData, 'reason'),
  });
  if (!result.ok) redirect(back({ provider: provider.data, error: result.reason }));
  log.info({ provider: provider.data, enabled, user_ref: admin.id }, 'admin.payment_switch');
  revalidatePath('/', 'layout');
  redirect(back({ provider: provider.data, saved: enabled ? 'on' : 'off' }));
}

/**
 * docs/07 → Payments: refund a purchase through the provider's API, where
 * there is one (Paddle). The credits come off when the provider's refund
 * event arrives, through the store, like any other refund.
 */
export async function refundPurchase(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = field(formData, 'purchaseId');
  if (!UUID.test(id)) redirect(BACK);
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(back({ error: 'Give a reason of 3 to 500 characters.' }));
  const [row] = await db().select().from(purchases).where(eq(purchases.id, id));
  if (!row) redirect(BACK);
  if (row.status !== 'completed' && row.status !== 'partially_refunded') {
    redirect(back({ error: `A ${row.status} purchase can’t be refunded.` }));
  }
  const env = paymentEnv();
  const provider = await enabledProvider(db(), row.provider, env);
  const name = PROVIDER_NAMES[row.provider as ProviderId];
  if (!provider?.refund) {
    redirect(
      back({
        error: provider
          ? `${name} refunds are made in ${name}’s own cabinet.`
          : `${name} is switched off, so its refund event couldn’t arrive. Switch it on first.`,
      }),
    );
  }
  try {
    await provider.refund(toRecord(row), providerContext(db(), env));
  } catch (error) {
    log.error({ err: error, purchase_id: row.id, provider: row.provider }, 'admin.refund_failed');
    redirect(
      back({ error: `${name} refused the refund. Check the purchase in ${name}’s dashboard.` }),
    );
  }
  await audit(db(), {
    adminId: admin.id,
    action: 'purchase.refund',
    targetType: 'purchase',
    targetId: row.id,
    before: { status: row.status, credits: row.credits },
    after: { requested: true },
    reason: reason.data,
  });
  log.info({ purchase_id: row.id, provider: row.provider, user_ref: admin.id }, 'admin.refund');
  redirect(back({ saved: 'refund' }));
}

/**
 * Click has no refund call (docs/DECISIONS.md → "Click: Prepare and
 * Complete"): after refunding in Click's cabinet, record it here. The store
 * takes the credits back with the purchase, once per purchase.
 */
export async function recordRefund(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = field(formData, 'purchaseId');
  if (!UUID.test(id)) redirect(BACK);
  const reason = Reason.safeParse(field(formData, 'reason'));
  if (!reason.success) redirect(back({ error: 'Give a reason of 3 to 500 characters.' }));
  const [row] = await db().select().from(purchases).where(eq(purchases.id, id));
  if (!row) redirect(BACK);
  if (row.provider !== 'click') {
    redirect(back({ error: 'Only Click refunds are recorded by hand.' }));
  }
  if (row.status !== 'completed' && row.status !== 'partially_refunded') {
    redirect(back({ error: `A ${row.status} purchase can’t be refunded.` }));
  }
  const after = await db().transaction(async (tx) => {
    const done = await createPurchaseStore(tx).refund(
      row.id,
      { refundId: `cabinet:${row.id}` },
      { refundRecordedBy: admin.id },
    );
    await audit(tx, {
      adminId: admin.id,
      action: 'purchase.refund_recorded',
      targetType: 'purchase',
      targetId: row.id,
      before: { status: row.status, credits: row.credits },
      after: { status: done.status },
      reason: reason.data,
    });
    return done;
  });
  log.info(
    { purchase_id: row.id, status: after.status, user_ref: admin.id },
    'admin.refund_recorded',
  );
  redirect(back({ saved: 'recorded' }));
}
