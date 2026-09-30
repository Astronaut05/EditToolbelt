import { desc, ilike, sql, users } from '@etb/db';
import { Button, Input } from '@etb/ui';

import { AdminFrame, Table, when } from '../../../../components/admin/AdminFrame';
import { db } from '../../../../server/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** docs/07 → Users: search by email; the newest 50 without a search. */
export default async function AdminUsers({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim().slice(0, 254) : '';
  // Escape LIKE's wildcards: the search is a plain "contains".
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db()
    .select()
    .from(users)
    .where(q ? ilike(sql`${users.email}::text`, pattern) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(50);

  return (
    <AdminFrame title="Users" current="/admin/users">
      <form role="search" className="flex max-w-md gap-3">
        <label htmlFor="q" className="sr-only">
          Search by email
        </label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search by email" />
        <Button type="submit">Search</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-14 text-text-muted">No accounts{q ? ' match' : ' yet'}.</p>
      ) : (
        <Table head={['Email', 'Joined', 'Role', 'Credits', 'State']}>
          {rows.map((user) => (
            <tr key={user.id}>
              <td>
                <a href={`/admin/users/${user.id}`} className="underline underline-offset-4">
                  {user.email ?? `deleted (${user.id.slice(0, 8)})`}
                </a>
              </td>
              <td>{when(user.createdAt)}</td>
              <td>{user.role}</td>
              <td>{user.creditBalance}</td>
              <td>{user.deletedAt ? 'deleted' : user.disabledAt ? 'disabled' : 'active'}</td>
            </tr>
          ))}
        </Table>
      )}
    </AdminFrame>
  );
}
