import {
  and,
  count,
  eq,
  gte,
  isNull,
  jobs,
  serviceHeartbeats,
  sessions,
  sql,
  sum,
  toolFlags,
  users,
} from '@etb/db';
import { statusOf, tools } from '@etb/registry';

import { AdminFrame, Facts, Section, Table, when } from '../../../components/admin/AdminFrame';
import { loadToolFlags } from '../../../lib/flags';
import { db } from '../../../server/db';
import { serverEnv } from '../../../server/env';
import { requestTime } from '../../../server/time';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;
/** A service that hasn't checked in for this long counts as down (docs/07 → Alerts). */
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

/** docs/07 → Dashboard, with what exists in M3; server jobs and money arrive in M4 and M5. */
export default async function AdminDashboard() {
  await loadToolFlags();
  const d = db();
  const now = requestTime();
  const since = (hours: number) => new Date(now - hours * HOUR);
  const live = and(isNull(users.deletedAt), sql`${users.email} is not null`);

  const [
    [accounts],
    [day],
    [week],
    [admins],
    [signedIn],
    [balances],
    jobRows,
    heartbeats,
    overrides,
  ] = await Promise.all([
    d.select({ n: count() }).from(users).where(live),
    d
      .select({ n: count() })
      .from(users)
      .where(and(live, gte(users.createdAt, since(24)))),
    d
      .select({ n: count() })
      .from(users)
      .where(and(live, gte(users.createdAt, since(24 * 7)))),
    d.select({ n: count() }).from(users).where(eq(users.role, 'admin')),
    d
      .select({ n: count() })
      .from(sessions)
      .where(gte(sessions.expiresAt, new Date(now))),
    d.select({ total: sum(users.creditBalance) }).from(users),
    d
      .select({ status: jobs.status, n: count() })
      .from(jobs)
      .where(gte(jobs.createdAt, since(24)))
      .groupBy(jobs.status),
    d.select().from(serviceHeartbeats).orderBy(serviceHeartbeats.service),
    d.select({ n: count() }).from(toolFlags),
  ]);

  const byStatus = new Map<string, number>();
  for (const tool of tools) byStatus.set(statusOf(tool), (byStatus.get(statusOf(tool)) ?? 0) + 1);
  const jobsBy = (status: string) => jobRows.find((row) => row.status === status)?.n ?? 0;
  const env = serverEnv();

  return (
    <AdminFrame title="Dashboard" current="/admin">
      <Section title="Accounts">
        <Facts
          items={[
            ['Accounts', accounts?.n ?? 0],
            ['New in 24 h', day?.n ?? 0],
            ['New in 7 days', week?.n ?? 0],
            ['Admins', admins?.n ?? 0],
            ['Signed-in sessions', signedIn?.n ?? 0],
            ['Credits held', Number(balances?.total ?? 0)],
          ]}
        />
      </Section>
      <Section title="Tools">
        <Facts
          items={[
            ['Live', byStatus.get('live') ?? 0],
            ['Beta', byStatus.get('beta') ?? 0],
            ['Soon', byStatus.get('soon') ?? 0],
            ['Disabled', byStatus.get('disabled') ?? 0],
            ['With admin overrides', overrides[0]?.n ?? 0],
          ]}
        />
      </Section>
      <Section title="Server jobs, last 24 h">
        <Facts
          items={[
            ['Succeeded', jobsBy('succeeded')],
            ['Failed', jobsBy('failed')],
            ['Queued now', jobsBy('queued')],
          ]}
        />
        <p className="text-14 text-text-muted">
          Server tools start with M4; queue wait, run times and GPU cost show here then. Credits
          sold and revenue arrive with payments in M5.
        </p>
      </Section>
      <Section title="Browser tools">
        <p className="text-14 text-text-muted">
          Browser tools create no rows here: their runs and failures are cookieless analytics events
          (docs/09).{' '}
          {env.ANALYTICS_URL ? (
            <a href={env.ANALYTICS_URL} className="underline underline-offset-4">
              Open the analytics dashboard
            </a>
          ) : (
            'Analytics are off: ANALYTICS_URL is not set.'
          )}
        </p>
      </Section>
      <Section title="Services">
        {heartbeats.length === 0 ? (
          <p className="text-14 text-text-muted">No service has checked in yet.</p>
        ) : (
          <Table label="Services" head={['Service', 'Instance', 'Version', 'Last seen', 'State']}>
            {heartbeats.map((beat) => (
              <tr key={`${beat.service}/${beat.instance}`}>
                <td>{beat.service}</td>
                <td className="font-mono text-12">{beat.instance}</td>
                <td className="font-mono text-12">{beat.version}</td>
                <td>{when(beat.seenAt)}</td>
                <td>{now - beat.seenAt.getTime() < HEARTBEAT_STALE_MS ? 'Up' : 'Missing'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </AdminFrame>
  );
}
