/**
 * `image-geometry`: the pixel work behind P02 Crop and P03 Resize, as pure
 * functions on RGBA pixels so they run in the image worker and in unit tests.
 * Order: quarter turns, flip, crop, resize, pad. Crops, turns and flips move
 * pixels without resampling (lossless geometry); only resize filters.
 */

export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Filter = 'lanczos' | 'bicubic' | 'bilinear' | 'nearest';

export type ResizeBy = 'box' | 'width' | 'height' | 'percent' | 'longest';

/** How a box of another shape is met: keep the ratio inside it, pad, fill and crop, or stretch. */
export type Fit = 'keep' | 'pad' | 'fill' | 'stretch';

export interface ResizeSpec {
  by: ResizeBy;
  width?: number;
  height?: number;
  percent?: number;
  longest?: number;
  fit?: Fit;
  /** RGBA for Pad; alpha 0 is transparent. */
  pad?: [number, number, number, number];
  filter?: Filter;
}

export interface GeometryJob {
  /** Clockwise quarter turns, applied first. */
  turns?: number;
  /** Mirror left to right, after the turns. */
  flip?: boolean;
  /** Crop in turned pixels. */
  crop?: Rect;
  /** Centred crop to this width/height ratio, when there's no rectangle (a batch). */
  cropRatio?: number;
  resize?: ResizeSpec;
}

/** Output limits: the browser's decode limit also holds for what we make. */
export const OUTPUT_LIMITS = { maxPixels: 100_000_000, maxSide: 30_000 };

export class GeometryError extends Error {}

const px = (value: number) => `${String(value)} px`;
const dims = (size: Size) => `${String(size.width)} × ${String(size.height)} px`;

export function turnedSize(size: Size, turns = 0): Size {
  return turns % 2 === 0 ? size : { width: size.height, height: size.width };
}

/** Rotates clockwise by a number of quarter turns. */
export function rotateQuarter(image: Pixels, turns: number): Pixels {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  if (t === 0) return image;
  const { width: w, height: h, data: src } = image;
  const out = turnedSize(image, t);
  const dst = new Uint8ClampedArray(src.length);
  const src32 = new Uint32Array(src.buffer, src.byteOffset, w * h);
  const dst32 = new Uint32Array(dst.buffer);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let tx: number;
      let ty: number;
      if (t === 1) {
        tx = h - 1 - y;
        ty = x;
      } else if (t === 2) {
        tx = w - 1 - x;
        ty = h - 1 - y;
      } else {
        tx = y;
        ty = w - 1 - x;
      }
      dst32[ty * out.width + tx] = src32[y * w + x] ?? 0;
    }
  }
  return { data: dst, ...out };
}

/** Mirrors left to right. */
export function flipHorizontal(image: Pixels): Pixels {
  const { width: w, height: h } = image;
  const src32 = new Uint32Array(image.data.buffer, image.data.byteOffset, w * h);
  const dst = new Uint8ClampedArray(image.data.length);
  const dst32 = new Uint32Array(dst.buffer);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) dst32[row + w - 1 - x] = src32[row + x] ?? 0;
  }
  return { data: dst, width: w, height: h };
}

/** Keeps a rectangle inside the image, in whole pixels, at least 1 × 1. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - 1);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - 1);
  const width = Math.min(Math.max(1, Math.round(rect.width)), bounds.width - x);
  const height = Math.min(Math.max(1, Math.round(rect.height)), bounds.height - y);
  return { x, y, width, height };
}

/** Copies a rectangle out, pixel for pixel. */
export function cropPixels(image: Pixels, rect: Rect): Pixels {
  const r = clampRect(rect, image);
  if (r.x === 0 && r.y === 0 && r.width === image.width && r.height === image.height) return image;
  const dst = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y += 1) {
    const from = ((r.y + y) * image.width + r.x) * 4;
    dst.set(image.data.subarray(from, from + r.width * 4), y * r.width * 4);
  }
  return { data: dst, width: r.width, height: r.height };
}

