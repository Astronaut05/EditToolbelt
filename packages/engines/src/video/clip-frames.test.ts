import { describe, expect, it } from 'vitest';

import { even, framesPerStretch, steadyRate } from './clip-frames';

describe('clip frames', () => {
  it('encode at an even size, as H.264 and HEVC need', () => {
    expect([even(1437), even(899)]).toEqual([1438, 900]);
    expect([even(1920), even(1080)]).toEqual([1920, 1080]);
    expect(even(1)).toBe(2);
  });

  it('give the output a frame rate only when the clip has a steady one', () => {
    expect(steadyRate({ underlyingFrameRate: 30_000 / 1001 })).toEqual({
      frameRate: 30_000 / 1001,
    });
    // Variable frame rate: none, so every frame keeps its own time.
    expect(steadyRate({ underlyingFrameRate: null })).toEqual({});
    expect(steadyRate(null)).toEqual({});
  });

  it('hold fewer frames per stretch the bigger they are', () => {
    expect(framesPerStretch(256, 144)).toBe(90);
    expect(framesPerStretch(3840, 2160)).toBe(12);
    expect(framesPerStretch(8192, 8192)).toBe(8);
  });
});
