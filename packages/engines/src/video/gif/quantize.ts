/**
 * Palette building and mapping for animated GIF (V04): our own quantiser, so
 * ffmpeg.wasm stays out of the launch set (tools/video.md → V04).
 *
 * Pass 1 counts colours in a 5-bit-per-channel histogram (32,768 cells) over
 * every frame, splits it by median cut, then refines the palette with a few
 * rounds of k-means over the histogram. Pass 2 maps each frame to the palette,
 * optionally with serpentine Floyd–Steinberg dithering.
 */

export type Palette = Uint8Array; // r, g, b triples

const CELLS = 32 * 32 * 32;
const cell = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** A running colour count, frame by frame. */
export class Histogram {
  readonly count = new Uint32Array(CELLS);
  readonly sum = new Float64Array(CELLS * 3);

  /** Adds a frame's opaque pixels; every `step`-th pixel is enough for big frames. */
  add(rgba: Uint8ClampedArray | Uint8Array, step = 1) {
    for (let i = 0; i < rgba.length; i += 4 * step) {
      if ((rgba[i + 3] ?? 0) < 128) continue;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      const c = cell(r, g, b);
      this.count[c] = (this.count[c] ?? 0) + 1;
      this.sum[c * 3] = (this.sum[c * 3] ?? 0) + r;
      this.sum[c * 3 + 1] = (this.sum[c * 3 + 1] ?? 0) + g;
      this.sum[c * 3 + 2] = (this.sum[c * 3 + 2] ?? 0) + b;
    }
  }
}

interface Box {
  cells: number[];
  weight: number;
  /** Channel to split on, and how much splitting this box helps. */
  axis: number;
  score: number;
}

/** Up to `size` colours that represent the histogram. */
export function buildPalette(h: Histogram, size: number): Palette {
  const used: number[] = [];
  const means = new Float32Array(CELLS * 3);
  for (let c = 0; c < CELLS; c += 1) {
    const n = h.count[c] ?? 0;
    if (n === 0) continue;
    used.push(c);
    for (let k = 0; k < 3; k += 1) means[c * 3 + k] = (h.sum[c * 3 + k] ?? 0) / n;
  }
  if (used.length === 0) return Uint8Array.from([0, 0, 0]);

  // Perceptual weights: green matters most, blue least.
  const WEIGHTS = [0.299, 0.587, 0.114];
  const makeBox = (cells: number[]): Box => {
    const min = [255, 255, 255];
    const max = [0, 0, 0];
    let weight = 0;
    for (const c of cells) {
      weight += h.count[c] ?? 0;
      for (let k = 0; k < 3; k += 1) {
        const v = means[c * 3 + k] ?? 0;
        if (v < (min[k] ?? 255)) min[k] = v;
        if (v > (max[k] ?? 0)) max[k] = v;
      }
    }
    const ranges = WEIGHTS.map((w, k) => ((max[k] ?? 0) - (min[k] ?? 0)) * w);
    const axis = ranges.indexOf(Math.max(...ranges));
    return {
      cells,
      weight,
      axis,
      score: cells.length < 2 ? 0 : (ranges[axis] ?? 0) * Math.sqrt(weight),
    };
  };

  // Median cut: split the box that scores highest at its weighted median.
  const boxes: Box[] = [makeBox(used)];
  while (boxes.length < size) {
    let best = -1;
    for (const [index, box] of boxes.entries()) {
      if (box.score > (boxes[best]?.score ?? 0)) best = index;
    }
    const box = boxes[best];
    if (!box) break;
    const axis = box.axis;
    box.cells.sort((a, b) => (means[a * 3 + axis] ?? 0) - (means[b * 3 + axis] ?? 0));
    let half = 0;
    let split = 1;
    for (const [i, c] of box.cells.entries()) {
      half += h.count[c] ?? 0;
      if (half >= box.weight / 2) {
        split = Math.min(Math.max(1, i + 1), box.cells.length - 1);
        break;
      }
    }
    boxes.splice(best, 1, makeBox(box.cells.slice(0, split)), makeBox(box.cells.slice(split)));
  }

  // Box means, then k-means over the histogram cells to settle them.
  let centres = boxes.map((box) => {
    const total = [0, 0, 0];
    for (const c of box.cells) {
      for (let k = 0; k < 3; k += 1) total[k] = (total[k] ?? 0) + (h.sum[c * 3 + k] ?? 0);
    }
    return total.map((t) => t / Math.max(1, box.weight));
  });
  for (let round = 0; round < 4; round += 1) {
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (const c of used) {
      const nearest = nearestIn(centres, [
        means[c * 3] ?? 0,
        means[c * 3 + 1] ?? 0,
        means[c * 3 + 2] ?? 0,
      ]);
      const slot = acc[nearest];
      if (!slot) continue;
      slot[0] = (slot[0] ?? 0) + (h.sum[c * 3] ?? 0);
      slot[1] = (slot[1] ?? 0) + (h.sum[c * 3 + 1] ?? 0);
      slot[2] = (slot[2] ?? 0) + (h.sum[c * 3 + 2] ?? 0);
      slot[3] = (slot[3] ?? 0) + (h.count[c] ?? 0);
    }
    centres = acc.map((slot, i) => {
      const n = slot[3] ?? 0;
      return n > 0
        ? [(slot[0] ?? 0) / n, (slot[1] ?? 0) / n, (slot[2] ?? 0) / n]
        : (centres[i] ?? [0, 0, 0]);
    });
  }
  return Uint8Array.from(centres.flatMap((c) => c.map((v) => Math.round(v))));
}

