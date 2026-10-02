import { describe, expect, it } from 'vitest';

import { collageCells, COLLAGE_TEMPLATES, coverCrop, layoutOf } from './collage';

describe('collageCells', () => {
  it('a 2 × 2 grid on 1000 × 1000 with 20 px spacing: four 470 px squares', () => {
    expect(collageCells('grid', 4, 1000, 1000, 20)).toEqual([
      { index: 0, x: 20, y: 20, width: 470, height: 470 },
      { index: 1, x: 510, y: 20, width: 470, height: 470 },
      { index: 2, x: 20, y: 510, width: 470, height: 470 },
      { index: 3, x: 510, y: 510, width: 470, height: 470 },
    ]);
  });

  it('every template, for 2 to 9 photos, tiles the canvas with exact gaps', () => {
    for (const template of COLLAGE_TEMPLATES) {
      for (let n = 2; n <= 9; n += 1) {
        const [w, h, gap] = [1081, 1349, 13];
        const cells = collageCells(template, n, w, h, gap);
        expect(cells.map((c) => c.index)).toEqual([...Array(n).keys()]);
        // The photos and the gaps cover the canvas: area adds up with the gaps' area.
        const covered = cells.reduce((sum, c) => sum + c.width * c.height, 0);
        expect(covered).toBeLessThan(w * h);
        for (const c of cells) {
          // Inside the outer spacing.
          expect(c.x).toBeGreaterThanOrEqual(gap);
          expect(c.y).toBeGreaterThanOrEqual(gap);
          expect(c.x + c.width).toBeLessThanOrEqual(w - gap);
          expect(c.y + c.height).toBeLessThanOrEqual(h - gap);
          // No two photos overlap, and neighbours are exactly one gap apart or further.
          for (const d of cells) {
            if (d === c) continue;
            const apartX = Math.max(d.x - (c.x + c.width), c.x - (d.x + d.width));
            const apartY = Math.max(d.y - (c.y + c.height), c.y - (d.y + d.height));
            expect(Math.max(apartX, apartY)).toBeGreaterThanOrEqual(gap);
          }
        }
        // Something touches each outer edge, exactly one gap in.
        expect(Math.min(...cells.map((c) => c.x))).toBe(gap);
        expect(Math.max(...cells.map((c) => c.x + c.width))).toBe(w - gap);
        expect(Math.max(...cells.map((c) => c.y + c.height))).toBe(h - gap);
      }
    }
  });

  it('grids are as square as they get, the fuller rows last', () => {
    const rows = (n: number) => {
      const cells = collageCells('grid', n, 1200, 1200, 0);
      return [...new Set(cells.map((c) => c.y))].map((y) => cells.filter((c) => c.y === y).length);
    };
    expect(rows(5)).toEqual([2, 3]);
    expect(rows(7)).toEqual([2, 2, 3]);
    expect(rows(9)).toEqual([3, 3, 3]);
  });

  it('feature puts the first photo large, twice the width of the rest', () => {
    const [big, ...rest] = collageCells('feature', 4, 900, 600, 0);
    expect(big).toEqual({ index: 0, x: 0, y: 0, width: 600, height: 600 });
    expect(rest.every((c) => c.x === 600 && c.width === 300 && c.height === 200)).toBe(true);
  });

  it('refuses what can’t be made', () => {
    expect(() => layoutOf('grid', 1)).toThrow(/2 to 9/);
    expect(() => layoutOf('grid', 10)).toThrow(/2 to 9/);
    expect(() => collageCells('columns', 9, 100, 100, 20)).toThrow(/spacing/);
  });
});

describe('coverCrop', () => {
  it('crops a wide photo’s sides to fill a square, centred', () => {
    expect(coverCrop(400, 200, 100, 100)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(coverCrop(200, 400, 100, 50)).toEqual({ x: 0, y: 150, width: 200, height: 100 });
  });
});
