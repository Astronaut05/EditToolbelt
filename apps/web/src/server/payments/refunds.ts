/**
 * Refunds from Admin → Payments (docs/05 → Refunds: unused credit packs are
 * refundable for the unused portion). The admin gives the money refunded;
 * the credits come off in proportion to it, never more than are left of the
 * purchase, through the store (CLAUDE.md rule 5).
 *
 * - Paddle: `requestRefund` asks Paddle for that amount (a full refund for
 *   the whole payment, a partial one otherwise); the credits come off when
 *   Paddle approves it and its webhook arrives.
 * - Click (no refund call): `recordCabinetRefund` records a refund already
 *   made in Click's cabinet and takes the credits back at once.
 * - Payme: refunds are made in its cabinet and arrive as CancelTransaction.
 *
 * No Next.js imports: the admin actions wrap these, and the tests call them
 * on a real database. Every outcome is audit-logged with the admin's reason.
 */
import { eq, purchases, type Db } from '@etb/db';
import { z } from 'zod';

import { formatMoney } from '../../lib/money';
import { log } from '../../lib/log';
import { audit } from '../audit';
import { providerContext } from './checkout';
import type { ProviderContext, ProviderId } from './contract';
import { creditsForRefund, parseSums } from './providers/shared';
import { createPurchaseStore, toRecord } from './store';
import { paymentEnv, PROVIDER_NAMES, webhookProvider, type PaymentEnv } from './switches';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Money as an admin types it: whole units with up to 2 decimals ("3.75",
 * "47250", "47 250.00"), as minor units (cents, tiyin). Spaces between
 * thousands are fine; commas aren't (3,75 or 3,750?).
 */
const Money = z
  .string()
  .transform((text) => parseSums(text.replace(/\s/g, '')))
  .refine(
    (minor): minor is number => minor !== null && minor > 0,
    'Give the amount refunded, like 3.75 or 47250.',
  );

/** The refund forms on Admin → Payments. */
export const RefundForm = z.object({
  purchaseId: z.string().regex(UUID, 'No such purchase.'),
  amount: Money,
  reason: z.string().trim().min(3, 'Give a reason of 3 to 500 characters.').max(500),
});

/** Click's form also carries an id made when the page was drawn, so a double submit records once. */
export const CabinetRefundForm = RefundForm.extend({
  refundId: z.string().regex(UUID, 'Reload the page and try again.'),
});

export type RefundResult = { ok: true; status: string } | { ok: false; reason: string };

const REFUNDABLE = new Set(['completed', 'partially_refunded']);

type Row = typeof purchases.$inferSelect;

async function purchaseFor(db: Db, id: string): Promise<Row | null> {
  const [row] = UUID.test(id) ? await db.select().from(purchases).where(eq(purchases.id, id)) : [];
  return row ?? null;
}

function checkAmount(row: Row, amountMinor: number): string | null {
  if (amountMinor > row.amountMinor)
    return `That’s more than was paid (${formatMoney(row.amountMinor, row.currency)}).`;
  return null;
}

/**
 * Admin → Payments → Refund: asks the purchase's provider to refund
 * `amountMinor`, through its API (Paddle). Works while the provider is
 * switched off, as long as its keys are set: its refund webhook still arrives.
 */
