import { describe, expect, it } from 'vitest';

import { audioSeam, loopPlan } from './loop-video';

describe('loopPlan', () => {
  it('repeats a number of times', () => {
    expect(loopPlan({ mode: 'times', times: '3' }, 4)).toEqual({
      loops: 3,
      total: 12,
      label: '3×',
    });
  });

  it('repeats up to a length, the last copy cut short', () => {
    expect(loopPlan({ mode: 'length', length: '10' }, 4)).toMatchObject({ loops: 3, total: 10 });
    // A whole number of loops needs no cut.
    expect(loopPlan({ mode: 'length', length: '12' }, 4)).toMatchObject({ loops: 3, total: 12 });
  });

  it('refuses what it can’t make', () => {
    expect(() => loopPlan({ mode: 'times', times: '1' }, 4)).toThrow(/2 to 50/);
    expect(() => loopPlan({ mode: 'times', times: '51' }, 4)).toThrow(/2 to 50/);
    expect(() => loopPlan({ mode: 'times', times: '50' }, 120)).toThrow(/limit of 60/);
    expect(() => loopPlan({ mode: 'length', length: '3' }, 4)).toThrow(/already 4.00 s/);
    expect(() => loopPlan({ mode: 'length', length: '4000' }, 4)).toThrow(/60 min/);
  });
});

describe('audioSeam', () => {
  it('keeps the copies’ sound within half a packet of the picture, however many loops', () => {
    // A 4 s clip with 21.3 ms AAC packets from 0: the last one in a copy starts at 3.989 s.
    const d = 1024 / 48_000;
    const loop = 4;
    const packets = Array.from({ length: Math.ceil(loop / d) }, (_, k) => k * d).filter(
      (t) => t < loop - 1e-6,
    );
    let shift = 0;
    let previousEnd = -Infinity;
    for (let copy = 0; copy < 50; copy += 1) {
      const offset = copy * loop;
      const placed = packets.map((t) => t + offset + shift);
      // Each copy starts where the last one stopped: no overlap, no gap.
      if (copy > 0) expect(placed[0]).toBeCloseTo(previousEnd, 9);
      const last = placed[placed.length - 1] ?? 0;
      const seam = audioSeam(last + d, d, offset + loop);
      previousEnd = seam.keep ? last + d : last;
      // Where this copy's sound stops is within half a packet of where its picture does.
      expect(Math.abs(previousEnd - (offset + loop))).toBeLessThanOrEqual(d / 2 + 1e-9);
      shift = seam.shift;
    }
  });

  it('keeps a packet that overruns by half or less, and drops one that overruns by more', () => {
    const over = audioSeam(4.005, 0.02, 4);
    expect(over.keep).toBe(true);
    expect(over.shift).toBeCloseTo(0.005, 9);
    const far = audioSeam(4.015, 0.02, 4);
    expect(far.keep).toBe(false);
    expect(far.shift).toBeCloseTo(-0.005, 9);
  });

  it('leaves a real gap, and a packet of unknown length, at their own times', () => {
    // Sound that stops a second before the picture: the next copy still starts on time.
    expect(audioSeam(3, 0.02, 4)).toEqual({ keep: true, shift: 0 });
    // Matroska can leave a packet's duration at 0: nothing to line up by.
    expect(audioSeam(3.981, 0, 4)).toEqual({ keep: true, shift: 0 });
  });
});
