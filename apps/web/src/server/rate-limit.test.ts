import { describe, expect, it } from 'vitest';

import { ApiError } from './problem';
import { countCall, MAX_WINDOWS, rateLimit, lockoutLeft, strike, windowCount } from './rate-limit';

const unique = (name: string) => `test:${name}:${String(Math.random())}`;

describe('rateLimit', () => {
  it('counts down in a window, refuses past the limit, and starts again after it', () => {
    const key = unique('count');
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
      expect(refused.headers['RateLimit-Remaining']).toBe('0');
    }
    expect(rateLimit(key, 2, 60, t0 + 60_000)['RateLimit-Remaining']).toBe('1');
  });

  it('keeps keys apart', () => {
    const t0 = 5_000_000;
    rateLimit(unique('a'), 1, 60, t0);
    expect(() => rateLimit(unique('b'), 1, 60, t0)).not.toThrow();
  });

  it('countCall says when the window is used up instead of throwing', () => {
    const key = unique('soft');
    const t0 = 7_000_000;
    expect(countCall(key, 1, 60, t0).exceeded).toBe(false);
    const over = countCall(key, 1, 60, t0 + 500);
    expect(over.exceeded).toBe(true);
    expect(over.headers['RateLimit-Remaining']).toBe('0');
  });
});

describe('the windows', () => {
  it('are swept once they expire, without waiting for the map to fill', () => {
    const t0 = 9_000_000;
    const before = windowCount();
    for (let i = 0; i < 600; i += 1) rateLimit(unique(`sweep${String(i)}`), 5, 1, t0);
    expect(windowCount()).toBeGreaterThanOrEqual(before);
    // An hour on, the next few hundred calls sweep every expired window.
    const later = t0 + 3_600_000;
    for (let i = 0; i < 600; i += 1) rateLimit(unique(`later${String(i)}`), 5, 1, later);
    expect(windowCount()).toBeLessThan(700);
  });

  it('never grow past MAX_WINDOWS, dropping the oldest first', () => {
    const t0 = 20_000_000;
    const first = unique('oldest');
    rateLimit(first, 1, 3600, t0);
    for (let i = 0; i < MAX_WINDOWS + 10; i += 1) rateLimit(`flood:${String(i)}`, 5, 3600, t0);
    expect(windowCount()).toBeLessThanOrEqual(MAX_WINDOWS + 1);
    // The oldest window went, so its key starts afresh.
    expect(() => rateLimit(first, 1, 3600, t0)).not.toThrow();
  });
});

describe('lockouts after failures', () => {
  it('lock once the limit is struck, until the window ends', () => {
    const key = unique('strikes');
    const t0 = 30_000_000;
    for (let i = 1; i <= 9; i += 1) {
      expect(strike(key, 600, t0 + i)).toBe(i);
      expect(lockoutLeft(key, 10, t0 + i)).toBe(0);
    }
    strike(key, 600, t0 + 10);
    expect(lockoutLeft(key, 10, t0 + 60_000)).toBe(541);
    expect(lockoutLeft(key, 10, t0 + 600_001)).toBe(0);
  });

  it('never lock out a key with no strikes', () => {
    expect(lockoutLeft(unique('none'), 1)).toBe(0);
  });
});
