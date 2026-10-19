/**
 * docs/07 → Health endpoints: ready to serve. The database and storage
 * answer, and the registry is loaded. Errors are RFC 9457 problem details and
 * say which part is down, never why in detail.
 */
import { sql } from '@etb/db';
import { tools } from '@etb/registry';

import { log } from '../../lib/log';
import { db } from '../../server/db';
import { storageReady } from '../../server/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [database, storage] = await Promise.all([
    db()
      .execute(sql`select 1`)
      .then(
        () => null,
        (error: unknown) => databaseDetail(error),
      ),
    storageReady(),
  ]);
  const checks = { database: database === null, storage: storage.ok, registry: tools.length > 0 };
  const ready = Object.values(checks).every(Boolean);
  if (!ready) {
    // The answer only names the part that is down; the reason goes to the log.
    log.warn(
      {
        checks,
        ...(database === null ? {} : { database }),
        ...(storage.ok ? {} : { storage: storage.detail }),
      },
      'readyz.not_ready',
    );
  }
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

/** The driver's error code and message, cut short. Connection errors name a host, never the password. */
function databaseDetail(error: unknown): string {
  // Drizzle wraps the driver's error ("Failed query: …"); the cause says why.
  const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(root instanceof Error)) return 'failed';
  const code = (root as { code?: unknown }).code;
  const message = root.message.slice(0, 200);
  return typeof code === 'string' ? `${code}: ${message}` : message;
}
