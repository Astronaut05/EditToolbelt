import { describe, expect, it } from 'vitest';

import { addTap, RESET_MS, tapBpm } from './tap';

describe('tap tempo', () => {
  it('needs 3 taps, then reads the median gap', () => {
    let taps: number[] = [];
    for (const t of [0, 500]) taps = addTap(taps, t);
    expect(tapBpm(taps)).toBeNull();
    for (const t of [1000, 1520, 2000, 2500]) taps = addTap(taps, t);
    // Gaps 500, 500, 520, 480, 500: the median is 500 ms, 120 BPM.
    expect(tapBpm(taps)).toBe(120);
  });

  it('starts over after a pause, and keeps the last 9 taps', () => {
    let taps = [0, 500, 1000];
    taps = addTap(taps, 1000 + RESET_MS + 1);
    expect(taps).toEqual([1000 + RESET_MS + 1]);
    taps = [];
    for (let i = 0; i < 20; i += 1) taps = addTap(taps, i * 400);
    expect(taps).toHaveLength(9);
    expect(tapBpm(taps)).toBe(150);
  });
});
