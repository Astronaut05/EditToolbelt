import { randomUUID } from 'node:crypto';

import {
  and,
  desc,
  eq,
  fiscalReceipts,
  ilike,
  lt,
  purchaseStatus,
  purchases,
  sql,
  users,
  webhookEvents,
  type SQL,
} from '@etb/db';
import { Button, Select } from '@etb/ui';
import type { ReactNode } from 'react';

import {
  AdminFrame,
  Facts,
  ReasonField,
  Section,
  Table,
  when,
} from '../../../../components/admin/AdminFrame';
import { formatMoney, packName } from '../../../../lib/money';
import { db } from '../../../../server/db';
import { serverEnv } from '../../../../server/env';
import { PROVIDER_IDS } from '../../../../server/payments/contract';
import { paymentEnv, paymentStates, PROVIDER_NAMES } from '../../../../server/payments/switches';
import { webhookUrl } from '../../../../server/payments/urls';
import { recordRefund, refundPurchase, resendReceipt, setPaymentSwitch } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value.trim().slice(0, 500) : '';

const SAVED: Record<string, string> = {
  on: 'Switched on. It’s in the audit log.',
  off: 'Switched off. It’s in the audit log.',
  refund:
    'Refund requested. The credits come off, in proportion, when the provider’s refund event arrives.',
  recorded: 'Refund recorded: the credits came off in proportion. It’s in the audit log.',
  'receipt-sent': 'Click accepted the fiscal receipt. It’s in the audit log.',
  'receipt-failed':
    'Click didn’t take the fiscal receipt this time: the error is beside the purchase, and the retries carry on. It’s in the audit log.',
};

type Receipt = typeof fiscalReceipts.$inferSelect;

/**
 * A Click purchase's fiscal receipt (docs/05 → Payments): sent, pending or
 * failed with the last error, and "Send again" while Click hasn't taken it.
 */
function ReceiptCell({ purchaseId, receipt }: { purchaseId: string; receipt: Receipt | null }) {
  if (!receipt) return <span className="text-13.5 text-text-muted">none</span>;
  if (receipt.status === 'sent' && receipt.sentAt) return <>sent {when(receipt.sentAt)}</>;
  const tries = `${String(receipt.attempts)} ${receipt.attempts === 1 ? 'try' : 'tries'}`;
  return (
    <div className="flex w-72 flex-col gap-1">
      <span className="font-strong">
        {receipt.status === 'failed' ? `failed, ${tries}` : 'pending'}
      </span>
      {receipt.lastError && <span className="text-13.5">{receipt.lastError}</span>}
      <span className="text-13.5 text-text-muted">Next try {when(receipt.nextAttemptAt)}</span>
      <details>
        <summary className="cursor-pointer underline underline-offset-4">Send again</summary>
        <form action={resendReceipt} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="purchaseId" value={purchaseId} />
          <ReasonField id={`receipt-${purchaseId}`} />
          <Button type="submit" size="sm" className="self-start">
            Send the receipt now
          </Button>
        </form>
      </details>
    </div>
  );
}

/** What the admin needs to size a refund of the unused part. */
function RefundFacts({
  paid,
  credits,
  balance,
}: {
  paid: string;
  credits: number;
  balance: number | null;
}) {
  return (
    <p className="text-13.5 text-text-muted">
      Paid {paid} for {credits} credits.
      {balance === null ? '' : ` Their balance now: ${String(balance)} credits.`} Credits come off
      in proportion to the money.
    </p>
  );
}

/** The money refunded, in the purchase's currency. */
function AmountField({ id, currency }: { id: string; currency: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-14">
      <span className="font-strong">Amount refunded ({currency})</span>
      <input
        id={id}
        name="amount"
        required
        inputMode="decimal"
        className="h-11 rounded-control border border-border-field bg-bg px-3 text-16"
      />
    </label>
  );
}

