/**
 * docs/07 → Health endpoints: ready to serve. The database answers and the
 * registry is loaded (storage joins with M4's uploads). Errors are RFC 9457
 * problem details and say which part is down, never why in detail.
 */
import { sql } from '@etb/db';
import { tools } from '@etb/registry';

import { db } from '../../server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = { database: false, registry: tools.length > 0 };
  try {
    await db().execute(sql`select 1`);
    checks.database = true;
  } catch {
    // Reported below as not ready.
  }
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
