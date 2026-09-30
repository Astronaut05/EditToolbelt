import { describe, expect, it } from 'vitest';

import { ApiError } from './problem';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('counts down in a window, refuses past the limit, and starts again after it', () => {
    const key = `test:${String(Math.random())}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 2, 60, t0)).toEqual({
      'RateLimit-Limit': '2',
      'RateLimit-Remaining': '1',
      'RateLimit-Reset': '60',
    });
    expect(rateLimit(key, 2, 60, t0 + 1000)['RateLimit-Remaining']).toBe('0');
    try {
      rateLimit(key, 2, 60, t0 + 2000);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const refused = error as ApiError;
      expect(refused.status).toBe(429);
      expect(refused.code).toBe('RATE_LIMITED');
      expect(refused.headers['Retry-After']).toBe('58');
    }
    expect(rateLimit(key, 2, 60, t0 + 60_000)['RateLimit-Remaining']).toBe('1');
  });

  it('keeps keys apart', () => {
    const t0 = 5_000_000;
    rateLimit('a-only', 1, 60, t0);
    expect(() => rateLimit('b-only', 1, 60, t0)).not.toThrow();
  });
});
