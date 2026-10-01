/**
 * WCAG 2.2 contrast (tools/color.md → C04): relative luminance, the ratio,
 * what it passes, and the nearest colour that passes. Shared with the panel.
 *
 * Transparent colours are flattened first: the text over the background, and
 * the background over white (what a page shows behind it by default).
 */
import { oklchToRgb, rgbToOklch, toBytes, toLinear, deltaE, inGamut, type Rgb } from './color';

/** WCAG 2.2: 1.4.3 (AA), 1.4.6 (AAA), 1.4.11 (non-text). Large text is 24 px, or 18.66 px bold. */
export const THRESHOLDS = {
  aaNormal: 4.5,
  aaLarge: 3,
  aaaNormal: 7,
  aaaLarge: 4.5,
  nonText: 3,
} as const;
export type Level = keyof typeof THRESHOLDS;

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };

/** `top` over `bottom`, mixed in sRGB as browsers paint it. */
export function flatten(top: Rgb, bottom: Rgb): Rgb {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance of an opaque sRGB colour, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** The contrast ratio, 1 to 21, of text on a background (alpha flattened as above). */
export function contrastRatio(text: Rgb, background: Rgb): number {
  const bg = background.a < 1 ? flatten(background, WHITE) : background;
  const fg = text.a < 1 ? flatten(text, bg) : text;
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The ratio as people quote it: two decimals, cut, not rounded, so a pair
 * that fails 4.5 never reads "4.50:1".
 */
export function ratioLabel(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

export function passes(ratio: number): Record<Level, boolean> {
  return {
    aaNormal: ratio >= THRESHOLDS.aaNormal,
    aaLarge: ratio >= THRESHOLDS.aaLarge,
    aaaNormal: ratio >= THRESHOLDS.aaaNormal,
    aaaLarge: ratio >= THRESHOLDS.aaaLarge,
    nonText: ratio >= THRESHOLDS.nonText,
  };
}

export interface Suggestion {
  rgb: Rgb;
  ratio: number;
  /** How far it moved, in Oklab ΔE × 100. */
  distance: number;
}

/** `rgb` with its Oklch lightness set to `l`, chroma reduced until it fits sRGB, as bytes. */
function atLightness(rgb: Rgb, l: number): Rgb {
  const lch = rgbToOklch(rgb);
  // Greys stay grey: their hue is only rounding noise.
  let chroma = lch.c < 0.002 ? 0 : lch.c;
  let out = oklchToRgb({ l, c: chroma, h: lch.h }, 1);
  for (let i = 0; i < 24 && !inGamut(out); i += 1) {
    chroma *= 0.85;
    out = oklchToRgb({ l, c: chroma, h: lch.h }, 1);
  }
  return toBytes(out);
}

/**
 * The closest colour to `move` (same hue, lightness changed, chroma kept
 * where sRGB allows) that reaches `target` against `fixed`; null when even
 * black or white doesn't. Searches darker and lighter, and checks the final
 * byte values, so rounding can't push it back under.
 */
export function nearestPassing(
  move: Rgb,
  fixed: Rgb,
  target: number,
  side: 'text' | 'background',
): Suggestion | null {
  const ratio = (candidate: Rgb) =>
    side === 'text' ? contrastRatio(candidate, fixed) : contrastRatio(fixed, candidate);
  const opaque = { ...move, a: 1 };
  if (ratio(opaque) >= target) {
    return { rgb: toBytes(opaque), ratio: ratio(opaque), distance: 0 };
  }
  const start = rgbToOklch(opaque).l;
  const found: Suggestion[] = [];
  for (const end of [0, 1]) {
    if (ratio(atLightness(opaque, end)) < target) continue;
    // Bisect between where it fails (start) and where it passes (end).
    let fail = start;
    let pass = end;
    for (let i = 0; i < 30; i += 1) {
      const mid = (fail + pass) / 2;
      if (ratio(atLightness(opaque, mid)) >= target) pass = mid;
      else fail = mid;
    }
    let candidate = atLightness(opaque, pass);
    // One byte step at a time past any rounding shortfall.
    for (let i = 0; i < 8 && ratio(candidate) < target; i += 1) {
      pass += end === 0 ? -0.004 : 0.004;
      candidate = atLightness(opaque, Math.min(1, Math.max(0, pass)));
    }
    if (ratio(candidate) >= target) {
      found.push({ rgb: candidate, ratio: ratio(candidate), distance: deltaE(opaque, candidate) });
    }
  }
  found.sort((x, y) => x.distance - y.distance);
  return found[0] ?? null;
}
