import { describe, expect, it } from 'vitest';

import { rgbToOklch, type Rgb } from './color';
import { blend, colorAt, gradientCss, positionAt, renderGradient, type Gradient } from './gradient';

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b, a: 1 });
const RED = rgb(255, 0, 0);
const BLUE = rgb(0, 0, 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(255, 255, 255);

const gradient = (over: Partial<Gradient> = {}): Gradient => ({
  kind: 'linear',
  angle: 90,
  stops: [
    { color: BLACK, at: 0 },
    { color: WHITE, at: 1 },
  ],
  smooth: false,
  ...over,
});

describe('gradientCss', () => {
  it('writes the stops as CSS does', () => {
    expect(gradientCss(gradient())).toBe('linear-gradient(90deg, #000000 0%, #ffffff 100%)');
    expect(gradientCss(gradient({ kind: 'radial' }))).toBe(
      'radial-gradient(circle, #000000 0%, #ffffff 100%)',
    );
    expect(gradientCss(gradient({ kind: 'conic', angle: 45 }))).toBe(
      'conic-gradient(from 45deg, #000000 0%, #ffffff 100%)',
    );
  });

  it('sorts the stops, and smooth carries the Oklch blend as a stop every 10 %', () => {
    const css = gradientCss(
      gradient({
        smooth: true,
        stops: [
          { color: BLUE, at: 1 },
          { color: RED, at: 0 },
        ],
      }),
    );
    const stops = css.match(/#[0-9a-f]{6} [\d.]+%/g) ?? [];
    expect(stops).toHaveLength(11);
    expect(stops[0]).toBe('#ff0000 0%');
    expect(stops[5]?.endsWith(' 50%')).toBe(true);
    expect(stops[10]).toBe('#0000ff 100%');
  });
});

describe('blend', () => {
  it('in sRGB, red to blue goes through a dull purple', () => {
    expect(blend(RED, BLUE, 0.5, false)).toMatchObject({ r: 127.5, g: 0, b: 127.5 });
  });

  it('smooth keeps the middle as vivid as the ends, and lighter', () => {
    const plain = rgbToOklch(blend(RED, BLUE, 0.5, false));
    const smooth = rgbToOklch(blend(RED, BLUE, 0.5, true));
    // Oklch chroma 0.25 against 0.19 for the sRGB mix.
    expect(smooth.c).toBeGreaterThan(plain.c * 1.2);
    expect(smooth.l).toBeGreaterThan(plain.l);
  });

  it('smooth from grey keeps the other colour’s hue', () => {
    const mid = rgbToOklch(blend(WHITE, BLUE, 0.5, true));
    expect(Math.abs(mid.h - rgbToOklch(BLUE).h)).toBeLessThan(2);
  });
});

describe('layout', () => {
  it('places linear stops along the line through the centre, as CSS does', () => {
    expect(positionAt('linear', 90, 200, 100, 0, 50)).toBeCloseTo(0);
    expect(positionAt('linear', 90, 200, 100, 200, 50)).toBeCloseTo(1);
    // 0deg points up: the bottom edge is the start.
    expect(positionAt('linear', 0, 200, 100, 100, 100)).toBeCloseTo(0);
    // 45deg on a rectangle reaches exactly the corners.
    expect(positionAt('linear', 45, 200, 100, 0, 100)).toBeCloseTo(0);
    expect(positionAt('linear', 45, 200, 100, 200, 0)).toBeCloseTo(1);
  });

  it('radial reaches the farthest corner; conic turns clockwise from its angle', () => {
    expect(positionAt('radial', 0, 200, 100, 100, 50)).toBeCloseTo(0);
    expect(positionAt('radial', 0, 200, 100, 200, 100)).toBeCloseTo(1);
    expect(positionAt('conic', 0, 100, 100, 100, 50)).toBeCloseTo(0.25);
    expect(positionAt('conic', 90, 100, 100, 100, 50)).toBeCloseTo(0);
  });

  it('holds the end colours past the first and last stop', () => {
    const stops = [
      { color: RED, at: 0.25 },
      { color: BLUE, at: 0.75 },
    ];
    expect(colorAt(stops, 0.1, false)).toEqual(RED);
    expect(colorAt(stops, 0.9, false)).toEqual(BLUE);
  });
});

describe('renderGradient', () => {
  it('draws black to white across, each pixel within one step of its place', () => {
    const px = renderGradient(gradient(), 256, 2);
    for (let x = 0; x < 256; x += 1) {
      const want = ((x + 0.5) / 256) * 255;
      expect(Math.abs((px[x * 4] ?? 0) - want)).toBeLessThanOrEqual(1);
      expect(px[x * 4 + 3]).toBe(255);
    }
  });

  it('dithers without shifting the average', () => {
    const px = renderGradient(
      gradient({
        stops: [
          { color: rgb(100.5, 0, 0), at: 0 },
          { color: rgb(100.5, 0, 0), at: 1 },
        ],
      }),
      8,
      8,
    );
    let sum = 0;
    for (let i = 0; i < 64; i += 1) sum += px[i * 4] ?? 0;
    expect(sum / 64).toBeCloseTo(100.5, 1);
  });
});
