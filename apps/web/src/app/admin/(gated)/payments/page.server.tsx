import {
  and,
  desc,
  eq,
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
import { refundPurchase, setPaymentSwitch } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value.trim().slice(0, 500) : '';

const SAVED: Record<string, string> = {
  on: 'Switched on. It’s in the audit log.',
  off: 'Switched off. It’s in the audit log.',
  refund: 'Refund requested. The credits come off when the provider’s refund event arrives.',
};

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
      .select({ purchase: purchases, email: users.email })
      .from(purchases)
      .leftJoin(users, eq(users.id, purchases.userId))
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
          Set in the environment (a Railway variable on the web service), not here. Off closes every
          checkout and webhook at once, whatever the switches below say. The steps are in
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
              className="h-11 rounded-control border border-border bg-bg px-3 text-16"
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
              '',
            ]}
          >
            {rows.map(({ purchase, email }) => {
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
                    {refundable && provider?.provider?.refund && provider.on ? (
                      <details>
                        <summary className="cursor-pointer underline underline-offset-4">
                          Refund
                        </summary>
                        <form action={refundPurchase} className="mt-2 flex w-72 flex-col gap-2">
                          <input type="hidden" name="purchaseId" value={purchase.id} />
                          <ReasonField id={`refund-${purchase.id}`} />
                          <Button type="submit" size="sm" className="self-start">
                            Refund through {provider.name}
                          </Button>
                        </form>
                      </details>
                    ) : refundable && purchase.provider !== 'paddle' ? (
                      <span className="text-13.5 text-text-muted">
                        In {provider?.name}’s cabinet
                      </span>
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
          Paddle refunds go through Paddle’s API from here. Click and Payme refunds are made in each
          provider’s merchant cabinet; the credits come off when its cancel call reaches us. A
          refund can take a balance below zero; paid jobs then wait for a top-up.
        </p>
      </Section>

      <Section title="Webhook events">
        {events.length === 0 ? (
          <p className="text-14 text-text-muted">None yet.</p>
        ) : (
          <Table
            label="Webhook events"
            head={['Received', 'Provider', 'Type', 'Processed', 'Error']}
          >
            {events.map((event) => (
              <tr key={event.id}>
                <td>{when(event.receivedAt)}</td>
                <td>{event.provider}</td>
                <td className="font-mono text-12">{event.type}</td>
                <td>{event.processedAt ? when(event.processedAt) : 'not yet'}</td>
                <td>{event.error ?? ''}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-14 text-text-muted">
          Payloads stay in the database, never shown or logged. A provider retries an event we
          didn’t answer with success; Paddle can also resend one from its dashboard.
        </p>
      </Section>
    </AdminFrame>
  );
}
