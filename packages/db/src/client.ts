/**
 * A Drizzle client over a node-postgres pool. One pool per process: the web
 * server keeps it for its lifetime, scripts and tests close it when done.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction, or the database itself: anything queries can run on. */
export type Queryable = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string, options: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  return { db: drizzle(pool, { schema }), pool };
}