/** The largest rectangle of a width/height ratio that fits, centred. */
export function centredRatio(bounds: Size, ratio: number): Rect {
  let width = bounds.width;
  let height = Math.round(width / ratio);
  if (height > bounds.height) {
    height = bounds.height;
    width = Math.round(height * ratio);
  }
  width = Math.min(Math.max(1, width), bounds.width);
  height = Math.min(Math.max(1, height), bounds.height);
  return {
    x: Math.floor((bounds.width - width) / 2),
    y: Math.floor((bounds.height - height) / 2),
    width,
    height,
  };
}

interface Kernel {
  radius: number;
  weight: (x: number) => number;
}

const sinc = (x: number) => {
  if (x === 0) return 1;
  const t = Math.PI * x;
  return Math.sin(t) / t;
};

/** Cubic convolution with a = -0.5 (Catmull-Rom), as in Pillow's BICUBIC. */
function cubic(x: number): number {
  const a = -0.5;
  const t = Math.abs(x);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}

const KERNELS: Record<Exclude<Filter, 'nearest'>, Kernel> = {
  lanczos: { radius: 3, weight: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
  bicubic: { radius: 2, weight: cubic },
  bilinear: { radius: 1, weight: (x) => Math.max(0, 1 - Math.abs(x)) },
};

interface Contributions {
  /** Taps per output pixel (the widest window). */
  taps: number;
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
}

/**
 * Which source pixels feed each output pixel, and how much: Pillow's
 * precompute_coeffs. Downscaling widens the kernel so every source pixel counts.
 */
function contributions(src: number, dst: number, filter: Filter): Contributions {
  const scale = src / dst;
  if (filter === 'nearest') {
    const start = new Int32Array(dst);
    for (let i = 0; i < dst; i += 1) start[i] = Math.min(src - 1, Math.floor((i + 0.5) * scale));
    return {
      taps: 1,
      start,
      count: new Int32Array(dst).fill(1),
      weights: new Float32Array(dst).fill(1),
    };
  }
  const kernel = KERNELS[filter];
  const filterScale = Math.max(1, scale);
  const support = kernel.radius * filterScale;
  const taps = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(dst);
  const count = new Int32Array(dst);
  const weights = new Float32Array(dst * taps);
  for (let i = 0; i < dst; i += 1) {
    const centre = (i + 0.5) * scale;
    const min = Math.max(0, Math.floor(centre - support + 0.5));
    const max = Math.min(src, Math.floor(centre + support + 0.5));
    let total = 0;
    const n = Math.min(taps, max - min);
    for (let k = 0; k < n; k += 1) {
      const w = kernel.weight((min + k - centre + 0.5) / filterScale);
      weights[i * taps + k] = w;
      total += w;
    }
    if (total !== 0)
      for (let k = 0; k < n; k += 1) weights[i * taps + k] = (weights[i * taps + k] ?? 0) / total;
    start[i] = min;
    count[i] = n;
  }
  return { taps, start, count, weights };
}

/**
 * Resamples to width × height with a separable filter on premultiplied alpha
 * (no dark fringes around transparency). Rows are filtered horizontally once
 * each and kept in a small ring, so memory stays at a few output rows.
 */
export function resample(image: Pixels, width: number, height: number, filter: Filter): Pixels {
  if (width === image.width && height === image.height) return image;
  const sw = image.width;
  const src = image.data;
  const h = contributions(sw, width, filter);
  const v = contributions(image.height, height, filter);
  const ringRows = v.taps;
  const ring = new Float32Array(ringRows * width * 4);
  const premul = new Float32Array(sw * 4);
  let nextRow = 0;

  const filterRow = (row: number) => {
    const base = row * sw * 4;
    for (let x = 0; x < sw; x += 1) {
      const i = base + x * 4;
      const a = src[i + 3] ?? 0;
      const p = x * 4;
      premul[p] = ((src[i] ?? 0) * a) / 255;
      premul[p + 1] = ((src[i + 1] ?? 0) * a) / 255;
      premul[p + 2] = ((src[i + 2] ?? 0) * a) / 255;
      premul[p + 3] = a;
    }
    const out = (row % ringRows) * width * 4;
    for (let x = 0; x < width; x += 1) {
      const s = h.start[x] ?? 0;
      const n = h.count[x] ?? 0;
      const wBase = x * h.taps;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < n; k += 1) {
        const w = h.weights[wBase + k] ?? 0;
        const p = (s + k) * 4;
        r += (premul[p] ?? 0) * w;
        g += (premul[p + 1] ?? 0) * w;
        b += (premul[p + 2] ?? 0) * w;
        a += (premul[p + 3] ?? 0) * w;
      }
      const o = out + x * 4;
      ring[o] = r;
      ring[o + 1] = g;
      ring[o + 2] = b;
      ring[o + 3] = a;
    }
  };

  const dst = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;
  const acc = new Float32Array(rowLength);
  for (let y = 0; y < height; y += 1) {
    const s = v.start[y] ?? 0;
    const n = v.count[y] ?? 0;
    while (nextRow < s + n) {
      filterRow(nextRow);
      nextRow += 1;
    }
    // Whole rows at a time: one weight per source row, a straight run over memory.
    acc.fill(0);
    for (let k = 0; k < n; k += 1) {
      const w = v.weights[y * v.taps + k] ?? 0;
      const from = ((s + k) % ringRows) * rowLength;
      for (let i = 0; i < rowLength; i += 1) acc[i] = (acc[i] ?? 0) + (ring[from + i] ?? 0) * w;
    }
    const out = y * rowLength;
    for (let i = 0; i < rowLength; i += 4) {
      const a = acc[i + 3] ?? 0;
      // Uint8ClampedArray rounds and clamps; Lanczos rings a little past 0 and 255.
      if (a >= 0.5) {
        const unmul = 255 / a;
        dst[out + i] = (acc[i] ?? 0) * unmul;
        dst[out + i + 1] = (acc[i + 1] ?? 0) * unmul;
        dst[out + i + 2] = (acc[i + 2] ?? 0) * unmul;
      }
      dst[out + i + 3] = a;
    }
  }
  return { data: dst, width, height };
}