function nearestIn(centres: number[][], colour: [number, number, number]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const [i, c] of centres.entries()) {
    const dr = (c[0] ?? 0) - colour[0];
    const dg = (c[1] ?? 0) - colour[1];
    const db = (c[2] ?? 0) - colour[2];
    const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** Nearest palette entry, cached per 5-bit cell (dithering keeps the fine error). */
export class PaletteLookup {
  private readonly cache = new Int16Array(CELLS).fill(-1);

  constructor(private readonly palette: Palette) {}

  nearest(r: number, g: number, b: number): number {
    const c = cell(r, g, b);
    const cached = this.cache[c] ?? -1;
    if (cached >= 0) return cached;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.palette.length / 3; i += 1) {
      const dr = (this.palette[i * 3] ?? 0) - r;
      const dg = (this.palette[i * 3 + 1] ?? 0) - g;
      const db = (this.palette[i * 3 + 2] ?? 0) - b;
      const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    this.cache[c] = best;
    return best;
  }
}

/**
 * Maps a frame to palette indices. Pixels under half opacity get `transparent`
 * (when given). Floyd–Steinberg runs left-to-right, then right-to-left, so the
 * error doesn't streak one way.
 */
export function mapFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  palette: Palette,
  lookup: PaletteLookup,
  dither: boolean,
  transparent = -1,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const error = dither ? new Float32Array((width + 2) * 2 * 3) : null;
  for (let y = 0; y < height; y += 1) {
    const reverse = y % 2 === 1;
    if (error) {
      // Rotate the two error rows: next row becomes current.
      error.copyWithin(0, (width + 2) * 3);
      error.fill(0, (width + 2) * 3);
    }
    for (let n = 0; n < width; n += 1) {
      const x = reverse ? width - 1 - n : n;
      const i = (y * width + x) * 4;
      if (transparent >= 0 && (rgba[i + 3] ?? 0) < 128) {
        out[y * width + x] = transparent;
        continue;
      }
      let r = rgba[i] ?? 0;
      let g = rgba[i + 1] ?? 0;
      let b = rgba[i + 2] ?? 0;
      if (error) {
        const e = (x + 1) * 3;
        r = Math.min(255, Math.max(0, r + (error[e] ?? 0)));
        g = Math.min(255, Math.max(0, g + (error[e + 1] ?? 0)));
        b = Math.min(255, Math.max(0, b + (error[e + 2] ?? 0)));
      }
      const index = lookup.nearest(r, g, b);
      out[y * width + x] = index;
      if (error) {
        const er = r - (palette[index * 3] ?? 0);
        const eg = g - (palette[index * 3 + 1] ?? 0);
        const eb = b - (palette[index * 3 + 2] ?? 0);
        const dx = reverse ? -1 : 1;
        const spread = (ox: number, row: number, weight: number) => {
          const at = (row * (width + 2) + x + 1 + ox) * 3;
          error[at] = (error[at] ?? 0) + er * weight;
          error[at + 1] = (error[at + 1] ?? 0) + eg * weight;
          error[at + 2] = (error[at + 2] ?? 0) + eb * weight;
        };
        spread(dx, 0, 7 / 16);
        spread(-dx, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(dx, 1, 1 / 16);
      }
    }
  }
  return out;
}
