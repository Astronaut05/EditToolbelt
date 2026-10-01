import { describe, expect, it } from 'vitest';

import { applyFades, FADE_CURVES, fadeGain } from './fades';

describe('fade curves', () => {
  it('start silent, end full', () => {
    for (const curve of FADE_CURVES) {
      expect(fadeGain(curve, 0)).toBeCloseTo(0, 10);
      expect(fadeGain(curve, 1)).toBeCloseTo(1, 10);
    }
  });

  it('match their formulas halfway', () => {
    expect(fadeGain('linear', 0.5)).toBe(0.5);
    expect(fadeGain('exponential', 0.5)).toBeCloseTo((Math.exp(2) - 1) / (Math.exp(4) - 1), 10);
    expect(fadeGain('exponential', 0.5)).toBeCloseTo(0.1192, 4);
    expect(fadeGain('logarithmic', 0.5)).toBeCloseTo(Math.log(1 + (Math.exp(4) - 1) / 2) / 4, 10);
    expect(fadeGain('logarithmic', 0.5)).toBeCloseTo(0.8313, 4);
    expect(fadeGain('s-curve', 0.5)).toBeCloseTo(0.5, 10);
    expect(fadeGain('s-curve', 0.25)).toBeCloseTo((1 - Math.cos(Math.PI / 4)) / 2, 10);
  });

  it('only rise', () => {
    for (const curve of FADE_CURVES) {
      let last = -1;
      for (let x = 0; x <= 1; x += 0.01) {
        const g = fadeGain(curve, x);
        expect(g).toBeGreaterThanOrEqual(last);
        last = g;
      }
    }
  });
});

describe('applyFades', () => {
  it('fades the first and last frames, the same in any block size', () => {
    const total = 1000;
    const fades = {
      inFrames: 100,
      outFrames: 200,
      inCurve: 'linear',
      outCurve: 's-curve',
      total,
    } as const;
    const whole = new Float32Array(total).fill(1);
    applyFades([whole], 0, fades);
    const blocks = new Float32Array(total).fill(1);
    for (let i = 0; i < total; i += 37) applyFades([blocks.subarray(i, i + 37)], i, fades);
    expect(Array.from(blocks)).toEqual(Array.from(whole));
    // Halfway through each fade.
    expect(whole[50]).toBeCloseTo(fadeGain('linear', 50.5 / 100), 6);
    expect(whole[899]).toBeCloseTo(fadeGain('s-curve', 100.5 / 200), 6);
    // Untouched in between.
    expect(whole[100]).toBe(1);
    expect(whole[799]).toBe(1);
    expect(whole[0]).toBeLessThan(0.01);
    expect(whole[999]).toBeLessThan(0.001);
  });
});
