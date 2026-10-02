import { describe, expect, it } from 'vitest';

import { otsu, toSvg, vectorize, type TraceOptions } from './vectorize';

type Rgba = [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const RED: Rgba = [220, 30, 30, 255];
const BLUE: Rgba = [20, 60, 200, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

function image(width: number, height: number, at: (x: number, y: number) => Rgba) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set(at(x, y), (y * width + x) * 4);
  }
  return rgba;
}

const EXACT: TraceOptions = {
  mode: 'color',
  colors: 4,
  minArea: 1,
  tolerance: 0,
  cornerAngle: 0,
  exact: true,
};
const SMOOTH: TraceOptions = {
  mode: 'color',
  colors: 4,
  minArea: 1,
  tolerance: 1,
  cornerAngle: 60,
};

/** The area a path fills, counting only the ends of each line or curve (y down: outlines run anticlockwise). */
function area(d: string): number {
  let total = 0;
  for (const ring of d.split('Z').filter(Boolean)) {
    const numbers = ring.match(/-?[\d.]+/g)?.map(Number) ?? [];
    const points: [number, number][] = [];
    let i = 0;
    for (const command of ring.match(/[MLC]/g) ?? []) {
      if (command === 'C') i += 4;
      points.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
      i += 2;
    }
    for (let j = 0; j < points.length; j += 1) {
      const [x1, y1] = points[j] ?? [0, 0];
      const [x2, y2] = points[(j + 1) % points.length] ?? [0, 0];
      total += x1 * y2 - x2 * y1;
    }
  }
  return -total / 2;
}

describe('otsu', () => {
  it('splits two groups between them', () => {
    const histogram = new Array<number>(256).fill(0);
    histogram[40] = 500;
    histogram[200] = 300;
    const t = otsu(histogram);
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThanOrEqual(200);
  });
});

