/**
 * For integration tests in any package (TEST_DATABASE_URL): applies the
 * migrations once, under an advisory lock, so test runs that start at the
 * same time (Turborepo runs packages in parallel) don't race on a fresh
 * database. Never for production: `pnpm db:migrate` does that.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Brings the database at `url` up to the latest migration. */
export async function migrateForTests(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('etb.test-migrations'))");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }
}
