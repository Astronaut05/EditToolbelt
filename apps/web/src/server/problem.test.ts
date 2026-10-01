import { describe, expect, it } from 'vitest';

import { ApiError, problem } from './problem';

describe('problem', () => {
  it('answers RFC 9457 problem+json with a stable code and never caches', async () => {
    const response = problem(
      new ApiError(413, 'FILE_TOO_LARGE', 'File too large', 'The limit is 2.1 GB.', {
        max_bytes: 5,
      }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'File too large',
      status: 413,
      code: 'FILE_TOO_LARGE',
      detail: 'The limit is 2.1 GB.',
      max_bytes: 5,
    });
  });
});
