import { describe, expect, it } from 'vitest';

import {
  decodeFaces,
  fromTile,
  mergeFaces,
  tilePlan,
  toInput,
  YUNET,
  type FaceBox,
  type YunetOutputs,
} from './yunet';

const SIZE = YUNET.size;

/** Empty outputs, with one confident cell at stride 16, row 10, column 20. */
function outputs(): YunetOutputs {
  const out: Record<string, Float32Array> = {};
  for (const stride of [8, 16, 32]) {
    const cells = (SIZE / stride) ** 2;
    out[`cls_${String(stride)}`] = new Float32Array(cells);
    out[`obj_${String(stride)}`] = new Float32Array(cells);
    out[`bbox_${String(stride)}`] = new Float32Array(cells * 4);
  }
  const i = 10 * (SIZE / 16) + 20;
  const cls = out.cls_16;
  const obj = out.obj_16;
  const bbox = out.bbox_16;
  if (!cls || !obj || !bbox) throw new Error('missing');
  cls[i] = 0.81;
  obj[i] = 1;
  bbox.set([0.5, 0.25, Math.log(4), Math.log(5)], i * 4);
  return out;
}

describe('decodeFaces', () => {
  it('turns a confident cell into a box the way OpenCV does', () => {
    const [face, ...rest] = decodeFaces(outputs());
    expect(rest).toEqual([]);
    // Centre (20.5, 10.25) cells × 16 px; 4 × 5 cells.
    expect(face?.score).toBeCloseTo(0.9);
    expect(face?.x).toBeCloseTo(20.5 * 16 - 32);
    expect(face?.y).toBeCloseTo(10.25 * 16 - 40);
    expect(face?.width).toBeCloseTo(64);
    expect(face?.height).toBeCloseTo(80);
  });

  it('drops cells under the threshold, and says when an output is missing', () => {
    expect(decodeFaces(outputs(), 0.95)).toEqual([]);
    const broken = outputs();
    delete broken.obj_32;
    expect(() => decodeFaces(broken)).toThrow(/stride 32/);
  });
});

describe('toInput', () => {
  it('makes planar BGR with 0-255 values', () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    rgba.set([10, 20, 30, 255], 0);
    const input = toInput(rgba, 2);
    expect(Array.from(input)).toEqual([30, 0, 0, 0, 20, 0, 0, 0, 10, 0, 0, 0]);
  });
});

describe('tilePlan', () => {
  it('reads a small photo once', () => {
    expect(tilePlan(800, 600)).toEqual([{ x: 0, y: 0, side: 800 }]);
    expect(tilePlan(1200, 900)).toEqual([{ x: 0, y: 0, side: 1200 }]);
  });

  it('adds overlapping tiles at 2× and 4× the detail for a large photo, inside it', () => {
    const tiles = tilePlan(4000, 3000);
    const level1 = tiles.filter((t) => t.side === 2000);
    const level2 = tiles.filter((t) => t.side === 1000);
    expect(tiles[0]).toEqual({ x: 0, y: 0, side: 4000 });
    expect(level1).toHaveLength(6);
    expect(level2).toHaveLength(20);
    for (const tile of [...level1, ...level2]) {
      expect(tile.x + tile.side).toBeLessThanOrEqual(4000);
      expect(tile.y + tile.side).toBeLessThanOrEqual(3000);
    }
    // Every column of the photo is covered at the finest level, edge to edge.
    const xs = [...new Set(level2.map((t) => t.x))];
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(3000);
    for (let i = 1; i < xs.length; i += 1) {
      expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeLessThan(1000);
    }
  });
});

describe('fromTile and mergeFaces', () => {
  const face = (x: number, y: number, w: number, score: number): FaceBox => ({
    x,
    y,
    width: w,
    height: w,
    score,
  });

  it('maps a tile’s input px to the photo', () => {
    expect(fromTile([face(64, 32, 64, 0.9)], { x: 1000, y: 500, side: 1280 })).toEqual([
      face(1128, 564, 128, 0.9),
    ]);
  });

  it('keeps one box per face: overlaps and cut-off parts go to the best box', () => {
    const merged = mergeFaces(
      [
        face(500, 100, 100, 0.8),
        face(505, 102, 98, 0.92),
        // A face cut by a tile's edge: mostly inside the whole one.
        face(500, 100, 50, 0.85),
        face(100, 300, 40, 0.75),
        // Past the photo's edge: clipped.
        face(-10, 10, 40, 0.9),
      ],
      700,
      500,
    );
    expect(merged).toEqual([
      { x: 0, y: 10, width: 30, height: 40, score: 0.9 },
      { x: 100, y: 300, width: 40, height: 40, score: 0.75 },
      { x: 505, y: 102, width: 98, height: 98, score: 0.92 },
    ]);
  });
});
