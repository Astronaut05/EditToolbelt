import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  accounts,
  and,
  apiKeys,
  count,
  creditTransactions,
  desc,
  eq,
  gte,
  jobs,
  purchases,
  sessions,
  users,
} from '@etb/db';
import { Button, Input } from '@etb/ui';

import {
  AdminFrame,
  Facts,
  ReasonField,
  Section,
  Table,
  when,
} from '../../../../../components/admin/AdminFrame';
import { formatMoney, packName } from '../../../../../lib/money';
import { providerName } from '../../../../../lib/pay-with';
import { requireAdmin } from '../../../../../server/admin';
import { db } from '../../../../../server/db';
import { requestTime } from '../../../../../server/time';
import { changeCredits, deleteUser, revokeKeys, setDisabled } from '../../actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ERRORS: Record<string, string> = {
  credits: 'Credits are a whole number from 1 to 1,000,000, with a reason.',
  balance: 'That debit would take the balance below zero.',
  reason: 'Give a reason of at least 3 characters.',
  self: 'You can’t disable or delete your own account here.',
  confirm: 'Type the account’s email to confirm.',
};

/** docs/07 → Users: one account, its money and keys, and the actions on it. */
export default async function AdminUser({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = db();
  const [user] = await d.select().from(users).where(eq(users.id, id));
  if (!user) notFound();
  const query = await searchParams;
  const since = new Date(requestTime() - 90 * 24 * 60 * 60 * 1000);
  const [ledger, bought, recent, keys, methods, [live]] = await Promise.all([
    d
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(50),
    d.select().from(purchases).where(eq(purchases.userId, id)).orderBy(desc(purchases.createdAt)),
    d
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, id), gte(jobs.createdAt, since)))
      .orderBy(desc(jobs.createdAt))
      .limit(20),
    d.select().from(apiKeys).where(eq(apiKeys.userId, id)),
    d.select({ providerId: accounts.providerId }).from(accounts).where(eq(accounts.userId, id)),
    d
      .select({ n: count() })
      .from(sessions)
      .where(and(eq(sessions.userId, id), gte(sessions.expiresAt, new Date(requestTime())))),
  ]);
  const error = typeof query.error === 'string' ? ERRORS[query.error] : undefined;
  // docs/05 → Fraud and abuse: a chargeback flags the account here.
  const chargebacks = bought.filter((row) => row.status === 'chargeback').length;
  const state = user.deletedAt ? 'deleted' : user.disabledAt ? 'disabled' : 'active';

  return (
    <AdminFrame
      title={user.email ?? `Deleted account ${user.id.slice(0, 8)}`}
      current="/admin/users"
    >
      {query.saved && <p role="status">Done. It’s in the audit log.</p>}
      {error && <p role="alert">{error}</p>}
      <Facts
        items={[
          [
            'Id',
            <span key="id" className="font-mono text-12">
              {user.id}
            </span>,
          ],
          ['Joined', when(user.createdAt)],
          ['Role', user.role],
          ['State', state],
          ['Two-factor', user.twoFactorEnabled ? 'on' : 'off'],
          ['Signs in with', ['email link', ...methods.map((m) => m.providerId)].join(', ')],
          ['Signed-in sessions', live?.n ?? 0],
          ['Credits', user.creditBalance],
          ...(chargebacks > 0
            ? ([
                [
                  'Flag',
                  <strong key="flag">
                    {chargebacks} chargeback{chargebacks === 1 ? '' : 's'}: check before granting
                  </strong>,
                ],
              ] as [string, ReactNode][])
            : []),
          ['Product news', user.marketingOptIn ? 'yes' : 'no'],
        ]}
      />
      <p>
        <a href={`/admin/users/${user.id}/data`} className="underline underline-offset-4">
          Download this account’s data (JSON)
        </a>{' '}
        <span className="text-14 text-text-muted">(logged in the audit log)</span>
      </p>

      <Section title="Credits">
        <form action={changeCredits} className="flex max-w-md flex-col gap-3">
          <input type="hidden" name="userId" value={user.id} />
          <div className="flex gap-3">
            <label className="flex flex-col gap-1.5 text-14">
              <span className="font-strong">Grant or debit</span>
              <select
                name="direction"
                className="h-11 rounded-control border border-border bg-bg px-3 text-16"
              >
                <option value="grant">Grant</option>
                <option value="debit">Debit</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-14">
              <span className="font-strong">Credits</span>
              <Input name="amount" type="number" min={1} max={1_000_000} required />
            </label>
          </div>
          <ReasonField />
          <Button type="submit" className="self-start">
            Apply
          </Button>
        </form>
        {ledger.length > 0 && (
          <Table label="Credit ledger" head={['When', 'Kind', 'Amount', 'Balance', 'Reason']}>
            {ledger.map((row) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td>
                <td>{row.kind}</td>
                <td>{row.amount}</td>
                <td>{row.balanceAfter}</td>
                <td>{row.reason ?? ''}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Purchases">
        {bought.length === 0 ? (
          <p className="text-14 text-text-muted">None.</p>
        ) : (
          <Table label="Purchases" head={['When', 'Provider', 'Pack', 'Credits', 'Paid', 'Status']}>
            {bought.map((row) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td>
                <td>{providerName(row.provider)}</td>
                <td>{packName(row.packId)}</td>
                <td>{row.credits}</td>
                <td>{formatMoney(row.amountMinor, row.currency)}</td>
                <td>{row.status === 'chargeback' ? <strong>chargeback</strong> : row.status}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-14">
          <a
            href={`/admin/payments?user=${encodeURIComponent(user.email ?? user.id)}`}
            className="underline underline-offset-4"
          >
            In Payments
          </a>
        </p>
      </Section>

      <Section title="Recent server jobs">
        {recent.length === 0 ? (
          <p className="text-14 text-text-muted">None.</p>
        ) : (
          <Table label="Recent server jobs" head={['When', 'Tool', 'Status', 'Credits', 'Error']}>
            {recent.map((job) => (
              <tr key={job.id}>
                <td>
                  <a href={`/admin/jobs/${job.id}`} className="underline underline-offset-4">
                    {when(job.createdAt)}
                  </a>
                </td>
                <td>{job.toolId}</td>
                <td>{job.status}</td>
                <td>{job.creditsCharged}</td>
                <td>{job.errorCode ?? ''}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="API keys">
        {keys.length === 0 ? (
          <p className="text-14 text-text-muted">None.</p>
        ) : (
          <>
            <Table label="API keys" head={['Name', 'Prefix', 'Created', 'Last used', 'Revoked']}>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td className="font-mono text-12">{key.prefix}</td>
                  <td>{when(key.createdAt)}</td>
                  <td>{when(key.lastUsedAt)}</td>
                  <td>{key.revokedAt ? when(key.revokedAt) : 'no'}</td>
                </tr>
              ))}
            </Table>
            <form action={revokeKeys} className="flex max-w-md flex-col gap-3">
              <input type="hidden" name="userId" value={user.id} />
              <ReasonField />
              <Button type="submit" className="self-start">
                Revoke every key
              </Button>
            </form>
          </>
        )}
      </Section>

      {!user.deletedAt && (
        <Section title={user.disabledAt ? 'Enable the account' : 'Disable the account'}>
          <p className="text-14 text-text-muted">
            {user.disabledAt
              ? 'It can sign in again.'
              : 'It’s signed out everywhere and can’t sign in until enabled.'}
          </p>
          <form action={setDisabled} className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="disable" value={user.disabledAt ? '0' : '1'} />
            <ReasonField />
            <Button type="submit" className="self-start">
              {user.disabledAt ? 'Enable' : 'Disable'}
            </Button>
          </form>
        </Section>
      )}

      {!user.deletedAt && user.email && (
        <Section title="Delete the account">
          <p className="text-14 text-text-muted">
            As if they deleted it: signed out everywhere, keys revoked, queued jobs cancelled and
            refunded. Signing in within 30 days restores it; then the email is erased.
          </p>
          <form action={deleteUser} className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <label className="flex flex-col gap-1.5 text-14">
              <span className="font-strong">Type the account’s email to confirm</span>
              <Input name="confirm" autoComplete="off" required />
            </label>
            <ReasonField />
            <Button type="submit" className="self-start">
              Delete the account
            </Button>
          </form>
        </Section>
      )}
    </AdminFrame>
  );
}
