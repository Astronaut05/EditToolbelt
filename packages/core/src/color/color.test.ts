import { describe, expect, it } from 'vitest';

import {
  formats,
  hslToRgb,
  mix,
  nearestName,
  parseColor,
  rgbToHsl,
  rgbToLab,
  rgbToOklch,
  tintsAndShades,
  toHex,
  type Rgb,
} from './color';
import { CSS_NAMED_COLORS } from './names';

const rgb = (r: number, g: number, b: number, a = 1): Rgb => ({ r, g, b, a });

function parsed(input: string): Rgb {
  const result = parseColor(input);
  if (!result.ok) throw new Error(`${input}: ${result.error}`);
  return result.rgb;
}

const FIXTURES = [
  '#000000',
  '#ffffff',
  '#ff6347',
  '#1e90ff',
  '#7fffd4',
  '#808080',
  '#663399',
  '#c0ffee',
  '#bada55',
  '#010203',
  '#fefdfc',
  '#123456',
];

describe('round trips (tools/color.md → C03 tests)', () => {
  it('HEX → RGB → HSL → HEX is exact for the fixture list', () => {
    for (const hex of FIXTURES) {
      expect(toHex(hslToRgb(rgbToHsl(parsed(hex))))).toBe(hex);
    }
  });

  it('every printed notation reads back to the same hex', () => {
    const samples = [...FIXTURES, ...Object.values(CSS_NAMED_COLORS)];
    // Plus a spread of 4,096 colours across the cube.
    for (let i = 0; i < 4096; i += 1) {
      const r = (i * 37) % 256;
      const g = (i * 101) % 256;
      const b = (i * 211) % 256;
      samples.push(toHex(rgb(r, g, b)));
    }
    for (const hex of samples) {
      const all = formats(parsed(hex));
      for (const [format, text] of Object.entries(all) as [keyof typeof all, string][]) {
        if (format === 'cmyk') continue; // whole percentages: a 1-unit difference is expected
        const back = parsed(text);
        if (format === 'lab' || format === 'oklch') {
          // Printed to 2-4 decimals: within one 8-bit step per channel.
          const original = parsed(hex);
          for (const channel of ['r', 'g', 'b'] as const) {
            expect(
              Math.abs(back[channel] - original[channel]),
              `${hex} via ${text}`,
            ).toBeLessThanOrEqual(1);
          }
        } else {
          expect(toHex(back), `${hex} via ${text}`).toBe(hex);
        }
      }
    }
  });
});

describe('parseColor', () => {
  it('reads the ways people paste colours', () => {
    const tomato = '#ff6347';
    for (const input of [
      '#ff6347',
      'FF6347',
      'tomato',
      'Tomato',
      'rgb(255, 99, 71)',
      'rgb(255 99 71)',
      'rgba(255,99,71,1)',
      'hsla(9.1, 100%, 63.9%, 1)',
      '255, 99, 71',
      'hsl(9.1, 100%, 63.9%)',
      'hsl(9.1deg 100% 63.9%)',
      'hsv(9.1, 72.2%, 100%)',
      'color: #ff6347;'.replace('color: ', ''),
    ]) {
      expect(toHex(parsed(input)), input).toBe(tomato);
    }
    expect(toHex(parsed('#f64'))).toBe('#ff6644');
  });

  it('keeps alpha', () => {
    expect(parsed('rgb(255 99 71 / 50%)').a).toBeCloseTo(0.5);
    expect(toHex(parsed('#ff634780'))).toBe('#ff634780');
    expect(formats(parsed('#ff634780')).rgb).toBe('rgba(255, 99, 71, 0.502)');
  });

  it('flags colours outside sRGB and clips them', () => {
    const result = parseColor('oklch(90% 0.4 150)');
    expect(result.ok && result.clipped).toBe(true);
  });

  it('explains what is wrong', () => {
    expect(parseColor('')).toMatchObject({ ok: false });
    const outOfRange = parseColor('rgb(300, 0, 0)');
    expect(outOfRange.ok ? '' : outOfRange.error).toMatch(/0 to 255/);
    expect(parseColor('hsl(10, 20%)')).toMatchObject({ ok: false });
    expect(parseColor('not a colour')).toMatchObject({ ok: false });
  });
});

describe('reference values', () => {
  it('Lab (D50) matches CSS Color 4', () => {
    // White is L 100, a 0, b 0; sRGB red is lab(54.29 80.8 69.89) in CSS Color 4.
    const white = rgbToLab(rgb(255, 255, 255));
    expect(white.l).toBeCloseTo(100, 2);
    expect(white.a).toBeCloseTo(0, 2);
    const red = rgbToLab(rgb(255, 0, 0));
    expect(red.l).toBeCloseTo(54.29, 1);
    expect(red.a).toBeCloseTo(80.8, 0);
    expect(red.b).toBeCloseTo(69.89, 0);
  });

  it('Oklch matches CSS Color 4', () => {
    // sRGB red is oklch(62.8% 0.2577 29.23).
    const red = rgbToOklch(rgb(255, 0, 0));
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    expect(rgbToOklch(rgb(128, 128, 128)).h).toBe(0);
  });

  it('prints CSS syntax', () => {
    const { lab, oklch, ...rest } = formats(parsed('#ff6347'));
    expect(rest).toEqual({
      hex: '#ff6347',
      rgb: 'rgb(255, 99, 71)',
      hsl: 'hsl(9.1, 100%, 63.9%)',
      hsv: 'hsv(9.1, 72.2%, 100%)',
      cmyk: 'cmyk(0%, 61%, 72%, 0%)',
    });
    expect(lab).toMatch(/^lab\(62\.\d+ 5\d\.\d+ 4\d\.\d+\)$/);
    expect(oklch).toMatch(/^oklch\(69\.\d+% 0\.19\d* 3\d\.\d+\)$/);
  });
});

describe('names and mixing', () => {
  it('finds exact and nearest CSS names', () => {
    expect(nearestName(parsed('#ff6347'))).toEqual({ name: 'tomato', distance: 0 });
    const near = nearestName(parsed('#ff6348'));
    expect(near.name).toBe('tomato');
    expect(near.distance).toBeGreaterThan(0);
  });

  it('mixes in linear light', () => {
    // Half black, half white in linear light is 50 % luminance: #bcbcbc, not #808080.
    expect(toHex(mix(rgb(0, 0, 0), rgb(255, 255, 255), 0.5))).toBe('#bcbcbc');
    const { tints, shades } = tintsAndShades(parsed('#1e90ff'));
    expect(tints).toHaveLength(4);
    expect(shades).toHaveLength(4);
    expect(tints[0]?.r).toBeGreaterThan(tints[3]?.r ?? 255);
    expect(shades[3]?.b).toBeLessThan(shades[0]?.b ?? 0);
  });
});
