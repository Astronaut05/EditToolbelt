/**
 * @etb/db: the Drizzle schema, the client and the credit ledger
 * (docs/04-data-model.md). Migrations live in ../migrations and run with
 * `pnpm db:migrate`.
 */
export * from './schema';
/** Query helpers, from this package's own drizzle-orm so every caller shares one copy. */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  sum,
} from 'drizzle-orm';
export { createDb, type Db, type Queryable, type Schema } from './client';
export {
  applyCredit,
  InsufficientCreditsError,
  ledgerMismatches,
  type CreditRefs,
  type LedgerRow,
} from './credits';
