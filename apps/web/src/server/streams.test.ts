import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from './account';
import type { Job } from './jobs';
import { jobEvents } from './jobs';
import { ApiError } from './problem';
import { MAX_STREAMS, openStreams, takeStream } from './streams';

// A job read again finds nothing, so a stream that polls once ends.
vi.mock('./db', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  }),
}));
vi.mock('../lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('progress stream slots', () => {
  it('give an account 5 at once, and one back as each closes', () => {
    const releases = Array.from({ length: MAX_STREAMS }, () => takeStream('acct-a'));
    expect(openStreams('acct-a')).toBe(MAX_STREAMS);
    try {
      takeStream('acct-a');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).code).toBe('RATE_LIMITED');
      expect((error as ApiError).headers['Retry-After']).toBe('15');
    }
    // Another account is unaffected.
    expect(() => {
      takeStream('acct-b')();
    }).not.toThrow();
    // Releasing twice gives back one slot, not two.
    releases[0]?.();
    releases[0]?.();
    expect(openStreams('acct-a')).toBe(MAX_STREAMS - 1);
    expect(() => takeStream('acct-a')).not.toThrow();
    expect(() => takeStream('acct-a')).toThrow(ApiError);
    for (const release of releases) release();
  });
});

const user = { id: 'u1' } as CurrentUser;
const row = (status: Job['status']) =>
  ({
    id: 'j1',
    toolId: 'compress-video',
    status,
    progress: 10,
    stage: null,
    priority: 0,
    funding: 'none',
    creditsQuoted: 0,
    creditsCharged: 0,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: new Date(),
    errorCode: 'TIMEOUT',
    errorDetail: null,
    outputKey: null,
    outputMeta: null,
  }) as unknown as Job;

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('jobEvents', () => {
  it('gives its slot back once the job ends', async () => {
    const release = takeStream('acct-c');
    const text = await drain(jobEvents(user, row('failed'), new AbortController().signal, release));
    expect(text).toContain('event: done');
    expect(openStreams('acct-c')).toBe(0);
  });

  it('gives its slot back when the client leaves', async () => {
    const release = takeStream('acct-d');
    const leave = new AbortController();
    const reader = jobEvents(user, row('running'), leave.signal, release).getReader();
    await reader.read();
    leave.abort();
    await reader.cancel();
    await vi.waitFor(() => {
      expect(openStreams('acct-d')).toBe(0);
    });
  });
});
