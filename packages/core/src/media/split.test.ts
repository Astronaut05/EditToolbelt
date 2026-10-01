import { describe, expect, it } from 'vitest';

import { equalParts, MAX_PARTS, pieceParts, silenceParts, TooManyParts } from './split';

describe('split', () => {
  it('cuts equal parts that cover the whole file', () => {
    expect(equalParts(9, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
    ]);
  });

  it('cuts pieces of a set length, the last one what is left', () => {
    expect(pieceParts(25, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
    ]);
    // A 0.02 s sliver at the end joins the piece before.
    expect(pieceParts(20.02, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20.02 },
    ]);
  });

  it('splits in the middle of each silence, not at the file’s own edges', () => {
    const silences = [
      { start: 0, end: 0.5 },
      { start: 4, end: 5 },
      { start: 9, end: 9.4 },
      { start: 11.5, end: 12 },
    ];
    expect(silenceParts(12, silences)).toEqual([
      { start: 0, end: 4.5 },
      { start: 4.5, end: 9.2 },
      { start: 9.2, end: 12 },
    ]);
  });

  it('makes at most 50 parts', () => {
    expect(equalParts(100, MAX_PARTS)).toHaveLength(MAX_PARTS);
    expect(() => equalParts(100, 51)).toThrow(TooManyParts);
    expect(() => pieceParts(3600, 60)).toThrow(/60 parts/);
  });
});
