import { describe, expect, it } from 'vitest';

import { ANCHORS, markBox, tileBoxes } from './watermark';

describe('markBox', () => {
  it('puts a 15% logo bottom-right with a 2% margin, the same on every size', () => {
    for (const [w, h] of [
      [4000, 3000],
      [1080, 1920],
      [640, 640],
    ] as const) {
      const box = markBox(w, h, 0.5, { anchor: 'br', size: 0.15, margin: 0.02 });
      expect(box.width).toBe(Math.round(w * 0.15));
      expect(box.height).toBe(Math.round(box.width * 0.5));
      expect(box.x + box.width).toBe(w - Math.round(w * 0.02));
      expect(box.y + box.height).toBe(h - Math.round(w * 0.02));
    }
  });

  it('places all nine positions', () => {
    const boxes = ANCHORS.map((anchor) =>
      markBox(1000, 600, 0.2, { anchor, size: 0.1, margin: 0 }),
    );
    expect(boxes.map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [450, 0],
      [900, 0],
      [0, 290],
      [450, 290],
      [900, 290],
      [0, 580],
      [450, 580],
      [900, 580],
    ]);
  });

  it('nudges by an offset that scales with the width', () => {
    const at = (w: number, h: number) =>
      markBox(w, h, 1, { anchor: 'c', size: 0.1, margin: 0, offsetX: 0.05, offsetY: -0.02 });
    expect(at(1000, 1000)).toEqual({ x: 500, y: 430, width: 100, height: 100 });
    expect(at(2000, 1000)).toEqual({ x: 1000, y: 360, width: 200, height: 200 });
  });
});

describe('tileBoxes', () => {
  it('covers the whole image, every other row offset by half a step', () => {
    const boxes = tileBoxes(1000, 500, 0.25, 0.2, 0.1);
    const rows = [...new Set(boxes.map((b) => b.y))];
    // 50 px tall marks 100 px apart, from half a mark above the top: 4 rows over 500 px.
    expect(rows).toEqual([-25, 125, 275, 425]);
    expect(Math.min(...boxes.map((b) => b.x))).toBeLessThanOrEqual(0);
    // No edge has a wider bare strip than the 100 px spacing between marks.
    expect(Math.max(...boxes.map((b) => b.x + b.width)) + 100).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...boxes.map((b) => b.y + b.height)) + 100).toBeGreaterThanOrEqual(500);
    const firstX = (y: number) => Math.min(...boxes.filter((b) => b.y === y).map((b) => b.x));
    expect(firstX(rows[0] ?? 0) - firstX(rows[1] ?? 0)).toBe(150);
  });
});
