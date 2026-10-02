import { describe, expect, it } from 'vitest';

import {
  adjustNote,
  adjustTables,
  adjustValue,
  applyAdjust,
  isNeutral,
  NO_ADJUST,
  type Adjust,
} from './adjust';

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const run = (data: Uint8ClampedArray, change: Partial<Adjust>) => {
  applyAdjust(data, { ...NO_ADJUST, ...change });
  return Array.from(data);
};

describe('applyAdjust', () => {
  it('leaves pixels alone when nothing is moved', () => {
    expect(isNeutral(NO_ADJUST)).toBe(true);
    expect(isNeutral(undefined)).toBe(true);
    expect(isNeutral({ ...NO_ADJUST, warmth: 1 })).toBe(false);
    expect(run(px(12, 200, 99, 7), {})).toEqual([12, 200, 99, 7]);
  });

  it('brightens midtones but keeps black, white and alpha', () => {
    const [r] = run(px(128, 128, 128), { brightness: 100 });
    // (128/255)^0.5 × 255
    expect(r).toBe(181);
    expect(run(px(0, 255, 0, 40), { brightness: 100 })).toEqual([0, 255, 0, 40]);
    expect(run(px(128, 128, 128), { brightness: -100 })[0]).toBe(64);
  });

  it('adds a stop of exposure as twice the light', () => {
    // sRGB 128 is 21.6 % linear; doubled, 43.2 %, which is sRGB 175.6.
    expect(run(px(128, 128, 128), { exposure: 1 })[0]).toBe(176);
    expect(run(px(200, 200, 200), { exposure: 2 })[0]).toBe(255);
  });

  it('spreads or flattens tones around middle grey for contrast', () => {
    // +50: twice the slope (72.5, 182.5); −100: a quarter (95.6, 159.4).
    expect(run(px(100, 155, 128), { contrast: 50 }).slice(0, 3)).toEqual([73, 182, 128]);
    expect(run(px(0, 255, 128), { contrast: -100 }).slice(0, 3)).toEqual([96, 159, 128]);
  });

  it('takes saturation to grey, or doubles it', () => {
    const [r, g, b] = run(px(200, 100, 50), { saturation: -100 });
    expect(r).toBe(g);
    expect(g).toBe(b);
    const vivid = run(px(150, 100, 100), { saturation: 100 });
    expect((vivid[0] ?? 0) - (vivid[1] ?? 0)).toBeGreaterThan(90);
  });

  it('warms towards orange and cools towards blue', () => {
    const [wr, , wb] = run(px(128, 128, 128), { warmth: 100 });
    const [cr, , cb] = run(px(128, 128, 128), { warmth: -100 });
    expect(wr).toBeGreaterThan(128);
    expect(wb).toBeLessThan(128);
    expect(cr).toBeLessThan(128);
    expect(cb).toBeGreaterThan(128);
  });

  it('builds one table per channel, rising from black to white', () => {
    const tables = adjustTables({ ...NO_ADJUST, contrast: 30, warmth: 40 });
    for (const table of tables) {
      for (let i = 1; i < 256; i += 1) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1] ?? 0);
    }
  });

  it('says what was moved, with signs and units', () => {
    expect(adjustValue('exposure', 0.5)).toBe('+0.5 EV');
    expect(adjustValue('contrast', -15)).toBe('−15');
    expect(adjustValue('warmth', 0)).toBe('0');
    expect(adjustNote({ ...NO_ADJUST, exposure: -1, saturation: 20 })).toBe(
      'Adjusted: exposure −1.0 EV, saturation +20',
    );
  });
});