export async function requestRefund(
  db: Db,
  input: { adminId: string; purchaseId: string; amountMinor: number; reason: string },
  env: PaymentEnv = paymentEnv(),
  context: (open: boolean) => ProviderContext = (open) => providerContext(db, env, open),
): Promise<RefundResult> {
  const row = await purchaseFor(db, input.purchaseId);
  if (!row) return { ok: false, reason: 'No such purchase.' };
  if (!REFUNDABLE.has(row.status))
    return { ok: false, reason: `A ${row.status} purchase can’t be refunded.` };
  const tooMuch = checkAmount(row, input.amountMinor);
  if (tooMuch) return { ok: false, reason: tooMuch };
  const name = PROVIDER_NAMES[row.provider as ProviderId];
  const found = await webhookProvider(db, row.provider, env);
  const provider = found?.provider;
  if (!found || !provider) {
    return { ok: false, reason: `${name}’s keys aren’t set, so its refund event couldn’t arrive.` };
  }
  if (!provider.refund)
    return { ok: false, reason: `${name} refunds are made in ${name}’s own cabinet.` };
  try {
    await provider.refund(toRecord(row), context(found.open), input.amountMinor);
  } catch (error) {
    log.error({ err: error, purchase_id: row.id, provider: row.provider }, 'admin.refund_failed');
    return {
      ok: false,
      reason: `${name} refused the refund. Check the purchase in ${name}’s dashboard.`,
    };
  }
  await audit(db, {
    adminId: input.adminId,
    action: 'purchase.refund',
    targetType: 'purchase',
    targetId: row.id,
    before: { status: row.status, credits: row.credits, amount_minor: row.amountMinor },
    after: { requested_minor: input.amountMinor, currency: row.currency },
    reason: input.reason,
  });
  log.info(
    { purchase_id: row.id, provider: row.provider, user_ref: input.adminId },
    'admin.refund',
  );
  return { ok: true, status: row.status };
}

/**
 * Admin → Payments → Record refund (Click): after refunding `amountMinor`
 * in Click's cabinet, the credits come off in proportion, never more than
 * are left of the purchase. Once per `refundId`; the money recorded so far
 * can't pass what was paid.
 */
export async function recordCabinetRefund(
  db: Db,
  input: {
    adminId: string;
    purchaseId: string;
    refundId: string;
    amountMinor: number;
    reason: string;
  },
): Promise<RefundResult> {
  const first = await purchaseFor(db, input.purchaseId);
  if (!first) return { ok: false, reason: 'No such purchase.' };
  if (first.provider !== 'click')
    return { ok: false, reason: 'Only Click refunds are recorded by hand.' };
  return db.transaction(async (tx) => {
    // Locked, so two admins recording at once can't both pass the money check.
    const [row] = await tx.select().from(purchases).where(eq(purchases.id, first.id)).for('update');
    if (!row) return { ok: false, reason: 'No such purchase.' };
    const refundId = `cabinet:${input.refundId}`;
    const recorded = Array.isArray(row.providerData.cabinetRefunds)
      ? (row.providerData.cabinetRefunds as { id?: unknown; amountMinor?: unknown }[])
      : [];
    // A double submit of the same form: already done.
    if (recorded.some((entry) => entry.id === refundId)) return { ok: true, status: row.status };
    if (!REFUNDABLE.has(row.status))
      return { ok: false, reason: `A ${row.status} purchase can’t be refunded.` };
    const before = recorded.reduce((sum, entry) => sum + Number(entry.amountMinor ?? 0), 0);
    if (before + input.amountMinor > row.amountMinor) {
      return {
        ok: false,
        reason: `That’s more than is left to refund (${formatMoney(row.amountMinor - before, row.currency)} of ${formatMoney(row.amountMinor, row.currency)}).`,
      };
    }
    const credits = creditsForRefund(row.credits, input.amountMinor, row.amountMinor);
    const done = await createPurchaseStore(tx).refund(
      row.id,
      { refundId, ...(credits === undefined ? {} : { credits }) },
      {
        cabinetRefunds: [
          ...recorded,
          {
            id: refundId,
            amountMinor: input.amountMinor,
            by: input.adminId,
            at: new Date().toISOString(),
          },
        ],
      },
    );
    await audit(tx, {
      adminId: input.adminId,
      action: 'purchase.refund_recorded',
      targetType: 'purchase',
      targetId: row.id,
      before: { status: row.status, credits: row.credits, amount_minor: row.amountMinor },
      after: {
        status: done.status,
        refunded_minor: input.amountMinor,
        currency: row.currency,
        credits_back: credits ?? 'all left',
      },
      reason: input.reason,
    });
    log.info(
      { purchase_id: row.id, status: done.status, user_ref: input.adminId },
      'admin.refund_recorded',
    );
    return { ok: true, status: done.status };
  });
}
