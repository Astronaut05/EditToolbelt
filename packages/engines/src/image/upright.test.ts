import { describe, expect, it } from 'vitest';

import { throughFrame, throughUpright, uprightFor, type Frame } from './upright';

const frames: Frame[] = [];
for (const turns of [0, 1, 2, 3]) {
  for (const flip of [false, true]) {
    for (const flipV of [false, true]) {
      for (const angle of [0, 12.5, -30]) frames.push({ turns, flip, flipV, angle });
    }
  }
}

describe('uprightFor', () => {
  it('undoes every frame: through the upright, then the frame, a vector comes back', () => {
    for (const frame of frames) {
      const upright = uprightFor(frame);
      for (const [x, y] of [
        [10, 0],
        [0, 7],
        [3, -4],
      ] as const) {
        const [ux, uy] = throughUpright(x, y, upright);
        const [fx, fy] = throughFrame(ux, uy, frame);
        expect(fx).toBeCloseTo(x, 6);
        expect(fy).toBeCloseTo(y, 6);
      }
    }
  });

  it('is nothing for no frame, and a quarter turn back for one turn', () => {
    expect(uprightFor({ turns: 0, flip: false, flipV: false, angle: 0 })).toEqual({
      rotation: 0,
      mirror: false,
    });
    expect(uprightFor({ turns: 1, flip: false, flipV: false, angle: 0 })).toEqual({
      rotation: -90,
      mirror: false,
    });
    expect(uprightFor({ turns: 0, flip: true, flipV: false, angle: 0 }).mirror).toBe(true);
  });
});
