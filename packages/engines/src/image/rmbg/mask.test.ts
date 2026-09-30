import { describe, expect, it } from 'vitest';

import {
  boxMean,
  composite,
  fromHalf,
  guidedFilter,
  hardenMask,
  iou,
  paintStrokes,
  parseStrokes,
  resizeMask,
  toHalf,
  toMask,
  toTensor,
} from './mask';

describe('model input and output', () => {
  it('normalises RGBA into planes', () => {
    const rgba = Uint8Array.from([
      255, 0, 128, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const tensor = toTensor(rgba, 2, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    // Red plane first: 1 → 1, 0 → -1.
    expect(Array.from(tensor.slice(0, 4))).toEqual([1, -1, -1, 1]);
    expect(tensor[4 + 1]).toBe(1); // green of pixel 1
    expect(tensor[8]).toBeCloseTo(128 / 255 / 0.5 - 1, 5);
  });

  it('turns logits into probabilities and stretches a probability map', () => {
    expect(Array.from(toMask(Float32Array.from([0, 20, -20]), 'logits'))).toEqual([
      0.5,
      expect.closeTo(1, 6),
      expect.closeTo(0, 6),
    ]);
    expect(Array.from(toMask(Float32Array.from([0.2, 0.4, 0.6]), 'probability'))).toEqual([
      0,
      expect.closeTo(0.5, 6),
      1,
    ]);
  });
});

describe('mask upscaling', () => {
  it('resizes bilinearly, keeping flat areas flat', () => {
    const up = resizeMask(Float32Array.from([0, 1, 0, 1]), 2, 2, 4, 4);
    expect(up[0]).toBe(0);
    expect(up[3]).toBe(1);
    expect(up[1]).toBeCloseTo(0.25, 5);
  });

  it('box mean averages a window and clamps at the edges', () => {
    const mean = boxMean(Float32Array.from([0, 0, 9, 0, 0]), 5, 1, 1);
    expect(Array.from(mean)).toEqual([0, 3, 3, 3, 0]);
  });

  it('guided filter snaps a soft mask to the photo’s edge', () => {
    // A photo with a sharp edge at x = 16 and a blurry mask around it.
    const w = 32;
    const h = 8;
    const guide = new Float32Array(w * h);
    const soft = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        guide[y * w + x] = x < 16 ? 0.1 : 0.9;
        soft[y * w + x] = Math.min(1, Math.max(0, (x - 10) / 12));
      }
    }
    const refined = guidedFilter(guide, soft, w, h, 4, 1e-4);
    const row = (m: Float32Array) => Array.from(m.slice(3 * w, 4 * w));
    // Sharper than the input across the edge.
    const step = (m: number[]) => (m[17] ?? 0) - (m[14] ?? 0);
    expect(step(row(refined))).toBeGreaterThan(step(row(soft)));
    expect(row(refined)[4]).toBeLessThan(0.1);
    expect(row(refined)[28]).toBeGreaterThan(0.9);
  });

  it('hard edges ramp steeply around 0.5', () => {
    expect(Array.from(hardenMask(Float32Array.from([0.3, 0.5, 0.7])))).toEqual([0, 0.5, 1]);
  });
});

describe('composite', () => {
  const rgba = Uint8Array.from([200, 100, 50, 255, 200, 100, 50, 255]);
  const mask = Float32Array.from([1, 0.25]);

  it('keeps colour and puts the mask in alpha for a transparent result', () => {
    expect(Array.from(composite(rgba, mask, { kind: 'transparent' }))).toEqual([
      200, 100, 50, 255, 200, 100, 50, 64,
    ]);
  });

  // Uint8ClampedArray rounds halves to even: 12.5 → 12.
  it('blends onto a colour or other pixels', () => {
    expect(Array.from(composite(rgba, mask, { kind: 'color', rgb: [0, 0, 0] }))).toEqual([
      200, 100, 50, 255, 50, 25, 12, 255,
    ]);
    const behind = Uint8Array.from([0, 0, 0, 255, 0, 200, 0, 255]);
    expect(Array.from(composite(rgba, mask, { kind: 'pixels', rgba: behind })).slice(4)).toEqual([
      50, 175, 12, 255,
    ]);
  });

  it('scores masks by intersection over union', () => {
    expect(iou(Float32Array.from([1, 1, 0, 0]), Float32Array.from([1, 0, 0, 0]))).toBe(0.5);
    expect(iou(Float32Array.from([0, 0]), Float32Array.from([0, 0]))).toBe(1);
  });
});

describe('16-bit floats', () => {
  it('round-trips through half precision', () => {
    const values = Float32Array.from([0, 1, -2, 0.5, 65504, 1e-5, 0.1, 1e6]);
    const back = fromHalf(toHalf(values));
    expect(back[0]).toBe(0);
    expect(back[1]).toBe(1);
    expect(back[2]).toBe(-2);
    expect(back[3]).toBe(0.5);
    expect(back[4]).toBe(65504);
    expect(back[5]).toBeCloseTo(1e-5, 6);
    expect(back[6]).toBeCloseTo(0.1, 3);
    expect(back[7]).toBe(Infinity);
    // 1 + 2047/2048 rounds up across the exponent to 2.
    expect(fromHalf(toHalf(Float32Array.from([1.99995])))[0]).toBe(2);
  });
});

describe('refine brush', () => {
  it('keeps and erases along a stroke, softly at the rim', () => {
    const w = 40;
    const h = 10;
    const mask = new Float32Array(w * h).fill(0.2);
    const out = paintStrokes(mask, w, h, [
      {
        mode: 'keep',
        radius: 4,
        points: [
          [5, 5],
          [15, 5],
        ],
      },
      { mode: 'erase', radius: 4, points: [[30, 5]] },
    ]);
    const at = (x: number, y: number) => out[y * w + x] ?? -1;
    expect(at(10, 5)).toBe(1); // along the segment, between the dabs
    expect(at(30, 5)).toBe(0);
    expect(at(22, 5)).toBeCloseTo(0.2, 6); // untouched
    expect(at(10, 8)).toBeGreaterThan(0.2); // the soft rim
    expect(at(10, 8)).toBeLessThan(1);
    expect(mask[10 + 5 * w]).toBeCloseTo(0.2, 6); // the input is not changed
  });

  it('reads strokes from the option, dropping malformed ones', () => {
    expect(
      parseStrokes(
        JSON.stringify([
          {
            mode: 'keep',
            radius: 10,
            points: [
              [1, 2],
              [3, 4],
            ],
          },
          { mode: 'paint', radius: 10, points: [[1, 2]] },
          { mode: 'erase', radius: 5, points: [[1, 'x']] },
        ]),
      ),
    ).toEqual([
      {
        mode: 'keep',
        radius: 10,
        points: [
          [1, 2],
          [3, 4],
        ],
      },
    ]);
    expect(parseStrokes('not json')).toEqual([]);
    expect(parseStrokes(undefined)).toEqual([]);
  });
});
