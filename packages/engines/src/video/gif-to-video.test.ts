import { describe, expect, it } from 'vitest';

import { evenSize, flatten, parseColour } from './gif-to-video';

describe('GIF to MP4', () => {
  it('reads background colours, and falls back to white', () => {
    expect(parseColour('#1a2b3c')).toEqual([26, 43, 60]);
    expect(parseColour('000000')).toEqual([0, 0, 0]);
    expect(parseColour('red')).toEqual([255, 255, 255]);
    expect(parseColour(undefined)).toEqual([255, 255, 255]);
  });

  it('rounds odd sizes up to even', () => {
    expect(evenSize(300, 169)).toEqual({ width: 300, height: 170 });
    expect(evenSize(1, 1)).toEqual({ width: 2, height: 2 });
  });

  it('puts transparent pixels, and the added column, on the background', () => {
    // 1 × 2: one red pixel, one transparent.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 9, 9, 9, 0]);
    const out = new Uint8Array(2 * 2 * 4);
    flatten(rgba, 1, 2, out, 2, [0, 128, 255]);
    expect(Array.from(out.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    // The added column, and the transparent pixel below the red one.
    expect(Array.from(out.subarray(4, 8))).toEqual([0, 128, 255, 255]);
    expect(Array.from(out.subarray(8, 12))).toEqual([0, 128, 255, 255]);
  });
});
