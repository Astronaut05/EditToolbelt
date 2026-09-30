/**
 * docs/07 → Health endpoints: ready to serve. The database and storage
 * answer, and the registry is loaded. Errors are RFC 9457 problem details and
 * say which part is down, never why in detail.
 */
import { sql } from '@etb/db';
import { tools } from '@etb/registry';

import { db } from '../../server/db';
import { storageReady } from '../../server/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [database, storage] = await Promise.all([
    db()
      .execute(sql`select 1`)
      .then(
        () => true,
        () => false,
      ),
    storageReady(),
  ]);
  const checks = { database, storage, registry: tools.length > 0 };
  const ready = Object.values(checks).every(Boolean);
  if (ready) {
    return Response.json({ status: 'ready', checks }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(
    {
      type: 'about:blank',
      title: 'Not ready',
      status: 503,
      detail: `Down: ${Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
        .join(', ')}`,
      checks,
    },
    {
      status: 503,
      headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' },
    },
  );
}
