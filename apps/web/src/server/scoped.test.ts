import { describe, expect, it, vi } from 'vitest';

import type { Job, Quote } from '@etb/core/api';

import { jobFor, quoteFor } from './scoped';

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
