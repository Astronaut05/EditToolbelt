import { describe, expect, it } from 'vitest';

import { parseColor, toHex, type Rgb } from './color';
import { contrastRatio, nearestPassing, passes, ratioLabel, THRESHOLDS } from './contrast';

const rgb = (input: string): Rgb => {
  const parsed = parseColor(input);
  if (!parsed.ok) throw new Error(input);
  return parsed.rgb;
};

describe('contrast ratio', () => {
  it('matches the published ratios', () => {
    expect(contrastRatio(rgb('#000'), rgb('#fff'))).toBeCloseTo(21, 6);
    expect(contrastRatio(rgb('#fff'), rgb('#000'))).toBeCloseTo(21, 6);
    expect(contrastRatio(rgb('#777'), rgb('#777'))).toBe(1);
    // The well-known edge: #767676 is the lightest grey that passes AA on white.
    expect(ratioLabel(contrastRatio(rgb('#767676'), rgb('#fff')))).toBe('4.54:1');
    expect(ratioLabel(contrastRatio(rgb('#777777'), rgb('#fff')))).toBe('4.47:1');
    expect(ratioLabel(contrastRatio(rgb('#0000ff'), rgb('#fff')))).toBe('8.59:1');
    expect(ratioLabel(contrastRatio(rgb('#ff0000'), rgb('#fff')))).toBe('3.99:1');
  });

  it('never rounds a fail up to the threshold', () => {
    // #777 on white is 4.4776…; a pair at 4.4999 must not read 4.50.
    expect(ratioLabel(4.4999)).toBe('4.49:1');
    expect(passes(4.4999).aaNormal).toBe(false);
    expect(passes(4.5).aaNormal).toBe(true);
  });

  it('flattens transparency: text over the background, the background over white', () => {
    // Half-transparent black on white is the same as #808080-ish grey on white.
    const half = contrastRatio(rgb('rgba(0, 0, 0, 0.5)'), rgb('#fff'));
    expect(half).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, rgb('#fff')), 6);
    // A fully transparent background reads as white.
    expect(contrastRatio(rgb('#000'), rgb('rgba(0, 0, 0, 0)'))).toBeCloseTo(21, 6);
  });

  it('says what each level needs', () => {
    expect(passes(5)).toEqual({
      aaNormal: true,
      aaLarge: true,
      aaaNormal: false,
      aaaLarge: true,
      nonText: true,
    });
    expect(THRESHOLDS.aaaNormal).toBe(7);
  });
});

describe('nearest passing colour', () => {
  it('moves the text just far enough, keeping its hue', () => {
    const found = nearestPassing(rgb('#777777'), rgb('#ffffff'), 4.5, 'text');
    expect(found).not.toBeNull();
    expect(found?.ratio).toBeGreaterThanOrEqual(4.5);
    expect(toHex(found?.rgb ?? rgb('#000'))).toBe('#767676');
  });

  it('works for coloured text and for the background', () => {
    const text = nearestPassing(rgb('#ff6347'), rgb('#ffffff'), 4.5, 'text');
    expect(text?.ratio).toBeGreaterThanOrEqual(4.5);
    const lch = (value: Rgb) => {
      const [r, g, b] = [value.r, value.g, value.b];
      return Math.atan2(b - g, r - g);
    };
    expect(Math.abs(lch(text?.rgb ?? rgb('#000')) - lch(rgb('#ff6347')))).toBeLessThan(0.5);

    const background = nearestPassing(rgb('#3366cc'), rgb('#ffffff'), 7, 'background');
    expect(background?.ratio).toBeGreaterThanOrEqual(7);
  });

  it('answers the colour itself when it already passes, and null when nothing can', () => {
    expect(nearestPassing(rgb('#000'), rgb('#fff'), 4.5, 'text')?.distance).toBe(0);
    // Against mid grey nothing reaches 21:1.
    expect(nearestPassing(rgb('#808080'), rgb('#777777'), 21, 'text')).toBeNull();
  });

  it('always lands on a passing 8-bit colour', () => {
    for (const [text, background] of [
      ['#999999', '#ffffff'],
      ['#2e8b57', '#f0f0f0'],
      ['#ffcc00', '#ffffff'],
      ['#6a5acd', '#1e1e1e'],
      ['#ff69b4', '#ffe4e1'],
    ] as const) {
      for (const target of [3, 4.5, 7]) {
        const found = nearestPassing(rgb(text), rgb(background), target, 'text');
        if (!found) continue;
        expect(contrastRatio(found.rgb, rgb(background))).toBeGreaterThanOrEqual(target);
        expect(Number.isInteger(found.rgb.r)).toBe(true);
      }
    }
  });
});
