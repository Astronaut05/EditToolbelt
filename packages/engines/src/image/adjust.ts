/**
 * P01 Photo Editor's adjustments (tools/photo.md): exposure, brightness,
 * contrast, saturation and warmth, as pure code on RGBA pixels. The editor
 * runs it on its screen-sized copy for the live preview and the image worker
 * on the full-size image, so the saved photo matches what was on screen.
 *
 * Per channel, through one 256-entry table each: exposure and warmth as
 * gains in linear light, then brightness (a midtone curve that keeps black
 * and white) and contrast (around middle grey) on the sRGB value. Then
 * saturation, mixed with the pixel's luma.
 */

export interface Adjust {
  /** Stops, −2 to 2. */
  exposure: number;
  /** −100 to 100: midtones lighter or darker; black and white stay. */
  brightness: number;
  /** −100 to 100: ¼× to 4× the slope around middle grey. */
  contrast: number;
  /** −100 (grey) to 100 (twice as vivid). */
  saturation: number;
  /** −100 (cooler, bluer) to 100 (warmer, more orange). */
  warmth: number;
}

export const NO_ADJUST: Adjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

export const ADJUST_RANGES: Record<keyof Adjust, { min: number; max: number; step: number }> = {
  exposure: { min: -2, max: 2, step: 0.1 },
  brightness: { min: -100, max: 100, step: 1 },
  contrast: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
  warmth: { min: -100, max: 100, step: 1 },
};

export const isNeutral = (adjust: Adjust | undefined) =>
  !adjust || (Object.keys(NO_ADJUST) as (keyof Adjust)[]).every((key) => adjust[key] === 0);

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Warmth's gains: up to 15 % more red and less blue (or the reverse), green a third of that. */
function warmthGains(warmth: number): [number, number, number] {
  const w = (Math.min(100, Math.max(-100, warmth)) / 100) * 0.15;
  return [1 + w, 1 + w / 3, 1 - w];
}

/** The three per-channel tables, 0-255 in, 0-1 out (before saturation). */
export function adjustTables(adjust: Adjust): [Float32Array, Float32Array, Float32Array] {
  const exposure = 2 ** Math.min(2, Math.max(-2, adjust.exposure));
  const gamma = 2 ** (-Math.min(100, Math.max(-100, adjust.brightness)) / 100);
  const slope = 2 ** (Math.min(100, Math.max(-100, adjust.contrast)) / 50);
  return warmthGains(adjust.warmth).map((gain) => {
    const table = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let v = toSrgb(clamp01(toLinear(i / 255) * exposure * gain));
      v = v ** gamma;
      v = clamp01((v - 0.5) * slope + 0.5);
      table[i] = v;
    }
    return table;
  }) as [Float32Array, Float32Array, Float32Array];
}

/** Applies the adjustments to RGBA pixels in place; alpha is kept. */
export function applyAdjust(data: Uint8ClampedArray, adjust: Adjust): void {
  if (isNeutral(adjust)) return;
  const [tr, tg, tb] = adjustTables(adjust);
  const mix = 1 + Math.min(100, Math.max(-100, adjust.saturation)) / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = tr[data[i] ?? 0] ?? 0;
    const g = tg[data[i + 1] ?? 0] ?? 0;
    const b = tb[data[i + 2] ?? 0] ?? 0;
    // Rec. 709 luma of the gamma-encoded values, as most editors use.
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = (luma + (r - luma) * mix) * 255;
    data[i + 1] = (luma + (g - luma) * mix) * 255;
    data[i + 2] = (luma + (b - luma) * mix) * 255;
  }
}

const ADJUST_LABELS: Record<keyof Adjust, string> = {
  exposure: 'exposure',
  brightness: 'brightness',
  contrast: 'contrast',
  saturation: 'saturation',
  warmth: 'warmth',
};

/** "+0.5 EV" for exposure, "+20" or "−15" for the rest. */
export function adjustValue(key: keyof Adjust, value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const size = Math.abs(value);
  return key === 'exposure' ? `${sign}${size.toFixed(1)} EV` : `${sign}${String(size)}`;
}

/** For the result: "Adjusted: exposure +0.5 EV, contrast +20". */
export function adjustNote(adjust: Adjust): string {
  const moved = (Object.keys(ADJUST_LABELS) as (keyof Adjust)[])
    .filter((key) => adjust[key] !== 0)
    .map((key) => `${ADJUST_LABELS[key]} ${adjustValue(key, adjust[key])}`);
  return `Adjusted: ${moved.join(', ')}`;
}
