import { socialPresetsOf } from '@etb/core';
import { describe, expect, it } from 'vitest';

import type { Pixels } from './geometry';
import {
  boxBlur,
  composite,
  enlargement,
  fitPlacement,
  focusCrop,
  focusOf,
  rgbaOf,
  socialFrame,
  solid,
  type FrameSpec,
} from './social';

/** A test image: blue, with a red square whose top-left corner is at (x, y). */
function picture(width: number, height: number, square: { x: number; y: number; side: number }) {
  const image = solid({ width, height }, [0, 0, 255, 255]);
  for (let y = square.y; y < square.y + square.side; y += 1) {
    for (let x = square.x; x < square.x + square.side; x += 1) {
      image.data.set([255, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return image;
}

const pixel = (image: Pixels, x: number, y: number) =>
  Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

const centre = (image: Pixels) =>
  pixel(image, Math.floor(image.width / 2), Math.floor(image.height / 2));

const spec = (overrides: Partial<FrameSpec> = {}): FrameSpec => ({
  fit: 'fill',
  focus: { x: 0.5, y: 0.5 },
  color: [255, 255, 255, 255],
  ...overrides,
});

describe('focusCrop', () => {
  it('takes the largest window of the shape, centred on the focus as far as the edges allow', () => {
    const source = { width: 3000, height: 2000 };
    const square = { width: 1080, height: 1080 };
    expect(focusCrop(source, square, { x: 0.5, y: 0.5 })).toEqual({
      x: 500,
      y: 0,
      width: 2000,
      height: 2000,
    });
    expect(focusCrop(source, square, { x: 0.6, y: 0.5 }).x).toBe(800);
    expect(focusCrop(source, square, { x: 0, y: 0.5 }).x).toBe(0);
    expect(focusCrop(source, square, { x: 0.3, y: 0.5 }).x).toBe(0);
    expect(focusCrop(source, square, { x: 1, y: 0.5 }).x).toBe(1000);
    // A wide window on a tall image moves up and down.
    const tall = focusCrop(
      { width: 2000, height: 3000 },
      { width: 1600, height: 900 },
      {
        x: 0.5,
        y: 0.2,
      },
    );
    expect(tall).toEqual({ x: 0, y: 38, width: 2000, height: 1125 });
  });
});

describe('fitPlacement and enlargement', () => {
  it('fits the whole image, centred', () => {
    expect(fitPlacement({ width: 3000, height: 2000 }, { width: 1080, height: 1920 })).toEqual({
      x: 0,
      y: 600,
      width: 1080,
      height: 720,
    });
  });

  it('says how much a small image is enlarged', () => {
    expect(enlargement({ width: 800, height: 800 }, { width: 1080, height: 1080 }, 'fill')).toBe(
      1.35,
    );
    expect(enlargement({ width: 4000, height: 3000 }, { width: 1080, height: 1350 }, 'fill')).toBe(
      0.45,
    );
    expect(enlargement({ width: 1280, height: 720 }, { width: 2560, height: 1440 }, 'blur')).toBe(
      2,
    );
  });
});

describe('socialFrame', () => {
  const image = picture(300, 200, { x: 10, y: 80, side: 40 });

  it('makes 6 sizes from one image at their exact size, in every fit', () => {
    const six = socialPresetsOf(
      'instagram-portrait,instagram-story,youtube-thumbnail,x-header,linkedin-banner,pinterest-pin',
    );
    expect(six).toHaveLength(6);
    for (const fit of ['fill', 'blur', 'color'] as const) {
      for (const preset of six) {
        // A tenth of the size keeps the test quick; the maths is the same.
        const target = {
          width: Math.round(preset.width / 10),
          height: Math.round(preset.height / 10),
        };
        const frame = socialFrame(image, target, spec({ fit }));
        expect([frame.width, frame.height]).toEqual([target.width, target.height]);
        expect(frame.data.length).toBe(target.width * target.height * 4);
      }
    }
  });

  it('keeps the focal point in frame', () => {
    const target = { width: 100, height: 100 };
    // Centred, the square is cut away; with the focus on it, it's in the middle.
    expect(centre(socialFrame(image, target, spec()))).toEqual([0, 0, 255, 255]);
    const onSquare = socialFrame(image, target, spec({ focus: { x: 30 / 300, y: 100 / 200 } }));
    const [r, g, b] = pixel(onSquare, 15, 50);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(30);
    expect(b).toBeLessThan(30);
  });

  it('fits on a colour: the bands are the colour, the image is whole', () => {
    const frame = socialFrame(
      image,
      { width: 90, height: 160 },
      spec({ fit: 'color', color: rgbaOf('#336699') }),
    );
    expect(pixel(frame, 45, 2)).toEqual([51, 102, 153, 255]);
    expect(pixel(frame, 45, 157)).toEqual([51, 102, 153, 255]);
    expect(centre(frame)).toEqual([0, 0, 255, 255]);
  });

  it('fits on a blur of the image itself', () => {
    const frame = socialFrame(image, { width: 90, height: 160 }, spec({ fit: 'blur' }));
    const [r, g, b, a] = pixel(frame, 45, 2);
    // Mostly the blue of the picture, softened, never the colour option.
    expect(b).toBeGreaterThan(150);
    expect(r).toBeLessThan(120);
    expect(g).toBe(0);
    expect(a).toBe(255);
  });
});

describe('pixel helpers', () => {
  it('blurs without moving the average', () => {
    const image = picture(40, 40, { x: 15, y: 15, side: 10 });
    const blurred = boxBlur(image, 3);
    const red = (p: Pixels) => p.data.reduce((sum, v, i) => (i % 4 === 0 ? sum + v : sum), 0);
    expect(Math.abs(red(blurred) - red(image)) / red(image)).toBeLessThan(0.02);
    expect(pixel(blurred, 20, 20)[0]).toBeLessThan(255);
    expect(pixel(blurred, 14, 20)[0]).toBeGreaterThan(0);
  });

  it('draws over a colour by alpha', () => {
    const base = solid({ width: 2, height: 1 }, [255, 255, 255, 255]);
    const top = solid({ width: 1, height: 1 }, [0, 0, 0, 128]);
    const out = composite(base, top, { x: 1, y: 0 });
    expect(pixel(out, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(out, 1, 0)).toEqual([127, 127, 127, 255]);
  });

  it('reads the focus and colour options', () => {
    expect(focusOf('0.25,0.75')).toEqual({ x: 0.25, y: 0.75 });
    expect(focusOf('2,-1')).toEqual({ x: 1, y: 0 });
    expect(focusOf('nope')).toEqual({ x: 0.5, y: 0.5 });
    expect(focusOf(undefined)).toEqual({ x: 0.5, y: 0.5 });
    expect(rgbaOf('#FFFFFF')).toEqual([255, 255, 255, 255]);
    expect(rgbaOf('red')).toEqual([255, 255, 255, 255]);
  });
});
