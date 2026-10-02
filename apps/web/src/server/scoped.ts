/**
 * What a caller may see of an answer (docs/06 → Auth → Scopes). A key with
 * jobs:write alone can start and cancel jobs, but a job's `result` (its
 * download URL) needs jobs:read, and a quote's balance and free jobs left
 * need account:read. The website's session holds every scope.
 */
import type { Job, Quote } from '@etb/core/api';

import { holds, type Caller } from './api';

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
