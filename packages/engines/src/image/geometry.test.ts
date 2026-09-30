import { describe, expect, it } from 'vitest';

import {
  applyGeometry,
  centredRatio,
  clampRect,
  cropPixels,
  flipHorizontal,
  GeometryError,
  padPixels,
  planResize,
  resample,
  rotateQuarter,
  type Filter,
  type Pixels,
} from './geometry';
import { geometryJob, ratioValue, resizeSpec } from './image-geometry';

/** An image whose every pixel is a function of its position. */
function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return { data, width, height };
}

const at = (img: Pixels, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** Each pixel tagged with its own coordinates. */
const tagged = (width: number, height: number) => image(width, height, (x, y) => [x, y, 100, 255]);

describe('lossless geometry', () => {
  it('rotates by quarter turns, pixel for pixel', () => {
    const src = tagged(3, 2);
    const once = rotateQuarter(src, 1);
    expect([once.width, once.height]).toEqual([2, 3]);
    // Clockwise: the bottom-left pixel becomes the top-left one.
    expect(at(once, 0, 0)).toEqual([0, 1, 100, 255]);
    expect(at(once, 1, 0)).toEqual([0, 0, 100, 255]);
    expect(at(once, 0, 2)).toEqual([2, 1, 100, 255]);
    expect(rotateQuarter(rotateQuarter(src, 2), 2).data).toEqual(src.data);
    expect(rotateQuarter(src, 4)).toBe(src);
    expect(rotateQuarter(rotateQuarter(src, 3), 1).data).toEqual(src.data);
  });

  it('flips left to right exactly', () => {
    const src = tagged(4, 2);
    const flipped = flipHorizontal(src);
    expect(at(flipped, 0, 1)).toEqual([3, 1, 100, 255]);
    expect(flipHorizontal(flipped).data).toEqual(src.data);
  });

  it('crops pixel for pixel and keeps rectangles inside the image', () => {
    const src = tagged(10, 8);
    const out = cropPixels(src, { x: 2, y: 3, width: 4, height: 2 });
    expect([out.width, out.height]).toEqual([4, 2]);
    expect(at(out, 0, 0)).toEqual([2, 3, 100, 255]);
    expect(at(out, 3, 1)).toEqual([5, 4, 100, 255]);
    expect(clampRect({ x: -5, y: 6.4, width: 50, height: 9 }, src)).toEqual({
      x: 0,
      y: 6,
      width: 10,
      height: 2,
    });
  });

  it('crops 4000 × 3000 to 1:1 centred as 3000 × 3000', () => {
    expect(centredRatio({ width: 4000, height: 3000 }, 1)).toEqual({
      x: 500,
      y: 0,
      width: 3000,
      height: 3000,
    });
    expect(centredRatio({ width: 4000, height: 3000 }, 9 / 16)).toEqual({
      x: 1156,
      y: 0,
      width: 1688,
      height: 3000,
    });
  });

  it('keeps transparency when cropping', () => {
    const src = image(4, 4, (x) => (x < 2 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
    const { image: out } = applyGeometry(src, { crop: { x: 1, y: 0, width: 2, height: 4 } });
    expect(at(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(out, 1, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('resample', () => {
  const filters: Filter[] = ['lanczos', 'bicubic', 'bilinear', 'nearest'];

  it.each(filters)('%s keeps a flat colour flat, down and up', (filter) => {
    const flat = image(37, 23, () => [200, 120, 40, 255]);
    for (const [w, h] of [
      [10, 7],
      [80, 51],
    ] as const) {
      const out = resample(flat, w, h, filter);
      expect([out.width, out.height]).toEqual([w, h]);
      for (let i = 0; i < out.data.length; i += 4)
        expect(Array.from(out.data.subarray(i, i + 4))).toEqual([200, 120, 40, 255]);
    }
  });

  it('returns the same pixels at the same size', () => {
    const src = tagged(5, 5);
    expect(resample(src, 5, 5, 'lanczos')).toBe(src);
  });

  it('averages when halving', () => {
    const checker = image(4, 4, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const out = resample(checker, 2, 2, 'bilinear');
    for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBeCloseTo(128, -1);
  });

  it('repeats pixels exactly with nearest', () => {
    const src = tagged(2, 2);
    const out = resample(src, 4, 4, 'nearest');
    expect(at(out, 1, 1)).toEqual([0, 0, 100, 255]);
    expect(at(out, 2, 3)).toEqual([1, 1, 100, 255]);
  });

  it('leaves no dark fringe next to transparency', () => {
    // Opaque red on the right, fully transparent black on the left.
    const src = image(16, 4, (x) => (x < 8 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
    const out = resample(src, 8, 2, 'lanczos');
    for (let x = 0; x < 8; x += 1) {
      const [r, g, b, a] = at(out, x, 0);
      if ((a ?? 0) > 8) expect([r, g, b]).toEqual([255, 0, 0]);
    }
    expect(at(out, 0, 0)[3]).toBe(0);
    expect(at(out, 7, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('planResize', () => {
  const photo = { width: 4000, height: 3000 };

  it('gives exact sizes for each mode', () => {
    expect(planResize(photo, { by: 'width', width: 1920 }).output).toEqual({
      width: 1920,
      height: 1440,
    });
    expect(planResize(photo, { by: 'height', height: 1080 }).output).toEqual({
      width: 1440,
      height: 1080,
    });
    expect(planResize(photo, { by: 'percent', percent: 25 }).output).toEqual({
      width: 1000,
      height: 750,
    });
    expect(planResize(photo, { by: 'longest', longest: 2048 }).output).toEqual({
      width: 2048,
      height: 1536,
    });
    const box = { by: 'box', width: 1920, height: 1080 } as const;
    expect(planResize(photo, { ...box, fit: 'keep' }).output).toEqual({
      width: 1440,
      height: 1080,
    });
    expect(planResize(photo, { ...box, fit: 'stretch' }).output).toEqual({
      width: 1920,
      height: 1080,
    });
    const fill = planResize(photo, { ...box, fit: 'fill' });
    expect(fill.crop).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
    expect(fill.output).toEqual({ width: 1920, height: 1080 });
    const pad = planResize(photo, { ...box, fit: 'pad' });
    expect(pad.scaled).toEqual({ width: 1440, height: 1080 });
    expect(pad.canvas).toEqual({ width: 1920, height: 1080, x: 240, y: 0 });
  });

  it('brings a batch of mixed sizes to a longest side of 2048', () => {
    const sizes = [
      [4000, 3000],
      [3000, 4000],
      [6000, 4000],
      [1024, 768],
      [800, 1200],
      [2048, 2048],
      [5472, 3648],
      [3024, 4032],
      [640, 480],
      [7952, 5304],
    ];
    for (const [width = 1, height = 1] of sizes) {
      const { output } = planResize({ width, height }, { by: 'longest', longest: 2048 });
      expect(Math.max(output.width, output.height)).toBe(2048);
      expect(Math.abs(output.width / output.height - width / height)).toBeLessThan(0.002);
    }
  });

  it('refuses sizes the browser cannot make, and missing numbers', () => {
    expect(() => planResize(photo, { by: 'percent', percent: 1000 })).toThrow(/100 MP/);
    expect(() => planResize(photo, { by: 'width' })).toThrow(GeometryError);
  });
});

describe('applyGeometry', () => {
  it('pads with the chosen colour', () => {
    const src = image(40, 30, () => [10, 20, 30, 255]);
    const { image: out, notes } = applyGeometry(src, {
      resize: { by: 'box', width: 60, height: 60, fit: 'pad', pad: [0, 255, 0, 255] },
    });
    expect([out.width, out.height]).toEqual([60, 60]);
    expect(at(out, 30, 2)).toEqual([0, 255, 0, 255]);
    expect(at(out, 30, 30)).toEqual([10, 20, 30, 255]);
    expect(notes).toContain('Padded to 60 × 60 px');
    expect(notes.some((note) => note.startsWith('Enlarged to 150 %'))).toBe(true);
  });

  it('pads with transparency', () => {
    const out = padPixels(tagged(2, 2), { width: 4, height: 2 }, { x: 1, y: 0 }, [0, 0, 0, 0]);
    expect(at(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(out, 1, 0)).toEqual([0, 0, 100, 255]);
  });

  it('turns, then crops in turned pixels, and says so', () => {
    const src = tagged(30, 20);
    const { image: out, notes } = applyGeometry(src, {
      turns: 1,
      crop: { x: 0, y: 0, width: 20, height: 10 },
    });
    expect([out.width, out.height]).toEqual([20, 10]);
    expect(at(out, 0, 0)).toEqual([0, 19, 100, 255]);
    expect(notes).toEqual(['Rotated 90° clockwise', 'Cropped to 20 × 10 px']);
  });

  it('crops a batch image to a ratio, centred', () => {
    const { image: out } = applyGeometry(tagged(40, 30), { cropRatio: 1 });
    expect([out.width, out.height]).toEqual([30, 30]);
    expect(at(out, 0, 0)).toEqual([5, 0, 100, 255]);
  });
});

describe('options to a geometry job', () => {
  it('reads ratios', () => {
    expect(ratioValue('free')).toBeNull();
    expect(ratioValue('16:9')).toBeCloseTo(16 / 9);
    expect(ratioValue('custom', '5', '7')).toBeCloseTo(5 / 7);
    expect(ratioValue('custom', '5', '')).toBeNull();
  });

  it('reads resize presets and modes', () => {
    expect(resizeSpec({})).toBeUndefined();
    expect(resizeSpec({ by: 'story-1080x1920', fit: 'fill' })).toMatchObject({
      by: 'box',
      width: 1080,
      height: 1920,
      fit: 'fill',
      filter: 'lanczos',
    });
    expect(resizeSpec({ by: 'longest', longest: '2048', filter: 'nearest' })).toMatchObject({
      by: 'longest',
      longest: 2048,
      filter: 'nearest',
    });
    expect(resizeSpec({ by: 'box', width: '100', height: '50', pad: 'transparent' })?.pad).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('crops one image to its box and a batch to the ratio', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    expect(geometryJob({ crop: box, ratio: '1:1', turns: 1 })).toMatchObject({
      crop: box,
      cropRatio: undefined,
      turns: 1,
    });
    expect(geometryJob({ ratio: '4:5' }).cropRatio).toBeCloseTo(0.8);
    expect(geometryJob({ ratio: 'free' }).cropRatio).toBeUndefined();
  });
});

describe('notes', () => {
  it('says when the box covers the whole image', () => {
    const { notes } = applyGeometry(tagged(4, 3), { crop: { x: 0, y: 0, width: 4, height: 3 } });
    expect(notes).toEqual(['The box covers the whole image, so nothing was cropped']);
  });
});
