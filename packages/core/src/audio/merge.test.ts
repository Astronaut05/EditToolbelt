import { describe, expect, it } from 'vitest';

import { placedGain, placedLength, placeJoined, placeMixed } from './merge';

const R = 48_000;
const ten = [10 * R, 10 * R, 10 * R];

describe('placing files', () => {
  it('joins 3 × 10 s with 1 s crossfades into 28 s (the spec’s test)', () => {
    const placed = placeJoined(ten, 'crossfade', R);
    expect(placed.map((p) => p.at / R)).toEqual([0, 9, 18]);
    expect(placedLength(placed) / R).toBe(28);
  });

  it('cuts straight on, or leaves a gap between', () => {
    expect(placedLength(placeJoined(ten, 'cut', R)) / R).toBe(30);
    const gapped = placeJoined(ten, 'gap', R / 2);
    expect(gapped.map((p) => p.at / R)).toEqual([0, 10.5, 21]);
    expect(placedLength(gapped) / R).toBe(31);
  });

  it('mixes from the start, as long as the longest', () => {
    expect(placedLength(placeMixed([5 * R, 12 * R, 8 * R])) / R).toBe(12);
  });

  it('refuses a crossfade longer than half the shortest file', () => {
    expect(() => placeJoined([10 * R, 3 * R], 'crossfade', 2 * R)).toThrow(RangeError);
    expect(() => placeJoined([10 * R, 4 * R], 'crossfade', 2 * R)).not.toThrow();
  });
});

describe('placedGain', () => {
  it('keeps the power constant through a crossfade', () => {
    const [a, b] = placeJoined(ten, 'crossfade', 4800);
    if (!a || !b) throw new Error('two files');
    for (const j of [0, 1, 1200, 2400, 4799]) {
      const out = placedGain(a, a.length - a.fadeOut + j);
      const into = placedGain(b, j);
      expect(out ** 2 + into ** 2).toBeCloseTo(1, 10);
    }
    expect(placedGain(a, 1000)).toBe(1);
    expect(placedGain(b, b.length - 1)).toBeLessThan(0.01);
  });
});
