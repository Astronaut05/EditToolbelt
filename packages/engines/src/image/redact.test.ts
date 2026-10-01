import { describe, expect, it } from 'vitest';

import {
  applyRedact,
  areaBox,
  areaMask,
  defaultAmount,
  faceArea,
  maxAmount,
  type Redact,
  type Redaction,
} from './redact';

/** A w × h image of deterministic noise, opaque. */
function noise(w: number, h: number, seed = 7) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i + c] = s & 255;
    }
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

const px = (image: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
  Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

const redact = (areas: Redaction[], over: Partial<Redact> = {}): Redact => ({
  effect: 'pixelate',
  amount: 16,
  color: '#000000',
  areas,
  ...over,
});

const box = (x0: number, y0: number, x1: number, y1: number): Redaction => ({
  shape: 'rect',
  points: [
    [x0, y0],
    [x1, y1],
  ],
});

describe('pixelate', () => {
  it('makes blocks of exactly the size asked, each the average of its pixels', () => {
    const image = noise(64, 48);
    const before = noise(64, 48);
    applyRedact(image, redact([box(0, 0, 64, 48)]));
    for (let by = 0; by < 48; by += 16) {
      for (let bx = 0; bx < 64; bx += 16) {
        const sums = [0, 0, 0];
        for (let y = by; y < by + 16; y += 1) {
          for (let x = bx; x < bx + 16; x += 1) {
            const p = px(before, x, y);
            for (let c = 0; c < 3; c += 1) sums[c] = (sums[c] ?? 0) + (p[c] ?? 0);
          }
        }
        const expected = [...sums.map((s) => Math.round(s / 256)), 255];
        for (let y = by; y < by + 16; y += 1) {
          for (let x = bx; x < bx + 16; x += 1) expect(px(image, x, y)).toEqual(expected);
        }
      }
    }
  });

  it('counts blocks from the box’s corner and leaves the rest of the image alone', () => {
    const image = noise(64, 64);
    const before = noise(64, 64);
    applyRedact(image, redact([box(5, 7, 37, 39)], { amount: 8 }));
    // Block 5..12 × 7..14 is one colour; the next one starts at x = 13.
    expect(px(image, 12, 14)).toEqual(px(image, 5, 7));
    expect(px(image, 13, 7)).not.toEqual(px(image, 12, 7));
    expect(px(image, 4, 7)).toEqual(px(before, 4, 7));
    expect(px(image, 37, 20)).toEqual(px(before, 37, 20));
    expect(px(image, 20, 39)).toEqual(px(before, 20, 39));
  });
});

describe('blur', () => {
  it('smooths the area and only the area', () => {
    const image = noise(80, 80);
    const before = noise(80, 80);
    applyRedact(image, redact([box(20, 20, 60, 60)], { effect: 'blur', amount: 12 }));
    const spread = (img: typeof image, x0: number) => {
      const values: number[] = [];
      for (let x = x0; x < x0 + 10; x += 1) values.push(px(img, x, 40)[0] ?? 0);
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread(image, 35)).toBeLessThan(spread(before, 35) / 4);
    expect(px(image, 19, 40)).toEqual(px(before, 19, 40));
    expect(px(image, 60, 40)).toEqual(px(before, 60, 40));
  });

  it('keeps a flat colour flat, up to the image’s edges', () => {
    const data = new Uint8ClampedArray(30 * 30 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([200, 100, 50, 255], i);
    const image = { data, width: 30, height: 30 };
    applyRedact(image, redact([box(0, 0, 30, 30)], { effect: 'blur', amount: 20 }));
    expect(px(image, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(px(image, 15, 29)).toEqual([200, 100, 50, 255]);
  });
});

describe('solid and shapes', () => {
  it('fills an ellipse with the colour, not the corners of its box', () => {
    const image = noise(40, 40);
    const before = noise(40, 40);
    applyRedact(
      image,
      redact([{ ...box(0, 0, 40, 40), shape: 'ellipse' }], { effect: 'solid', color: '#ff0080' }),
    );
    expect(px(image, 20, 20)).toEqual([255, 0, 128, 255]);
    expect(px(image, 1, 1)).toEqual(px(before, 1, 1));
    expect(px(image, 38, 38)).toEqual(px(before, 38, 38));
  });

  it('brushes a round-ended stroke of the brush’s width', () => {
    const area: Redaction = {
      shape: 'brush',
      points: [
        [10, 10],
        [50, 10],
      ],
      size: 6,
    };
    const at = areaBox(area, 100, 100);
    expect(at).toEqual({ x: 7, y: 7, width: 46, height: 6 });
    if (!at) return;
    const mask = areaMask(area, at);
    const covered = (x: number, y: number) => mask[(y - at.y) * at.width + (x - at.x)];
    expect(covered(30, 10)).toBe(1);
    expect(covered(30, 7)).toBe(1);
    // The round end: the box's corner is outside it.
    expect(covered(7, 7)).toBe(0);
    expect(areaBox({ ...area, points: [] }, 100, 100)).toBeNull();
  });

  it('skips faces turned off, and scales areas to a smaller copy', () => {
    const image = noise(40, 40);
    const before = noise(40, 40);
    const count = applyRedact(
      image,
      redact([{ ...box(0, 0, 20, 20), face: 0.9, off: true }, box(40, 40, 80, 80)], {
        effect: 'solid',
      }),
      0.5,
    );
    expect(count).toBe(1);
    expect(px(image, 5, 5)).toEqual(px(before, 5, 5));
    expect(px(image, 19, 19)).toEqual(px(before, 19, 19));
    expect(px(image, 20, 20)).toEqual([0, 0, 0, 255]);
    expect(px(image, 39, 39)).toEqual([0, 0, 0, 255]);
  });
});

describe('sizes', () => {
  it('starts at about 60 blocks across, and the slider goes to an eighth', () => {
    expect(defaultAmount({ width: 4000, height: 3000 })).toBe(67);
    expect(defaultAmount({ width: 200, height: 100 })).toBe(6);
    expect(maxAmount({ width: 4000, height: 3000 })).toBe(500);
    expect(maxAmount({ width: 100, height: 100 })).toBe(24);
  });

  it('grows a face’s box to cover the head, inside the image', () => {
    const area = faceArea(
      { x: 100, y: 100, width: 100, height: 120, score: 0.93 },
      { x: 0, y: 0, width: 210, height: 1000 },
    );
    expect(area).toEqual({
      shape: 'ellipse',
      points: [
        [85, 64],
        [210, 232],
      ],
      face: 0.93,
    });
  });
});
