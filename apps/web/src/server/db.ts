/** One Postgres pool per server process, kept across hot reloads in dev. */
import { createDb, type Db } from '@etb/db';

import { serverEnv } from './env';

const store = globalThis as typeof globalThis & { etbDb?: Db };

export function db(): Db {
  store.etbDb ??= createDb(serverEnv().DATABASE_URL).db;
  return store.etbDb;
}