describe('vectorize', () => {
  it('traces a square on a background exactly', () => {
    const traced = vectorize(
      image(10, 10, (x, y) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? BLACK : WHITE)),
      10,
      10,
      EXACT,
    );
    expect(traced.layers.map((l) => [l.hex, l.pixels])).toEqual([
      ['#ffffff', 84],
      ['#000000', 16],
    ]);
    // The bottom layer covers the whole image, the square drawn on top.
    expect(area(traced.layers[0]?.d ?? '')).toBe(100);
    expect(traced.layers[1]?.d).toMatch(/^M\d \d(L\d \d){4}Z$/);
    expect(area(traced.layers[1]?.d ?? '')).toBe(16);
  });

  it('stacks the layers: each covers its own pixels and every layer above it, nothing more', () => {
    // Noise in three colours with transparent pixels: junctions, saddles and holes everywhere.
    let seed = 11;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const colours = [WHITE, RED, BLUE, CLEAR];
    const rgba = image(37, 23, (x, y) =>
      x < 12 && y < 8 ? RED : (colours[Math.floor(rand() * 4)] ?? WHITE),
    );
    const traced = vectorize(rgba, 37, 23, EXACT);
    expect(traced.layers).toHaveLength(3);
    traced.layers.forEach((layer, i) => {
      const covered = traced.layers.slice(i).reduce((n, l) => n + l.pixels, 0);
      expect(area(layer.d)).toBe(covered);
    });
    const opaque = traced.layers.reduce((n, l) => n + l.pixels, 0);
    let expected = 0;
    for (let p = 3; p < rgba.length; p += 4) if ((rgba[p] ?? 0) >= 128) expected += 1;
    expect(opaque).toBe(expected);
  });

  it('merges regions smaller than the detail setting into their neighbour', () => {
    const specks = new Set(['2,2', '15,3', '4,16']);
    const traced = vectorize(
      image(20, 20, (x, y) =>
        specks.has(`${String(x)},${String(y)}`) || (x >= 10 && x < 15 && y >= 10 && y < 15)
          ? BLACK
          : WHITE,
      ),
      20,
      20,
      { ...EXACT, minArea: 4 },
    );
    expect(traced.layers.find((l) => l.hex === '#000000')?.pixels).toBe(25);
  });

  it('merges a sliver of a second shade into that shade, not the colour beside it', () => {
    // Three px of a lighter grey inside the blue half: more border with the blue, nearer the grey.
    const sliver = (x: number, y: number) => x === 10 && y >= 3 && y <= 5;
    const traced = vectorize(
      image(20, 10, (x, y) =>
        sliver(x, y) ? [140, 140, 140, 255] : x < 10 ? [128, 128, 128, 255] : BLUE,
      ),
      20,
      10,
      { ...EXACT, colors: 3, minArea: 4 },
    );
    expect(traced.layers.map((l) => l.pixels).sort((a, b) => a - b)).toEqual([97, 103]);
  });

  it('folds an anti-aliased rim into the shape and the background, not a ring of its own', () => {
    // A red disc on white, its edge pixels blended by coverage (4 × 4 samples a pixel).
    const r = 30;
    const traced = vectorize(
      image(80, 80, (x, y) => {
        let inside = 0;
        for (let i = 0; i < 16; i += 1) {
          const sx = x + ((i % 4) + 0.5) / 4;
          const sy = y + (Math.floor(i / 4) + 0.5) / 4;
          if (Math.hypot(sx - 40, sy - 40) <= r) inside += 1;
        }
        const k = inside / 16;
        return [
          Math.round(255 + (220 - 255) * k),
          Math.round(255 + (30 - 255) * k),
          Math.round(255 + (30 - 255) * k),
          255,
        ];
      }),
      80,
      80,
      { ...SMOOTH, colors: 6 },
    );
    expect(traced.layers).toHaveLength(2);
    const disc = traced.layers[1]?.pixels ?? 0;
    expect(Math.abs(disc - Math.PI * r * r)).toBeLessThan(Math.PI * r * r * 0.02);
  });

  it('leaves transparent pixels out', () => {
    const traced = vectorize(
      image(16, 8, (x) => (x < 6 ? CLEAR : RED)),
      16,
      8,
      EXACT,
    );
    expect(traced.layers).toHaveLength(1);
    expect(area(traced.layers[0]?.d ?? '')).toBe(80);
  });

  it('black and white: only the black shapes, the white left transparent', () => {
    const traced = vectorize(
      image(12, 12, (x, y) => (x + y < 8 ? [30, 30, 30, 255] : [240, 240, 240, 255])),
      12,
      12,
      { ...EXACT, mode: 'bw' },
    );
    expect(traced.layers.map((l) => l.hex)).toEqual(['#000000']);
    expect(area(traced.layers[0]?.d ?? '')).toBe(36);
  });

  it('turns a disc into a few smooth curves of the same area', () => {
    const traced = vectorize(
      image(64, 64, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 20 ? BLACK : WHITE)),
      64,
      64,
      { ...SMOOTH, mode: 'bw' },
    );
    const d = traced.layers[0]?.d ?? '';
    expect(d).toContain('C');
    expect((d.match(/[LC]/g) ?? []).length).toBeLessThan(40);
    expect(area(d)).toBeGreaterThan(Math.PI * 400 * 0.97);
    expect(area(d)).toBeLessThan(Math.PI * 400 * 1.03);
  });

  it('keeps a square’s corners square and its sides straight', () => {
    const traced = vectorize(
      image(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? BLACK : WHITE)),
      40,
      40,
      { ...SMOOTH, mode: 'bw' },
    );
    const d = traced.layers[0]?.d ?? '';
    expect(d).not.toContain('C');
    expect(d).toMatch(/^M10 10(L(10|30) (10|30)){4}Z$/);
  });
});

describe('toSvg', () => {
  it('writes only paths, at the size asked', () => {
    const traced = vectorize(
      image(4, 4, (x) => (x < 2 ? RED : BLUE)),
      4,
      4,
      EXACT,
    );
    const svg = toSvg(traced, 400, 400);
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="400" viewBox="0 0 4 4">/,
    );
    expect(svg.match(/<(\w+)/g)).toEqual(['<svg', '<path', '<path']);
  });
});
