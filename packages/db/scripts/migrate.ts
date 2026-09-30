/**
 * Applies pending migrations: `pnpm db:migrate` (local stack: the `migrate`
 * service does it before web and worker start). Reads DATABASE_URL; never
 * prints it. Migrations must stay backward-compatible with the running
 * release (docs/01 → Production).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL: required but not set. See .env.example.\n');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  });
  process.stdout.write('Migrations applied.\n');
} finally {
  await pool.end();
}
