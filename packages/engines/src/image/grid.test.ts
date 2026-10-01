import { describe, expect, it } from 'vitest';

import { GridError, gridTiles, tileName, type GridSpec } from './grid';

const spec = (over: Partial<GridSpec> = {}): GridSpec => ({
  rows: 3,
  cols: 3,
  gap: 0,
  remainder: 'equal',
  order: 'rows',
  ...over,
});

describe('grid tiles (P14)', () => {
  it('splits 3000 × 3000 into 9 × 1000 × 1000 in row order (tools/photo.md)', () => {
    const tiles = gridTiles({ width: 3000, height: 3000 }, spec());
    expect(tiles).toHaveLength(9);
    expect(tiles.every((t) => t.width === 1000 && t.height === 1000)).toBe(true);
    expect(tiles.map((t) => [t.x, t.y])).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
      [0, 1000],
      [1000, 1000],
      [2000, 1000],
      [0, 2000],
      [1000, 2000],
      [2000, 2000],
    ]);
    expect(tiles.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps tiles equal and trims the leftover evenly, or spreads it', () => {
    const equal = gridTiles({ width: 1081, height: 400 }, spec({ rows: 1, cols: 3 }));
    expect(equal.map((t) => t.width)).toEqual([360, 360, 360]);
    expect(equal[0]?.x).toBe(0);
    const spread = gridTiles(
      { width: 1081, height: 400 },
      spec({ rows: 1, cols: 3, remainder: 'spread' }),
    );
    expect(spread.map((t) => t.width).reduce((a, b) => a + b)).toBe(1081);
    expect(
      Math.max(...spread.map((t) => t.width)) - Math.min(...spread.map((t) => t.width)),
    ).toBeLessThanOrEqual(1);
    expect(spread.at(-1)?.x).toBe(1081 - (spread.at(-1)?.width ?? 0));
  });

  it('leaves the gap out between tiles, so the picture lines up across a feed', () => {
    const tiles = gridTiles(
      { width: 3000 + 2 * 25, height: 1000 },
      spec({ rows: 1, cols: 3, gap: 0.025 }),
    );
    expect(tiles.map((t) => [t.x, t.width])).toEqual([
      [0, 1000],
      [1025, 1000],
      [2050, 1000],
    ]);
  });

  it('numbers a profile grid in posting order: the last tile first', () => {
    const tiles = gridTiles({ width: 300, height: 300 }, spec({ order: 'posting' }));
    expect(tiles[0]).toMatchObject({ row: 3, col: 3, seq: 1 });
    expect(tiles.at(-1)).toMatchObject({ row: 1, col: 1, seq: 9 });
    const last = tiles[0];
    if (!last) throw new Error('no tiles');
    expect(tileName('holiday', last, 9, 'jpg')).toBe('holiday_1_r3c3.jpg');
    expect(tileName('a', { ...last, seq: 3 }, 10, 'png')).toBe('a_03_r3c3.png');
  });

  it('refuses grids that make no sense', () => {
    expect(() => gridTiles({ width: 100, height: 100 }, spec({ rows: 1, cols: 1 }))).toThrow(
      GridError,
    );
    expect(() => gridTiles({ width: 100, height: 100 }, spec({ rows: 11, cols: 10 }))).toThrow(
      GridError,
    );
    expect(() => gridTiles({ width: 100, height: 100 }, spec({ rows: 1, cols: 10 }))).toThrow(
      /under 16 px/,
    );
  });
});
