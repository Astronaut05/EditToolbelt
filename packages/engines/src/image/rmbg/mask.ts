/**
 * The pixel work around the background-removal model (tools/photo.md → P07):
 * the input tensor, the mask the model returns, upscaling that mask to the
 * photo with a guided filter so edges follow hair and fur, and compositing.
 * Pure functions on typed arrays: run in the worker, tested in Node.
 */

/** RGBA pixels (size × size, already resized) to a normalised 1 × 3 × size × size tensor. */
export function toTensor(
  rgba: Uint8ClampedArray | Uint8Array,
  size: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[c * plane + i] = ((rgba[i * 4 + c] ?? 0) / 255 - (mean[c] ?? 0)) / (std[c] ?? 1);
    }
  }
  return out;
}

/** The model's output as a 0-1 mask: logits through a sigmoid, or a probability map stretched to 0-1. */
export function toMask(output: Float32Array, kind: 'logits' | 'probability'): Float32Array {
  const mask = new Float32Array(output.length);
  if (kind === 'logits') {
    for (let i = 0; i < output.length; i += 1) mask[i] = 1 / (1 + Math.exp(-(output[i] ?? 0)));
    return mask;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of output) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < output.length; i += 1) mask[i] = ((output[i] ?? 0) - min) / range;
  return mask;
}

/** Bilinear resize of a one-channel map. */
export function resizeMask(
  mask: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x += 1) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = (mask[y0 * sw + x0] ?? 0) * (1 - tx) + (mask[y0 * sw + x1] ?? 0) * tx;
      const b = (mask[y1 * sw + x0] ?? 0) * (1 - tx) + (mask[y1 * sw + x1] ?? 0) * tx;
      out[y * dw + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Mean over a (2r+1)² window, edges clamped, via running sums: O(pixels) whatever r is. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[row + Math.min(w - 1, Math.max(0, x))] ?? 0;
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += (src[row + Math.min(w - 1, x + r + 1)] ?? 0) - (src[row + Math.max(0, x - r)] ?? 0);
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] ?? 0;
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / (2 * r + 1);
      sum +=
        (tmp[Math.min(h - 1, y + r + 1) * w + x] ?? 0) - (tmp[Math.max(0, y - r) * w + x] ?? 0);
    }
  }
  return out;
}

/** Luminance 0-1 of RGBA pixels: the guide for the filter. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i += 1) {
    out[i] =
      (0.299 * (rgba[i * 4] ?? 0) +
        0.587 * (rgba[i * 4 + 1] ?? 0) +
        0.114 * (rgba[i * 4 + 2] ?? 0)) /
      255;
  }
  return out;
}

/**
 * He et al.'s guided filter: a smooth mask made to follow the edges of the
 * photo (the guide), so an upscaled mask hugs hair instead of blurring past it.
 */
export function guidedFilter(
  guide: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = w * h;
  const meanI = boxMean(guide, w, h, r);
  const meanP = boxMean(mask, w, h, r);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const g = guide[i] ?? 0;
    ip[i] = g * (mask[i] ?? 0);
    ii[i] = g * g;
  }
  const meanIp = boxMean(ip, w, h, r);
  const meanII = boxMean(ii, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const mi = meanI[i] ?? 0;
    const cov = (meanIp[i] ?? 0) - mi * (meanP[i] ?? 0);
    const variance = (meanII[i] ?? 0) - mi * mi;
    const ai = cov / (variance + eps);
    a[i] = ai;
    b[i] = (meanP[i] ?? 0) - ai * mi;
  }
  const meanA = boxMean(a, w, h, r);
  const meanB = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.min(1, Math.max(0, (meanA[i] ?? 0) * (guide[i] ?? 0) + (meanB[i] ?? 0)));
  }
  return out;
}

