import { describe, expect, it, vi } from 'vitest';

import type { Job, Quote } from '@etb/core/api';

import { ApiError } from './problem';
import { errorFor, jobFor, quoteFor } from './scoped';

vi.mock('./db', () => ({ db: () => ({}) }));

const job: Job = {
  id: 'j1',
  tool_id: 'compress-video',
  status: 'succeeded',
  progress: 100,
  stage: null,
  position: null,
  funding: 'credits',
  credits_quoted: 2,
  credits_charged: 2,
  created_at: '2026-10-02T10:00:00Z',
  started_at: '2026-10-02T10:00:01Z',
  finished_at: '2026-10-02T10:01:00Z',
  error: null,
  result: {
    download_url: 'https://storage.test/out/1?X-Amz-Signature=abc',
    bytes: 10,
    content_type: 'video/mp4',
    ext: 'mp4',
    width: null,
    height: null,
    notes: [],
    expires_at: '2026-10-02T11:01:00Z',
  },
};

const ready: Quote = {
  status: 'ready',
  tool_id: 'compress-video',
  upload_id: 'u1',
  credits: 2,
  funding: 'credits',
  can_start: true,
  free_jobs_left: 0,
  balance: 30,
  balance_after: 28,
  estimate_seconds: null,
  options: {},
};

describe('what a caller sees', () => {
  it('a job’s result needs jobs:read', () => {
    expect(jobFor({ scopes: ['jobs:write'] }, job)).not.toHaveProperty('result');
    expect(jobFor({ scopes: ['jobs:write'] }, job)).toMatchObject({
      id: 'j1',
      status: 'succeeded',
    });
    expect(jobFor({ scopes: ['jobs:write', 'jobs:read'] }, job).result).toEqual(job.result);
    expect(jobFor({ scopes: 'all' }, job).result).toEqual(job.result);
    // The original is left alone.
    expect(job.result).not.toBeUndefined();
  });

  it('a quote’s balance and free jobs need account:read', () => {
    const hidden = quoteFor({ scopes: ['jobs:write'] }, ready);
    expect(hidden).not.toHaveProperty('balance');
    expect(hidden).not.toHaveProperty('balance_after');
    expect(hidden).not.toHaveProperty('free_jobs_left');
    expect(hidden).toMatchObject({ credits: 2, funding: 'credits', can_start: true });
    expect(quoteFor({ scopes: ['jobs:write', 'account:read'] }, ready)).toEqual(ready);
    expect(quoteFor({ scopes: 'all' }, ready)).toEqual(ready);
    expect(quoteFor({ scopes: ['jobs:write'] }, { status: 'probing' })).toEqual({
      status: 'probing',
    });
  });
});

// docs/06: balance, shortfall and free_jobs_left need account:read, in a refusal too.
describe('a refusal to start a job', () => {
  const short = new ApiError(
    402,
    'INSUFFICIENT_CREDITS',
    'Not enough credits',
    'This needs 12 credits; you have 5.',
    { credits: 12, balance: 5, shortfall: 7, buy_url: 'https://site.test/credits/buy' },
  );
  const changed = new ApiError(
    409,
    'CONFLICT',
    'What pays for this job changed',
    'Today’s free server jobs are used up, so this one costs 2 credits. Confirm the new quote.',
    { credits: 2, funding: 'credits', free_jobs_left: 0, balance: 40 },
  );
  const quota = new ApiError(
    429,
    'QUOTA_EXCEEDED',
    'No free jobs left today',
    'They come back tomorrow (UTC).',
  );

  it('keeps the account’s numbers from a key with jobs:write alone', () => {
    const key = { scopes: ['jobs:write'] } as const;
    const a = errorFor(key, short);
    expect(a.status).toBe(402);
    expect(a.code).toBe('INSUFFICIENT_CREDITS');
    expect(a.extra).toEqual({ credits: 12, buy_url: 'https://site.test/credits/buy' });
    expect(a.detail).not.toMatch(/\d/);
    const b = errorFor(key, changed);
    expect(b.status).toBe(409);
    expect(b.extra).toEqual({ credits: 2, funding: 'credits' });
    expect(b.detail).toBe('Confirm the new quote.');
    // Nothing about the account in it: left as it is.
    expect(errorFor(key, quota)).toBe(quota);
  });

  it('shows them to the website and to a key with account:read', () => {
    expect(errorFor({ scopes: ['jobs:write', 'account:read'] }, short)).toBe(short);
    expect(errorFor({ scopes: ['jobs:read', 'jobs:write', 'account:read'] }, changed)).toBe(
      changed,
    );
  });
});
