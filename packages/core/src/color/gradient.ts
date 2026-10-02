/**
 * C07 Gradient Generator (tools/color.md): linear, radial and conic
 * gradients from colour stops, as CSS and as pixels laid out the way CSS
 * lays them out, so the PNG matches the preview. Plain gradients blend in
 * sRGB, as CSS does by default. "Smooth" blends in Oklch along the shorter
 * hue arc, which keeps the middle of red to blue a clear purple instead of a
 * muddy one; its CSS carries the blend as extra stops, so it looks the same
 * in every browser.
 */
import { inGamut, oklchToRgb, rgbToOklch, toBytes, toHex, type Rgb } from './color';

export type GradientKind = 'linear' | 'radial' | 'conic';

export interface GradientStop {
  color: Rgb;
  /** 0-1 along the gradient. */
  at: number;
}

export interface Gradient {
  kind: GradientKind;
  /** Degrees. Linear: the direction (0 up, 90 right). Conic: where it starts. Radial: unused. */
  angle: number;
  stops: GradientStop[];
  smooth: boolean;
}

/** Extra stops between each pair in smooth CSS: a stop every 10 %. */
const SMOOTH_STEPS = 10;

/** Sorted by position, positions within 0-1. */
export function sortedStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops
    .map((stop) => ({ color: stop.color, at: Math.min(1, Math.max(0, stop.at)) }))
    .sort((a, b) => a.at - b.at);
}

/** Chroma lowered until the colour fits sRGB, hue and lightness kept (CSS Color 4's way). */
function fitted(l: number, c: number, h: number): Rgb {
  let rgb = oklchToRgb({ l, c, h });
  if (inGamut(rgb)) return rgb;
  let low = 0;
  let high = c;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    rgb = oklchToRgb({ l, c: mid, h });
    if (inGamut(rgb)) low = mid;
    else high = mid;
  }
  return oklchToRgb({ l, c: low, h });
}

/** Between two colours, `u` of the way: in sRGB, or in Oklch on the shorter hue arc. */
export function blend(from: Rgb, to: Rgb, u: number, smooth: boolean): Rgb {
  if (!smooth) {
    return {
      r: from.r + (to.r - from.r) * u,
      g: from.g + (to.g - from.g) * u,
      b: from.b + (to.b - from.b) * u,
      a: 1,
    };
  }
  const a = rgbToOklch(from);
  const b = rgbToOklch(to);
  // A grey has no hue of its own: it takes the other colour's, so the blend doesn't swing through others.
  const hueA = a.c < 1e-4 ? b.h : a.h;
  const hueB = b.c < 1e-4 ? hueA : b.h;
  let delta = hueB - hueA;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return fitted(a.l + (b.l - a.l) * u, a.c + (b.c - a.c) * u, (hueA + delta * u + 360) % 360);
}

/** The colour at `t` (0-1) along sorted stops. Before the first stop and after the last, theirs. */
export function colorAt(stops: readonly GradientStop[], t: number, smooth: boolean): Rgb {
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return { r: 0, g: 0, b: 0, a: 1 };
  if (t <= first.at) return first.color;
  if (t >= last.at) return last.color;
  for (let i = 1; i < stops.length; i += 1) {
    const to = stops[i];
    const from = stops[i - 1];
    if (!to || !from || t > to.at) continue;
    const span = to.at - from.at;
    return span <= 0 ? to.color : blend(from.color, to.color, (t - from.at) / span, smooth);
  }
  return last.color;
}

const pct = (at: number) => `${String(Math.round(at * 1000) / 10)}%`;
const hex = (rgb: Rgb) => toHex(toBytes(rgb));

/** The CSS `background-image` value. */
export function gradientCss(gradient: Gradient): string {
  const stops = sortedStops(gradient.stops);
  const parts: string[] = [];
  stops.forEach((stop, i) => {
    const before = stops[i - 1];
    if (gradient.smooth && before && stop.at > before.at) {
      for (let k = 1; k < SMOOTH_STEPS; k += 1) {
        const u = k / SMOOTH_STEPS;
        const at = before.at + (stop.at - before.at) * u;
        parts.push(`${hex(blend(before.color, stop.color, u, true))} ${pct(at)}`);
      }
    }
    parts.push(`${hex(stop.color)} ${pct(stop.at)}`);
  });
  const list = parts.join(', ');
  const angle = Math.round(gradient.angle * 10) / 10;
  if (gradient.kind === 'radial') return `radial-gradient(circle, ${list})`;
  if (gradient.kind === 'conic') return `conic-gradient(from ${String(angle)}deg, ${list})`;
  return `linear-gradient(${String(angle)}deg, ${list})`;
}

/**
 * Where a point falls along the gradient (0-1, unclamped), in a `width` ×
 * `height` box, as CSS places it: linear along a line through the centre
 * long enough to reach the corners; radial out to the farthest corner;
 * conic clockwise from `angle`.
 */
export function positionAt(
  kind: GradientKind,
  angle: number,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const dx = x - width / 2;
  const dy = y - height / 2;
  const rad = (angle * Math.PI) / 180;
  if (kind === 'radial') return Math.hypot(dx, dy) / Math.hypot(width / 2, height / 2);
  if (kind === 'conic') {
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((((degrees - angle) % 360) + 360) % 360) / 360;
  }
  const length = Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
  return (dx * Math.sin(rad) - dy * Math.cos(rad)) / length + 0.5;
}

/** Colours looked up along the gradient for each pixel: fine enough that steps never show. */
const TABLE = 4096;

/** A 4 × 4 ordered dither: spreads each 8-bit step over neighbouring pixels so no bands show. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The gradient's RGBA pixels, `width` × `height`, dithered unless `dither` is false. */
export function renderGradient(
  gradient: Gradient,
  width: number,
  height: number,
  dither = true,
): Uint8ClampedArray<ArrayBuffer> {
  const stops = sortedStops(gradient.stops);
  const table = new Float32Array(TABLE * 3);
  for (let i = 0; i < TABLE; i += 1) {
    const { r, g, b } = colorAt(stops, i / (TABLE - 1), gradient.smooth);
    table[i * 3] = r;
    table[i * 3 + 1] = g;
    table[i * 3 + 2] = b;
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = positionAt(gradient.kind, gradient.angle, width, height, x + 0.5, y + 0.5);
      const index = Math.round(Math.min(1, Math.max(0, t)) * (TABLE - 1)) * 3;
      const offset = dither ? ((BAYER[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16 : 0.5;
      const at = (y * width + x) * 4;
      out[at] = Math.floor((table[index] ?? 0) + offset);
      out[at + 1] = Math.floor((table[index + 1] ?? 0) + offset);
      out[at + 2] = Math.floor((table[index + 2] ?? 0) + offset);
      out[at + 3] = 255;
    }
  }
  return out;
}
