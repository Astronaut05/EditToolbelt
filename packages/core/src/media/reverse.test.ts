import { describe, expect, it } from 'vitest';

import { joinGain, reversePieces } from './reverse';

describe('reversePieces', () => {
  it('reads a whole file in windows, last to first, the last open to the end', () => {
    expect(reversePieces(0, null, 100, 250)).toEqual([
      { from: 200, to: null, reverse: true },
      { from: 100, to: 200, reverse: true },
      { from: 0, to: 100, reverse: true },
    ]);
  });

  it('keeps what is around a selection as it is', () => {
    expect(reversePieces(50, 180, 100, 400)).toEqual([
      { from: 0, to: 50, reverse: false },
      { from: 150, to: 180, reverse: true },
      { from: 50, to: 150, reverse: true },
      { from: 180, to: null, reverse: false },
    ]);
  });

  it('covers every frame once, with no gaps', () => {
    const pieces = reversePieces(37, 1003, 64, 2000);
    const covered = pieces
      .map((piece) => [piece.from, piece.to ?? 2000] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(covered[0]?.[0]).toBe(0);
    covered.slice(1).forEach(([from], i) => {
      expect(from).toBe(covered[i]?.[1]);
    });
    expect(covered.at(-1)?.[1]).toBe(2000);
  });

  it('a selection up to the end is open, so frames past the estimate are kept', () => {
    expect(reversePieces(100, null, 1000, 300)).toEqual([
      { from: 0, to: 100, reverse: false },
      { from: 100, to: null, reverse: true },
    ]);
  });
});

describe('joinGain', () => {
  it('dips to silence at each join and back over the fade', () => {
    const joins = [100];
    expect(joinGain(0, joins, 10)).toBe(1);
    expect(joinGain(89, joins, 10)).toBe(1);
    expect(joinGain(99, joins, 10)).toBeCloseTo(0.05);
    expect(joinGain(100, joins, 10)).toBeCloseTo(0.05);
    expect(joinGain(95, joins, 10)).toBeCloseTo(0.45);
    expect(joinGain(110, joins, 10)).toBe(1);
  });

  it('is 1 everywhere with no joins', () => {
    expect(joinGain(5, [], 10)).toBe(1);
  });
});
