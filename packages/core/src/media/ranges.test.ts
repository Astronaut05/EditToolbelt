import { describe, expect, it } from 'vitest';

import {
  addRange,
  clampRange,
  invertRanges,
  keptSpans,
  layoutSpans,
  normalizeRanges,
} from './ranges';

describe('ranges', () => {
  it('sorts, clips and merges overlapping or touching ranges', () => {
    expect(
      normalizeRanges(
        [
          { start: 8, end: 12 },
          { start: -1, end: 2 },
          { start: 1.5, end: 3 },
          { start: 12, end: 14 },
          { start: 20, end: 25 },
          { start: 4, end: 4.0001 },
        ],
        21,
      ),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 14 },
      { start: 20, end: 21 },
    ]);
  });

  it('inverts to what is left, for "remove"', () => {
    expect(
      invertRanges(
        [
          { start: 2, end: 3 },
          { start: 5, end: 10 },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(invertRanges([{ start: 0, end: 10 }], 10)).toEqual([]);
    expect(keptSpans([{ start: 2, end: 4 }], 10, 'keep')).toEqual([{ start: 2, end: 4 }]);
  });

  it('lays kept spans end to end and finds the joins', () => {
    const layout = layoutSpans([
      { start: 5, end: 15 },
      { start: 20, end: 22.5 },
      { start: 30, end: 31 },
    ]);
    expect(layout.offsets).toEqual([0, 10, 12.5]);
    expect(layout.joins).toEqual([10, 12.5]);
    expect(layout.length).toBe(13.5);
  });

  it('adds a range at the playhead, else after the last one, and keeps them apart', () => {
    const ranges = [{ start: 2, end: 4 }];
    expect(addRange(ranges, 6, 20, 2)).toEqual({
      ranges: [
        { start: 2, end: 4 },
        { start: 6, end: 8 },
      ],
      active: 1,
    });
    // Playhead inside a range: the next free stretch after the last range.
    expect(addRange(ranges, 3, 20, 2)?.ranges[1]).toEqual({ start: 4, end: 6 });
    // Short of room: as long as the stretch allows.
    expect(addRange([{ start: 0, end: 9.5 }], 0, 10, 2)?.ranges[1]).toEqual({
      start: 9.5,
      end: 10,
    });
    expect(addRange([{ start: 0, end: 10 }], 5, 10, 2)).toBeNull();
  });

  it('keeps a range between its neighbours', () => {
    const ranges = [
      { start: 1, end: 3 },
      { start: 5, end: 7 },
      { start: 9, end: 10 },
    ];
    expect(clampRange(ranges, 1, { start: 2, end: 9.5 }, 12, 0.1)).toEqual({ start: 3, end: 9 });
    expect(clampRange(ranges, 1, { start: 8.95, end: 9 }, 12, 0.1)).toEqual({
      start: 8.9,
      end: 9,
    });
  });
});
