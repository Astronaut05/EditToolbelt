import { describe, expect, it } from 'vitest';

import { bytesFor, CODECS, durationLabel, GB, hoursOn, sizeLabel, TB } from './storage';

describe('recording storage', () => {
  it('fits 22 hours of 100 Mbps 4K on a 1 TB drive', () => {
    // 1e12 bytes × 8 ÷ 100 Mbps = 80,000 s.
    expect(hoursOn(TB, 100)).toBeCloseTo(80_000 / 3600);
    expect(durationLabel(hoursOn(TB, 100))).toBe('22 h 13 min');
    expect(durationLabel(hoursOn(128 * GB, 707))).toBe('24 min');
  });

  it('goes the other way: what a shoot needs', () => {
    expect(bytesFor(1, 100)).toBe(45 * GB);
    expect(sizeLabel(bytesFor(3, 220))).toBe('297 GB');
    expect(sizeLabel(bytesFor(10, 471))).toBe('2.12 TB');
    expect(sizeLabel(bytesFor(0.5, 17))).toBe('3.8 GB');
  });

  it('reads nothing into empty input', () => {
    expect(hoursOn(0, 100)).toBe(0);
    expect(hoursOn(TB, 0)).toBe(0);
    expect(bytesFor(-1, 100)).toBe(0);
    expect(durationLabel(0)).toBe('0 min');
    expect(durationLabel(0.001)).toBe('1 min');
    expect(durationLabel(2)).toBe('2 h');
  });

  it('has typical bitrates with unique ids', () => {
    expect(new Set(CODECS.map((c) => c.id)).size).toBe(CODECS.length);
    expect(CODECS.every((c) => c.mbps > 0)).toBe(true);
  });
});
