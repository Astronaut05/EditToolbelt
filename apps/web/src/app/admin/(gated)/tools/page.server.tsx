import { and, count, eq, gte, jobs, toolFlags } from '@etb/db';
import { statusOf, tools } from '@etb/registry';

import { AdminFrame, Table } from '../../../../components/admin/AdminFrame';
import { loadToolFlags } from '../../../../lib/flags';
import { db } from '../../../../server/db';

export const dynamic = 'force-dynamic';

/** docs/07 → Tools: every registry tool, its default and effective status, and today's jobs. */
export default async function AdminTools() {
  await loadToolFlags();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [flags, todays, failed] = await Promise.all([
    db().select().from(toolFlags),
    db()
      .select({ toolId: jobs.toolId, n: count() })
      .from(jobs)
      .where(gte(jobs.createdAt, today))
      .groupBy(jobs.toolId),
    db()
      .select({ toolId: jobs.toolId, n: count() })
      .from(jobs)
      .where(and(gte(jobs.createdAt, today), eq(jobs.status, 'failed')))
      .groupBy(jobs.toolId),
  ]);
  const flagOf = new Map(flags.map((flag) => [flag.toolId, flag]));
  const jobsOf = new Map(todays.map((row) => [row.toolId, row.n]));
  const failedOf = new Map(failed.map((row) => [row.toolId, row.n]));

  return (
    <AdminFrame title="Tools" current="/admin/tools">
      <p className="text-14 text-text-muted">
        Changes show on the site within 30 seconds. Open a tool to change its status, maintenance
        message or limits.
      </p>
      <Table
        label="Tools"
        head={['Code', 'Tool', 'Category', 'Default', 'Now', 'Runtime', 'Jobs today', 'Failed']}
      >
        {tools.map((tool) => {
          const flag = flagOf.get(tool.id);
          const now = statusOf(tool);
          return (
            <tr key={tool.id}>
              <td className="font-mono text-12">{tool.code}</td>
              <td>
                <a href={`/admin/tools/${tool.id}`} className="underline underline-offset-4">
                  {tool.name}
                </a>
                {flag?.maintenanceMessage && (
                  <span className="ml-2 text-12 text-warning">maintenance</span>
                )}
              </td>
              <td>{tool.category}</td>
              <td>{tool.status}</td>
              <td className={now === tool.status ? '' : 'font-strong'}>{now}</td>
              <td>{tool.runtime}</td>
              <td>{jobsOf.get(tool.id) ?? 0}</td>
              <td>{failedOf.get(tool.id) ?? 0}</td>
            </tr>
          );
        })}
      </Table>
    </AdminFrame>
  );
}
