import { describe, expect, it } from 'vitest';

import { frameTimes, MAX_FRAMES, stamp } from './frames';

describe('frameTimes', () => {
  it('takes one frame at the In point', () => {
    expect(frameTimes({ mode: 'single' }, 5.4, 30)).toEqual([5.4]);
  });

  it('takes a frame every N seconds from the start, not past the end', () => {
    expect(frameTimes({ mode: 'interval', every: '5' }, 0, 30)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(frameTimes({ mode: 'interval', every: '2.5' }, 1, 7)).toEqual([1, 3.5, 6]);
    expect(frameTimes({ mode: 'interval', every: '5' }, 0, 31)).toHaveLength(7);
    expect(frameTimes({ mode: 'interval', every: '5' }, 0, 2)).toEqual([0]);
  });

  it('spaces N frames evenly, each in the middle of its part', () => {
    expect(frameTimes({ mode: 'count', count: '4' }, 0, 8)).toEqual([1, 3, 5, 7]);
  });

  it('makes a sheet of columns × rows', () => {
    expect(frameTimes({ mode: 'sheet', grid: '4x4' }, 0, 32)).toHaveLength(16);
    expect(frameTimes({ mode: 'sheet', grid: '3x2' }, 0, 12)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('refuses too many frames, or none', () => {
    expect(() => frameTimes({ mode: 'interval', every: '0.01' }, 0, 60)).toThrow(
      String(MAX_FRAMES),
    );
    expect(() => frameTimes({ mode: 'count', count: '0' }, 0, 10)).toThrow();
    expect(() => frameTimes({ mode: 'interval', every: '0' }, 0, 10)).toThrow();
  });
});

describe('stamp', () => {
  it('writes hours, minutes, seconds and milliseconds', () => {
    expect(stamp(5.4)).toBe('00:00:05.400');
    expect(stamp(3725.0425)).toBe('01:02:05.043');
    expect(stamp(0)).toBe('00:00:00.000');
  });
});
