import { describe, expect, it } from 'vitest';

import { durationFor, fileSize, MB, MIB, videoBitrateFor } from './bitrate';

describe('bitrate', () => {
  it('matches the spec example: 60 s at 8 Mbps + 192 kbps', () => {
    const bytes = fileSize(60, 8_000, 192);
    expect(bytes / MB).toBeCloseTo(61.44, 5);
    expect(bytes / MIB).toBeCloseTo(58.59, 2);
  });

  it('solves any one from the other two', () => {
    expect(durationFor(61_440_000, 8_000, 192)).toBeCloseTo(60, 6);
    expect(videoBitrateFor(61_440_000, 60, 192)).toBeCloseTo(8_000, 6);
    expect(videoBitrateFor(10 * MB, 0)).toBe(0);
  });

  it('backs the FAQ example: 100 MB in 5 minutes with 128 kbps audio', () => {
    expect(videoBitrateFor(100 * MB, 300, 128)).toBeCloseTo(2538.67, 2);
  });
});
