/**
 * @etb/db: the Drizzle schema, the client and the credit ledger
 * (docs/04-data-model.md). Migrations live in ../migrations and run with
 * `pnpm db:migrate`.
 */
export * from './schema';
export { createDb, type Db, type Queryable, type Schema } from './client';
export {
  applyCredit,
  InsufficientCreditsError,
  ledgerMismatches,
  type CreditRefs,
  type LedgerRow,
} from './credits';
