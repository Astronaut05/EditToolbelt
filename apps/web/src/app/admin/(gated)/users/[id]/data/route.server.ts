/** An account's data export, for an admin (docs/07 → Users: "trigger data export"). Audited. */
import { eq, users } from '@etb/db';

import { exportAccount } from '../../../../../../server/account';
import { audit, requireAdmin } from '../../../../../../server/admin';
import { db } from '../../../../../../server/db';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [user] = await db().select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!user) return new Response('Not found', { status: 404 });
  const data = await exportAccount(user.id);
  await audit(db(), {
    adminId: admin.id,
    action: 'user.export',
    targetType: 'user',
    targetId: user.id,
    reason: 'Downloaded the account’s data export from the admin',
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="edittoolbelt-user-${user.id.slice(0, 8)}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