/** Hard edges: a steep ramp around 0.5, so the cut is crisp but not jagged. */
export function hardenMask(mask: Float32Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    const t = Math.min(1, Math.max(0, ((mask[i] ?? 0) - 0.4) / 0.2));
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

export type Backdrop =
  | { kind: 'transparent' }
  | { kind: 'color'; rgb: [number, number, number] }
  /** Pixels of the same size to show behind (a blurred copy of the photo). */
  | { kind: 'pixels'; rgba: Uint8ClampedArray | Uint8Array };

/** The photo over its new backdrop, through the mask. */
export function composite(
  rgba: Uint8ClampedArray | Uint8Array,
  mask: Float32Array,
  backdrop: Backdrop,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < mask.length; i += 1) {
    const a = mask[i] ?? 0;
    const p = i * 4;
    if (backdrop.kind === 'transparent') {
      out[p] = rgba[p] ?? 0;
      out[p + 1] = rgba[p + 1] ?? 0;
      out[p + 2] = rgba[p + 2] ?? 0;
      out[p + 3] = a * (rgba[p + 3] ?? 255);
      continue;
    }
    const bg =
      backdrop.kind === 'color'
        ? backdrop.rgb
        : [backdrop.rgba[p] ?? 0, backdrop.rgba[p + 1] ?? 0, backdrop.rgba[p + 2] ?? 0];
    for (let c = 0; c < 3; c += 1) {
      out[p + c] = (rgba[p + c] ?? 0) * a + (bg[c] ?? 0) * (1 - a);
    }
    out[p + 3] = 255;
  }
  return out;
}

/** Intersection over union of two masks at 0.5: the benchmark's score. */
export function iou(a: Float32Array, b: Float32Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = (a[i] ?? 0) >= 0.5;
    const y = (b[i] ?? 0) >= 0.5;
    if (x && y) inter += 1;
    if (x || y) union += 1;
  }
  return union === 0 ? 1 : inter / union;
}

/** Float32 to IEEE half-precision bits, for models that take 16-bit input. */
export function toHalf(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < values.length; i += 1) {
    f[0] = values[i] ?? 0;
    const x = u[0] ?? 0;
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 127 + 15;
    const mant = x & 0x7fffff;
    if (exp >= 0x1f) out[i] = sign | 0x7c00;
    else if (exp <= 0) {
      // Subnormal or zero: shift the implicit 1 into the mantissa.
      out[i] = exp < -10 ? sign : sign | ((((mant | 0x800000) >> (1 - exp)) + 0x1000) >> 13);
    } else {
      // Rounding can carry into the exponent (and up to Infinity), so add, don't OR.
      out[i] = sign | ((exp << 10) + ((mant + 0x1000) >> 13));
    }
  }
  return out;
}

/** IEEE half-precision bits to Float32, for models that return 16-bit output. */
export function fromHalf(bits: Uint16Array): Float32Array {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i += 1) {
    const h = bits[i] ?? 0;
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;
    out[i] =
      exp === 0
        ? sign * 2 ** -14 * (mant / 1024)
        : exp === 0x1f
          ? mant
            ? NaN
            : sign * Infinity
          : sign * 2 ** (exp - 15) * (1 + mant / 1024);
  }
  return out;
}

/** A Refine brush stroke in image px: keep paints the subject back, erase removes. */
export interface Stroke {
  mode: 'keep' | 'erase';
  /** Brush radius in image px. */
  radius: number;
  points: [number, number][];
}

/** Paints strokes into a mask with a soft round brush (full strength inside 70 % of the radius). */
export function paintStrokes(
  mask: Float32Array,
  w: number,
  h: number,
  strokes: readonly Stroke[],
): Float32Array {
  const out = mask.slice();
  for (const stroke of strokes) {
    const r = Math.max(1, stroke.radius);
    const inner = r * 0.7;
    const dab = (cx: number, cy: number) => {
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d >= r) continue;
          const strength = d <= inner ? 1 : 1 - (d - inner) / (r - inner);
          const i = y * w + x;
          const v = out[i] ?? 0;
          out[i] = stroke.mode === 'keep' ? Math.max(v, strength) : Math.min(v, 1 - strength);
        }
      }
    };
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    dab(first[0], first[1]);
    let [px, py] = first;
    // Dabs every quarter radius along each segment, so fast strokes stay solid.
    for (const [x, y] of rest) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / (r / 4)));
      for (let s = 1; s <= steps; s += 1)
        dab(px + ((x - px) * s) / steps, py + ((y - py) * s) / steps);
      px = x;
      py = y;
    }
  }
  return out;
}

/** Reads strokes from the option string, dropping anything malformed. */
export function parseStrokes(text: string | undefined): Stroke[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown): Stroke[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { mode, radius, points } = item as Record<string, unknown>;
    if ((mode !== 'keep' && mode !== 'erase') || typeof radius !== 'number') return [];
    if (!Array.isArray(points)) return [];
    const pts = points.filter(
      (p: unknown): p is [number, number] =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === 'number' && Number.isFinite(n)),
    );
    return pts.length ? [{ mode, radius, points: pts }] : [];
  });
}
