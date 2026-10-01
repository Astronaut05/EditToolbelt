import { adminAuditLog, desc, eq, lt, users } from '@etb/db';

import { AdminFrame, Table, when } from '../../../../components/admin/AdminFrame';
import { db } from '../../../../server/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE = 100;

/** docs/07 → Audit log: every admin action, newest first, 100 a page. */
export default async function AdminAudit({ searchParams }: Props) {
  const before = (await searchParams).before;
  const rows = await db()
    .select({
      id: adminAuditLog.id,
      at: adminAuditLog.createdAt,
      admin: users.email,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      reason: adminAuditLog.reason,
    })
    .from(adminAuditLog)
    .leftJoin(users, eq(users.id, adminAuditLog.adminId))
    // UUIDv7 ids sort by time, so they page the log.
    .where(typeof before === 'string' ? lt(adminAuditLog.id, before) : undefined)
    .orderBy(desc(adminAuditLog.id))
    .limit(PAGE);
  const last = rows.at(-1);

  return (
    <AdminFrame title="Audit log" current="/admin/audit">
      {rows.length === 0 ? (
        <p className="text-14 text-text-muted">Nothing yet.</p>
      ) : (
        <Table label="Audit log" head={['When', 'Admin', 'Action', 'Target', 'Reason']}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{when(row.at)}</td>
              <td>{row.admin ?? 'deleted admin'}</td>
              <td className="font-mono text-12">{row.action}</td>
              <td>
                {row.targetType === 'user' ? (
                  <a href={`/admin/users/${row.targetId}`} className="underline underline-offset-4">
                    user {row.targetId.slice(0, 8)}
                  </a>
                ) : row.targetType === 'job' ? (
                  <a href={`/admin/jobs/${row.targetId}`} className="underline underline-offset-4">
                    job {row.targetId.slice(0, 8)}
                  </a>
                ) : row.targetType === 'tool' ? (
                  <a href={`/admin/tools/${row.targetId}`} className="underline underline-offset-4">
                    {row.targetId}
                  </a>
                ) : (
                  `${row.targetType} ${row.targetId}`
                )}
              </td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </Table>
      )}
      {rows.length === PAGE && last && (
        <a href={`/admin/audit?before=${last.id}`} className="underline underline-offset-4">
          Older
        </a>
      )}
    </AdminFrame>
  );
}
