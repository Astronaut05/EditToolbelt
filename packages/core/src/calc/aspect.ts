/** Aspect ratio maths (tools/subtitles-and-time.md → T05). */

export function gcd(a: number, b: number): number {
  let [x, y] = [Math.abs(Math.round(a)), Math.abs(Math.round(b))];
  while (y) [x, y] = [y, x % y];
  return x;
}

export interface Ratio {
  label: string;
  value: number;
}

export const COMMON_RATIOS: readonly Ratio[] = [
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '2.39:1', value: 2.39 },
  { label: '1.85:1', value: 1.85 },
  { label: '21:9', value: 21 / 9 },
];

/** 1920 × 1080 → { label: "16:9", decimal: 1.778 }. */
export function simplify(
  width: number,
  height: number,
): { label: string; decimal: number; nearest?: string } {
  const divisor = gcd(width, height) || 1;
  const decimal = width / height;
  const exact = `${String(Math.round(width / divisor))}:${String(Math.round(height / divisor))}`;
  // The closest common ratio within 2 % (2560 × 1080 is 64:27 ≈ 2.39:1).
  const nearest = [...COMMON_RATIOS]
    .sort((a, b) => Math.abs(a.value - decimal) - Math.abs(b.value - decimal))
    .find((ratio) => Math.abs(ratio.value - decimal) / ratio.value < 0.02);
  return {
    label: exact,
    decimal,
    nearest: nearest && nearest.label !== exact ? nearest.label : undefined,
  };
}

/** "16:9", "2.39:1", "2.39" → 1.777… */
export function parseRatio(input: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[:x×/]\s*(\d+(?:\.\d+)?))?\s*$/.exec(input);
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] === undefined ? 1 : Number(match[2]);
  return a > 0 && b > 0 ? a / b : null;
}

/** Nearest integer, or nearest even integer (video codecs need even dimensions). */
export function roundSide(value: number, even: boolean): number {
  return even ? Math.round(value / 2) * 2 : Math.round(value);
}

export function heightFor(width: number, ratio: number, even = false): number {
  return roundSide(width / ratio, even);
}

export function widthFor(height: number, ratio: number, even = false): number {
  return roundSide(height * ratio, even);
}

/** Scales W×H to fit inside a box, and reports the bars. */
export function fitInto(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
  even = false,
): { width: number; height: number; bars: 'none' | 'letterbox' | 'pillarbox'; barSize: number } {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const w = roundSide(width * scale, even);
  const h = roundSide(height * scale, even);
  if (w < boxWidth) return { width: w, height: h, bars: 'pillarbox', barSize: (boxWidth - w) / 2 };
  if (h < boxHeight)
    return { width: w, height: h, bars: 'letterbox', barSize: (boxHeight - h) / 2 };
  return { width: w, height: h, bars: 'none', barSize: 0 };
}
