import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  jobs,
  serviceHeartbeats,
  sessions,
  sql,
  sum,
  toolFlags,
  toolStatsDaily,
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

/** Milliseconds as seconds or minutes, or a dash. */
const ms = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '–'
    : value < 120_000
      ? `${(value / 1000).toFixed(1)} s`
      : `${(value / 60_000).toFixed(1)} min`;

/** docs/07 → Dashboard: accounts, tools, server jobs and services; money arrives in M5. */
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
    [busy],
    [timings],
    byTool,
    nightly,
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
    d
      .select({
        queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${jobs.status} = 'running')`.mapWith(Number),
      })
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running'])),
    // Wait: queued to started; run: started to finished (docs/07 → p95 wait and run time).
    d
      .select({
        waitP95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by extract(epoch from ${jobs.startedAt} - ${jobs.queuedAt}) * 1000)`.mapWith(
          (value) => (value === null ? null : Number(value)),
        ),
        runP95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by extract(epoch from ${jobs.finishedAt} - ${jobs.startedAt}) * 1000)`.mapWith(
          (value) => (value === null ? null : Number(value)),
        ),
      })
      .from(jobs)
      .where(and(gte(jobs.createdAt, since(24)), sql`${jobs.startedAt} is not null`)),
    d
      .select({
        toolId: jobs.toolId,
        total: count(),
        failed:
          sql<number>`count(*) filter (where ${jobs.status} in ('failed', 'expired'))`.mapWith(
            Number,
          ),
      })
      .from(jobs)
      .where(gte(jobs.createdAt, since(24)))
      .groupBy(jobs.toolId)
      .orderBy(desc(count())),
    d
      .select()
      .from(toolStatsDaily)
      .where(gte(toolStatsDaily.day, new Date(now - 8 * 24 * HOUR).toISOString().slice(0, 10)))
      .orderBy(desc(toolStatsDaily.day), desc(toolStatsDaily.jobsTotal))
      .limit(60),
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
            ['Failed', jobsBy('failed') + jobsBy('expired')],
            ['Cancelled', jobsBy('cancelled')],
            ['Waiting now', busy?.queued ?? 0],
            ['Running now', busy?.running ?? 0],
            ['Wait, p95', ms(timings?.waitP95)],
            ['Run time, p95', ms(timings?.runP95)],
          ]}
        />
        {byTool.length > 0 && (
          <Table label="Server jobs by tool, last 24 h" head={['Tool', 'Jobs', 'Failed', 'Rate']}>
            {byTool.map((row) => (
              <tr key={row.toolId}>
                <td>
                  <a
                    href={`/admin/jobs?tool=${row.toolId}`}
                    className="underline underline-offset-4"
                  >
                    {row.toolId}
                  </a>
                </td>
                <td>{row.total}</td>
                <td>{row.failed}</td>
                <td>
                  {row.total ? `${String(Math.round((row.failed / row.total) * 100))} %` : '–'}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-14 text-text-muted">
          GPU cost shows once GPU tools run (M5); credits sold and revenue arrive with payments.
        </p>
      </Section>
      <Section title="Server jobs by day">
        {nightly.length === 0 ? (
          <p className="text-14 text-text-muted">
            The worker sums up each day at 03:00 Tashkent; nothing yet.
          </p>
        ) : (
          <Table
            label="Server jobs by day"
            head={['Day', 'Tool', 'Runtime', 'Jobs', 'Failed', 'p50', 'p95', 'Credits']}
          >
            {nightly.map((row) => (
              <tr key={`${row.day}/${row.toolId}/${row.runtime}`}>
                <td>{row.day}</td>
                <td>{row.toolId}</td>
                <td>{row.runtime}</td>
                <td>{row.jobsTotal}</td>
                <td>{row.jobsFailed}</td>
                <td>{ms(row.p50Ms)}</td>
                <td>{ms(row.p95Ms)}</td>
                <td>{row.creditsCharged}</td>
              </tr>
            ))}
          </Table>
        )}
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
