/**
 * For integration tests against TEST_DATABASE_URL (`@etb/db/testing`). Test
 * files of several packages run at once against one database, so migrations
 * are applied under an advisory lock: the first applies them, the others wait
 * and then find nothing to do.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applies pending migrations, one test process at a time. */
export async function migrateForTests(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('etb.test-migrations'))");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('etb.test-migrations'))")
      .catch(() => undefined);
    client.release();
  }
}
