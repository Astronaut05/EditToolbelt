import {
  and,
  desc,
  eq,
  gte,
  ilike,
  jobs,
  jobSource,
  jobStatus,
  lt,
  sql,
  users,
  type SQL,
} from '@etb/db';
import { hasServerPath, tools } from '@etb/registry';
import { Button, Input, Select } from '@etb/ui';

import { AdminFrame, Table, took, when } from '../../../../components/admin/AdminFrame';
import { requireAdmin } from '../../../../server/admin';
import { db } from '../../../../server/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value.trim().slice(0, 254) : '';

/**
 * docs/07 → Jobs: every server job, newest first, 50 a page, filtered by
 * tool, status, source, the user's email and the day. Metadata only: the
 * admin never gets a user's file.
 */
export default async function AdminJobs({ searchParams }: Props) {
  await requireAdmin();
  const query = await searchParams;
  const filters = {
    tool: one(query.tool),
    status: one(query.status),
    source: one(query.source),
    user: one(query.user),
    from: one(query.from),
    to: one(query.to),
  };
  const before = one(query.before);
  const where: (SQL | undefined)[] = [
    filters.tool ? eq(jobs.toolId, filters.tool) : undefined,
    (jobStatus.enumValues as readonly string[]).includes(filters.status)
      ? eq(jobs.status, filters.status as (typeof jobStatus.enumValues)[number])
      : undefined,
    (jobSource.enumValues as readonly string[]).includes(filters.source)
      ? eq(jobs.source, filters.source as (typeof jobSource.enumValues)[number])
      : undefined,
    filters.user
      ? ilike(sql`${users.email}::text`, `%${filters.user.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      : undefined,
    DAY.test(filters.from) ? gte(jobs.createdAt, new Date(`${filters.from}T00:00:00Z`)) : undefined,
    DAY.test(filters.to)
      ? lt(jobs.createdAt, new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000))
      : undefined,
    // UUIDv7 ids sort by time, so they page the list.
    UUID.test(before) ? lt(jobs.id, before) : undefined,
  ];
  const rows = await db()
    .select({
      id: jobs.id,
      createdAt: jobs.createdAt,
      toolId: jobs.toolId,
      status: jobs.status,
      source: jobs.source,
      email: users.email,
      userId: jobs.userId,
      funding: jobs.funding,
      creditsCharged: jobs.creditsCharged,
      creditsQuoted: jobs.creditsQuoted,
      startedAt: jobs.startedAt,
      finishedAt: jobs.finishedAt,
      attempts: jobs.attempts,
      errorCode: jobs.errorCode,
    })
    .from(jobs)
    .leftJoin(users, eq(users.id, jobs.userId))
    .where(and(...where))
    .orderBy(desc(jobs.id))
    .limit(PAGE);
  const last = rows.at(-1);
  const keep = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ''),
  ).toString();
  const serverTools = tools.filter(
    (tool) => tool.runtime !== 'client' && (tool.runtime !== 'hybrid' || hasServerPath(tool)),
  );

  return (
    <AdminFrame title="Jobs" current="/admin/jobs">
      <form role="search" aria-label="Filter jobs" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-14">
          Tool
          <Select name="tool" defaultValue={filters.tool}>
            <option value="">Any</option>
            {serverTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-14">
          Status
          <Select name="status" defaultValue={filters.status}>
            <option value="">Any</option>
            {jobStatus.enumValues.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-14">
          Source
          <Select name="source" defaultValue={filters.source}>
            <option value="">Any</option>
            {jobSource.enumValues.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-14">
          User email
          <Input name="user" type="search" defaultValue={filters.user} />
        </label>
        <label className="flex flex-col gap-1.5 text-14">
          From
          <Input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label className="flex flex-col gap-1.5 text-14">
          To
          <Input name="to" type="date" defaultValue={filters.to} />
        </label>
        <Button type="submit">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-14 text-text-muted">No jobs{keep ? ' match' : ' yet'}.</p>
      ) : (
        <Table
          label="Jobs"
          head={['Created', 'Tool', 'Status', 'User', 'Paid by', 'Run time', 'Tries', 'Error']}
        >
          {rows.map((job) => (
            <tr key={job.id}>
              <td>
                <a href={`/admin/jobs/${job.id}`} className="underline underline-offset-4">
                  {when(job.createdAt)}
                </a>
              </td>
              <td>{job.toolId}</td>
              <td>{job.status}</td>
              <td>
                <a href={`/admin/users/${job.userId}`} className="underline underline-offset-4">
                  {job.email ?? `deleted (${job.userId.slice(0, 8)})`}
                </a>
              </td>
              <td>
                {job.funding === 'credits'
                  ? `${String(job.creditsCharged || job.creditsQuoted)} credits`
                  : job.funding === 'daily'
                    ? 'free daily job'
                    : 'free'}
              </td>
              <td>{took(job.startedAt, job.finishedAt)}</td>
              <td>{job.attempts}</td>
              <td className="font-mono text-12">{job.errorCode ?? ''}</td>
            </tr>
          ))}
        </Table>
      )}
      {rows.length === PAGE && last && (
        <a
          href={`/admin/jobs?${keep ? `${keep}&` : ''}before=${last.id}`}
          className="text-14 underline underline-offset-4"
        >
          Older jobs
        </a>
      )}
    </AdminFrame>
  );
}