const yes = (value: boolean, good = 'yes', bad = 'no') => (
  <span className={value ? '' : 'font-strong'}>{value ? good : bad}</span>
);

/**
 * docs/07 → Payments: the three locks for each provider (the kill switch
 * from env, the keys and fiscal fields, the admin switch), the purchases
 * with Paddle refunds, and the webhook events with their errors. Key names
 * only, never values; webhook payloads never shown.
 */
export default async function AdminPayments({ searchParams }: Props) {
  const query = await searchParams;
  const env = paymentEnv();
  const site = serverEnv().SITE_URL;
  const filters = {
    provider: one(query.provider),
    status: one(query.status),
    user: one(query.user),
  };
  const before = one(query.before);
  const where: (SQL | undefined)[] = [
    (PROVIDER_IDS as readonly string[]).includes(filters.provider)
      ? eq(purchases.provider, filters.provider)
      : undefined,
    (purchaseStatus.enumValues as readonly string[]).includes(filters.status)
      ? eq(purchases.status, filters.status as (typeof purchaseStatus.enumValues)[number])
      : undefined,
    filters.user
      ? ilike(sql`${users.email}::text`, `%${filters.user.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      : undefined,
    // UUIDv7 ids sort by time, so they page the list.
    UUID.test(before) ? lt(purchases.id, before) : undefined,
  ];
  const [states, rows, events] = await Promise.all([
    paymentStates(db(), env),
    db()
      .select({
        purchase: purchases,
        email: users.email,
        balance: users.creditBalance,
        receipt: fiscalReceipts,
      })
      .from(purchases)
      .leftJoin(users, eq(users.id, purchases.userId))
      .leftJoin(fiscalReceipts, eq(fiscalReceipts.purchaseId, purchases.id))
      .where(and(...where))
      .orderBy(desc(purchases.id))
      .limit(PAGE),
    db()
      .select({
        id: webhookEvents.id,
        provider: webhookEvents.provider,
        type: webhookEvents.type,
        receivedAt: webhookEvents.receivedAt,
        processedAt: webhookEvents.processedAt,
        error: webhookEvents.error,
        answer: webhookEvents.answer,
      })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(30),
  ]);
  const onNow = new Map(states.map((state) => [state.id, state]));
  const last = rows.at(-1);
  const keep = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ''),
  ).toString();
  const error = one(query.error);
  const saved = SAVED[one(query.saved)];
  const errorFor = one(query.provider);

  return (
    <AdminFrame title="Payments" current="/admin/payments">
      {saved && <p role="status">{saved}</p>}
      {error && !errorFor && <p role="alert">{error}</p>}

      <Section title="Kill switch">
        <Facts
          items={[
            [
              'PAYMENTS_ENABLED',
              env.enabled ? 'true: providers switched on below take money' : 'off: nothing is sold',
            ],
          ]}
        />
        <p className="text-14 text-text-muted">
          Set in the environment (a Railway variable on the web service), not here. Off stops every
          sale at once, whatever the switches below say. Calls about purchases already made
          (refunds, chargebacks, a payment for a checkout opened before) still arrive while a
          provider’s keys are set; remove its keys to close its webhook too. The steps are in
          docs/runbooks/turn-on-payments.md.
        </p>
      </Section>

      {states.map((state) => (
        <section
          key={state.id}
          id={state.id}
          aria-labelledby={`${state.id}-title`}
          className="flex flex-col gap-3"
        >
          <h2 id={`${state.id}-title`} className="text-22 font-display tracking-display">
            {state.name}
          </h2>
          {error && errorFor === state.id && <p role="alert">{error}</p>}
          <Facts
            items={[
              ['Taking money now', yes(state.on)],
              [
                'Webhook',
                state.on
                  ? 'open'
                  : state.connected
                    ? 'purchases already made only'
                    : 'closed (404): keys missing',
              ],
              [
                'Admin switch',
                state.setting
                  ? `${state.switchedOn ? 'on' : 'off'} since ${when(state.setting.updatedAt)}${state.setting.reason ? `: ${state.setting.reason}` : ''}`
                  : 'off (never set)',
              ],
              ['In this release', yes(state.built)],
              ...state.keys.map(
                (key) => [key.name, yes(key.set, 'set', 'missing')] as [string, ReactNode],
              ),
              ...state.fiscal.map(
                (item) => [item.name, yes(item.set, 'filled', 'empty')] as [string, ReactNode],
              ),
              [
                'Webhook URL',
                <span key="url" className="font-mono text-12 break-all">
                  {webhookUrl(site, state.id)}
                </span>,
              ],
            ]}
          />
          {state.blockers.length > 0 && (
            <ul
              className="list-disc pl-5 text-14 text-text-muted"
              aria-label={`${state.name}: missing`}
            >
              {state.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <form action={setPaymentSwitch} className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="provider" value={state.id} />
            <input type="hidden" name="enabled" value={state.switchedOn ? '0' : '1'} />
            <ReasonField id={`${state.id}-reason`} />
            <Button type="submit" className="self-start">
              {state.switchedOn ? `Switch ${state.name} off` : `Switch ${state.name} on`}
            </Button>
          </form>
        </section>
      ))}

      <Section title="Purchases">
        <form
          role="search"
          aria-label="Filter purchases"
          className="flex flex-wrap items-end gap-3"
          id="purchases"
        >
          <label className="flex flex-col gap-1.5 text-14">
            Provider
            <Select name="provider" defaultValue={filters.provider}>
              <option value="">Any</option>
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_NAMES[id]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-14">
            Status
            <Select name="status" defaultValue={filters.status}>
              <option value="">Any</option>
              {purchaseStatus.enumValues.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-14">
            User email
            <input
              name="user"
              defaultValue={filters.user}
              className="h-11 rounded-control border border-border-field bg-bg px-3 text-16"
            />
          </label>
          <Button type="submit" size="md">
            Filter
          </Button>
        </form>
        {rows.length === 0 ? (
          <p className="text-14 text-text-muted">None.</p>
        ) : (
          <Table
            label="Purchases"
            head={[
              'When',
              'User',
              'Provider',
              'Pack',
              'Credits',
              'Paid',
              'Status',
              'Provider id',
              'Fiscal receipt',
              '',
            ]}
          >
            {rows.map(({ purchase, email, balance, receipt }) => {
              const provider = onNow.get(purchase.provider as (typeof PROVIDER_IDS)[number]);
              const refundable =
                purchase.status === 'completed' || purchase.status === 'partially_refunded';
              return (
                <tr key={purchase.id}>
                  <td>{when(purchase.createdAt)}</td>
                  <td>
                    <a
                      href={`/admin/users/${purchase.userId}`}
                      className="underline underline-offset-4"
                    >
                      {email ?? 'deleted account'}
                    </a>
                  </td>
                  <td>{provider?.name ?? purchase.provider}</td>
                  <td>{packName(purchase.packId)}</td>
                  <td>{purchase.credits}</td>
                  <td>{formatMoney(purchase.amountMinor, purchase.currency)}</td>
                  <td>{purchase.status}</td>
                  <td className="font-mono text-12">{purchase.providerTxnId ?? ''}</td>
                  <td>
                    {purchase.provider === 'click' &&
                    purchase.status !== 'pending' &&
                    purchase.status !== 'cancelled' ? (
                      <ReceiptCell purchaseId={purchase.id} receipt={receipt} />
                    ) : null}
                  </td>
                  <td>
                    {refundable && provider?.provider?.refund && provider.connected ? (
                      <details>
                        <summary className="cursor-pointer underline underline-offset-4">
                          Refund
                        </summary>
                        <form action={refundPurchase} className="mt-2 flex w-72 flex-col gap-2">
                          <input type="hidden" name="purchaseId" value={purchase.id} />
                          <RefundFacts
                            paid={formatMoney(purchase.amountMinor, purchase.currency)}
                            credits={purchase.credits}
                            balance={balance}
                          />
                          <AmountField
                            id={`refund-amount-${purchase.id}`}
                            currency={purchase.currency}
                          />
                          <ReasonField id={`refund-${purchase.id}`} />
                          <Button type="submit" size="sm" className="self-start">
                            Refund through {provider.name}
                          </Button>
                        </form>
                      </details>
                    ) : refundable && purchase.provider === 'click' ? (
                      <details>
                        <summary className="cursor-pointer underline underline-offset-4">
                          Record refund
                        </summary>
                        <form action={recordRefund} className="mt-2 flex w-72 flex-col gap-2">
                          <input type="hidden" name="purchaseId" value={purchase.id} />
                          {/* New on every page load: a double submit records once. */}
                          <input type="hidden" name="refundId" value={randomUUID()} />
                          <p className="text-13.5 text-text-muted">
                            After refunding it in Click’s cabinet: the amount you refunded there.
                          </p>
                          <RefundFacts
                            paid={formatMoney(purchase.amountMinor, purchase.currency)}
                            credits={purchase.credits}
                            balance={balance}
                          />
                          <AmountField
                            id={`record-amount-${purchase.id}`}
                            currency={purchase.currency}
                          />
                          <ReasonField id={`record-${purchase.id}`} />
                          <Button type="submit" size="sm" className="self-start">
                            Record the refund
                          </Button>
                        </form>
                      </details>
                    ) : refundable && purchase.provider === 'payme' ? (
                      <span className="text-13.5 text-text-muted">In Payme’s cabinet</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {rows.length === PAGE && last && (
          <p>
            <a
              href={`/admin/payments?${keep ? `${keep}&` : ''}before=${last.purchase.id}#purchases`}
              className="underline underline-offset-4"
            >
              Older
            </a>
          </p>
        )}
        <p className="text-14 text-text-muted">
          Refunds are for the unused part of a pack: give the money refunded, and the credits come
          off in proportion, never more than are left of the purchase. Paddle refunds go through
          Paddle’s API from here, full or partial; the credits come off when Paddle approves. Payme
          refunds are made in Payme’s cabinet and arrive as its cancel call. Click has no refund
          call: refund in Click’s cabinet, then record the amount here. A refund can take a balance
          below zero; paid jobs then wait for a top-up.
        </p>
        <p className="text-14 text-text-muted">
          Fiscal receipt: Click’s receipt for the tax service, which we send to Click’s Merchant API
          after each sale and try again, 1, 2, 4 … minutes apart (at most 6 hours), until Click
          accepts it. One still unsent after 6 tries or an hour alerts. Payme sends its own receipt;
          Paddle needs none.
        </p>
      </Section>

      <Section title="Webhook events">
        {events.length === 0 ? (
          <p className="text-14 text-text-muted">None yet.</p>
        ) : (
          <Table
            label="Webhook events"
            head={['Received', 'Provider', 'Type', 'Processed', 'Answer', 'Error']}
          >
            {events.map((event) => (
              <tr key={event.id}>
                <td>{when(event.receivedAt)}</td>
                <td>{event.provider}</td>
                <td className="font-mono text-12">{event.type}</td>
                <td>{event.processedAt ? when(event.processedAt) : 'not yet'}</td>
                <td className="font-mono text-12">{event.answer ?? ''}</td>
                <td>{event.error ?? ''}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-14 text-text-muted">
          Payloads stay in the database, never shown or logged. Answer: what Click or Payme was
          told. Error: something to check by hand; it alerts at once. A provider retries an event we
          didn’t answer with success; Paddle can also resend one from its dashboard.
        </p>
      </Section>
    </AdminFrame>
  );
}
