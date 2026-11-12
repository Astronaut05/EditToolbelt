/**
 * What a caller may see of an answer (docs/06 → Auth → Scopes). A key with
 * jobs:write alone can start and cancel jobs, but a job's `result` (its
 * download URL) needs jobs:read, and a quote's balance and free jobs left
 * need account:read. The website's session holds every scope.
 */
import type { Job, Quote } from '@etb/core/api';

import { holds, type Caller } from './api';
import { ApiError } from './problem';

type Scoped = Pick<Caller, 'scopes'>;

/** The job without its `result` unless the caller holds jobs:read. */
export function jobFor(caller: Scoped, job: Job): Job {
  if (holds(caller, 'jobs:read')) return job;
  const shown = { ...job };
  delete shown.result;
  return shown;
}

/** The quote without the account's numbers unless the caller holds account:read. */
export function quoteFor(caller: Scoped, quote: Quote): Quote {
  if (quote.status !== 'ready' || holds(caller, 'account:read')) return quote;
  const shown = { ...quote };
  delete shown.free_jobs_left;
  delete shown.balance;
  delete shown.balance_after;
  return shown;
}

/** What a problem answer may say about the account only to a caller with account:read. */
const ACCOUNT_FIELDS = ['balance', 'balance_after', 'shortfall', 'free_jobs_left'];

/**
 * A refusal to start a job, as this caller may see it. The 402 and the 409
 * carry the balance and the free jobs left, for the website's own offer; a
 * key with jobs:write alone gets them without those numbers, in the fields
 * and in the sentence, or it could read the balance by asking for a job it
 * knows will be refused.
 */
export function errorFor(caller: Scoped, error: ApiError): ApiError {
  if (holds(caller, 'account:read')) return error;
  if (!ACCOUNT_FIELDS.some((field) => field in error.extra)) return error;
  const extra = Object.fromEntries(
    Object.entries(error.extra).filter(([field]) => !ACCOUNT_FIELDS.includes(field)),
  );
  const detail =
    error.code === 'INSUFFICIENT_CREDITS'
      ? 'This job costs more credits than the account has.'
      : error.code === 'CONFLICT'
        ? 'Confirm the new quote.'
        : error.detail;
  return new ApiError(error.status, error.code, error.title, detail, extra, error.headers);
}