/** Places an image on a canvas of one colour. */
export function padPixels(
  image: Pixels,
  size: Size,
  at: { x: number; y: number },
  rgba: [number, number, number, number],
): Pixels {
  const dst = new Uint8ClampedArray(size.width * size.height * 4);
  const fill = new Uint8ClampedArray(rgba);
  const fill32 = new Uint32Array(fill.buffer)[0] ?? 0;
  new Uint32Array(dst.buffer).fill(fill32);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 4;
    dst.set(
      image.data.subarray(from, from + image.width * 4),
      ((at.y + y) * size.width + at.x) * 4,
    );
  }
  return { data: dst, width: size.width, height: size.height };
}

export interface ResizePlan {
  /** Crop the source to this first (Fill). */
  crop?: Rect;
  /** Resample to this size. */
  scaled: Size;
  /** Then place it on a canvas of this size (Pad). */
  canvas?: Size & { x: number; y: number };
  /** The final size. */
  output: Size;
}

const positive = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

/** Works out the sizes for a resize, from the source size alone. */
export function planResize(source: Size, spec: ResizeSpec): ResizePlan {
  const { width: w, height: h } = source;
  const whole = (value: number) => Math.max(1, Math.round(value));
  const scaledBy = (factor: number): Size => ({
    width: whole(w * factor),
    height: whole(h * factor),
  });
  const need = (value: number | undefined, what: string) => {
    const ok = positive(value);
    if (ok === undefined) throw new GeometryError(`Enter the ${what}`);
    return ok;
  };

  let plan: ResizePlan;
  switch (spec.by) {
    case 'width': {
      const target = whole(need(spec.width, 'width in px'));
      const scaled = { width: target, height: whole((h * target) / w) };
      plan = { scaled, output: scaled };
      break;
    }
    case 'height': {
      const target = whole(need(spec.height, 'height in px'));
      const scaled = { width: whole((w * target) / h), height: target };
      plan = { scaled, output: scaled };
      break;
    }
    case 'percent': {
      const scaled = scaledBy(need(spec.percent, 'percentage') / 100);
      plan = { scaled, output: scaled };
      break;
    }
    case 'longest': {
      const scaled = scaledBy(need(spec.longest, 'longest side in px') / Math.max(w, h));
      plan = { scaled, output: scaled };
      break;
    }
    case 'box': {
      const box = {
        width: whole(need(spec.width, 'width in px')),
        height: whole(need(spec.height, 'height in px')),
      };
      const fit = spec.fit ?? 'keep';
      if (fit === 'stretch') {
        plan = { scaled: box, output: box };
      } else if (fit === 'fill') {
        plan = { crop: centredRatio(source, box.width / box.height), scaled: box, output: box };
      } else {
        const scaled = scaledBy(Math.min(box.width / w, box.height / h));
        // Rounding can land a pixel over the box on the long side.
        scaled.width = Math.min(scaled.width, box.width);
        scaled.height = Math.min(scaled.height, box.height);
        plan =
          fit === 'pad'
            ? {
                scaled,
                canvas: {
                  ...box,
                  x: Math.floor((box.width - scaled.width) / 2),
                  y: Math.floor((box.height - scaled.height) / 2),
                },
                output: box,
              }
            : { scaled, output: scaled };
      }
      break;
    }
  }
  const { output } = plan;
  if (
    output.width > OUTPUT_LIMITS.maxSide ||
    output.height > OUTPUT_LIMITS.maxSide ||
    output.width * output.height > OUTPUT_LIMITS.maxPixels
  ) {
    const mp = ((output.width * output.height) / 1e6).toFixed(0);
    throw new GeometryError(
      `That would be ${dims(output)} (${mp} MP); the browser limit is 100 MP and ${px(OUTPUT_LIMITS.maxSide)} a side.`,
    );
  }
  return plan;
}

