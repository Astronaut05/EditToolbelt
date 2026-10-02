'use server';

/**
 * Admin → Payments actions (docs/07). Each re-checks the admin and TOTP,
 * takes a reason and writes the audit log, like every admin action.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { log } from '../../../../lib/log';
import { requireAdmin } from '../../../../server/admin';
import { db } from '../../../../server/db';
import { field } from '../../../../server/form';
import { PROVIDER_IDS, type ProviderId } from '../../../../server/payments/contract';
import { sendReceiptAgain } from '../../../../server/payments/fiscal';
import {
  CabinetRefundForm,
  recordCabinetRefund,
  RefundForm,
  requestRefund,
} from '../../../../server/payments/refunds';
import { setProviderSwitch } from '../../../../server/payments/switches';

const BACK = '/admin/payments';
const Provider = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

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

/** The form as the server functions take it, or the first problem with it. */
function formInput<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> | string {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  return parsed.success ? parsed.data : (parsed.error.issues[0]?.message ?? 'Check the form.');
}

/**
 * docs/07 → Payments: refund `amount` of a purchase through the provider's
 * API, where there is one (Paddle). The credits come off, in proportion,
 * when the provider's refund event arrives, through the store.
 */
export async function refundPurchase(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const input = formInput(RefundForm, formData);
  if (typeof input === 'string') redirect(back({ error: input }));
  const result = await requestRefund(db(), {
    adminId: admin.id,
    purchaseId: input.purchaseId,
    amountMinor: input.amount,
    reason: input.reason,
  });
  if (!result.ok) redirect(back({ error: result.reason }));
  redirect(back({ saved: 'refund' }));
}

/**
 * Click has no refund call (docs/DECISIONS.md → "Click: Prepare and
 * Complete"): after refunding in Click's cabinet, record the amount here.
 * The store takes the credits back in proportion, once per form.
 */
export async function recordRefund(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const input = formInput(CabinetRefundForm, formData);
  if (typeof input === 'string') redirect(back({ error: input }));
  const result = await recordCabinetRefund(db(), {
    adminId: admin.id,
    purchaseId: input.purchaseId,
    refundId: input.refundId,
    amountMinor: input.amount,
    reason: input.reason,
  });
  if (!result.ok) redirect(back({ error: result.reason }));
  redirect(back({ saved: 'recorded' }));
}

/** "Send again": the form's purchase and the admin's reason. */
const ResendForm = z.object({
  purchaseId: z.uuid({ error: 'No such purchase.' }),
  reason: z.string().trim().min(3, 'Give a reason of 3 to 500 characters.').max(500),
});

/**
 * A Click purchase's fiscal receipt, tried again now (docs/05 → Payments):
 * the retries carry on either way. Audit-logged with the outcome.
 */
export async function resendReceipt(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const input = formInput(ResendForm, formData);
  if (typeof input === 'string') redirect(back({ error: input }));
  const result = await sendReceiptAgain(db(), {
    adminId: admin.id,
    purchaseId: input.purchaseId,
    reason: input.reason,
  });
  if (!result.ok) redirect(back({ error: result.reason }));
  log.info(
    { purchase_id: input.purchaseId, status: result.status, user_ref: admin.id },
    'admin.fiscal_receipt_resend',
  );
  redirect(back({ saved: result.status === 'sent' ? 'receipt-sent' : 'receipt-failed' }));
}