/** Runs a geometry job and says what it did, in plain words. */
export function applyGeometry(image: Pixels, job: GeometryJob): { image: Pixels; notes: string[] } {
  const notes: string[] = [];
  let out = image;
  const turns = (((job.turns ?? 0) % 4) + 4) % 4;
  if (turns) {
    out = rotateQuarter(out, turns);
    notes.push(`Rotated ${String(turns * 90)}° clockwise`);
  }
  if (job.flip) {
    out = flipHorizontal(out);
    notes.push('Flipped left to right');
  }
  const crop = job.crop
    ? clampRect(job.crop, out)
    : job.cropRatio
      ? centredRatio(out, job.cropRatio)
      : undefined;
  if (crop && (crop.width !== out.width || crop.height !== out.height)) {
    out = cropPixels(out, crop);
    notes.push(`Cropped to ${dims(out)}`);
  } else if (job.crop) {
    notes.push('The box covers the whole image, so nothing was cropped');
  }
  if (job.resize) {
    const plan = planResize(out, job.resize);
    if (plan.crop) {
      out = cropPixels(out, plan.crop);
      notes.push(`Edges cropped to ${dims(out)} to fill the box`);
    }
    const from = { width: out.width, height: out.height };
    out = resample(out, plan.scaled.width, plan.scaled.height, job.resize.filter ?? 'lanczos');
    notes.push(
      from.width === out.width && from.height === out.height
        ? `Already ${dims(out)}: size unchanged`
        : `Resized from ${dims(from)} to ${dims(out)}`,
    );
    if (plan.canvas) {
      out = padPixels(out, plan.canvas, plan.canvas, job.resize.pad ?? [255, 255, 255, 255]);
      notes.push(`Padded to ${dims(out)}`);
    }
    const grew = plan.scaled.width / from.width;
    if (grew > 1.001) {
      notes.push(
        `Enlarged to ${String(Math.round(grew * 100))} %: enlarging adds no detail, so it looks softer`,
      );
    }
  }
  return { image: out, notes };
}
