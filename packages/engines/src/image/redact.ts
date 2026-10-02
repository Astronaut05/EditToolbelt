/**
 * P12 Blur & Pixelate (tools/photo.md): the areas to hide, kept as data in
 * the image's own pixels, and pure code that hides them in RGBA pixels. The
 * editor runs it on its screen-sized copy for the preview, and the image
 * worker on the full-size image, so the file matches what was on screen.
 *
 * Every pixel inside an area is replaced: blur and pixelate never mix the
 * original back in at the edges, so nothing of a face shows through.
 */
import type { Point } from './annotate';

export type RedactShape = 'rect' | 'ellipse' | 'brush';
export type RedactEffect = 'blur' | 'pixelate' | 'solid';

export const REDACT_SHAPES: readonly RedactShape[] = ['rect', 'ellipse', 'brush'];
export const REDACT_EFFECTS: readonly RedactEffect[] = ['blur', 'pixelate', 'solid'];

export interface Redaction {
  shape: RedactShape;
  /** A box or ellipse: two opposite corners. A brush: its path. Image px. */
  points: Point[];
  /** A brush's width, image px. */
  size?: number;
  /** Found by face detection, with the model's score (0-1); drawn areas have none. */
  face?: number;
  /** A found face the user chose to leave as it is. */
  off?: boolean;
}

export interface Redact {
  effect: RedactEffect;
  /** Blur radius or pixel block size, image px. */
  amount: number;
  /** Solid box colour, "#rrggbb". */
  color: string;
  areas: Redaction[];
}

/** Whole pixels: left, top, width, height. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The strength a photo starts with: about 60 blocks across its longest side. */
export function defaultAmount(size: { width: number; height: number }): number {
  return Math.max(6, Math.round(Math.max(size.width, size.height) / 60));
}

/** The slider's top: an eighth of the longest side. */
export function maxAmount(size: { width: number; height: number }): number {
  return Math.max(24, Math.round(Math.max(size.width, size.height) / 8));
}

/**
 * A found face's box grown to cover the whole head: the detector's box runs
 * from the brows to the chin, so hair, forehead and ears are added.
 */
export function faceArea(face: Box & { score: number }, bounds: Box): Redaction {
  const x0 = Math.max(0, face.x - face.width * 0.15);
  const x1 = Math.min(bounds.width, face.x + face.width * 1.15);
  const y0 = Math.max(0, face.y - face.height * 0.3);
  const y1 = Math.min(bounds.height, face.y + face.height * 1.1);
  return {
    shape: 'ellipse',
    points: [
      [Math.round(x0), Math.round(y0)],
      [Math.round(x1), Math.round(y1)],
    ],
    face: face.score,
  };
}

/** The area's pixels as a whole-pixel box inside the image, or null when it's empty. */
export function areaBox(area: Redaction, width: number, height: number): Box | null {
  if (area.points.length === 0) return null;
  const pad = area.shape === 'brush' ? (area.size ?? 1) / 2 : 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of area.points) {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const right = Math.min(width, Math.ceil(maxX));
  const bottom = Math.min(height, Math.ceil(maxY));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Distance² from (px, py) to the segment a→b. */
function segmentDistance2(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / length2));
  const ex = px - (a[0] + t * dx);
  const ey = py - (a[1] + t * dy);
  return ex * ex + ey * ey;
}

/** Which of the box's pixels the area covers (1) or not (0), tested at pixel centres. */
export function areaMask(area: Redaction, box: Box): Uint8Array {
  const mask = new Uint8Array(box.width * box.height);
  if (area.shape === 'rect') return mask.fill(1);
  if (area.shape === 'ellipse') {
    const [a, b] = area.points;
    if (!a || !b) return mask;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const rx = Math.abs(b[0] - a[0]) / 2;
    const ry = Math.abs(b[1] - a[1]) / 2;
    if (rx === 0 || ry === 0) return mask;
    for (let y = 0; y < box.height; y += 1) {
      const ny = (box.y + y + 0.5 - cy) / ry;
      for (let x = 0; x < box.width; x += 1) {
        const nx = (box.x + x + 0.5 - cx) / rx;
        if (nx * nx + ny * ny <= 1) mask[y * box.width + x] = 1;
      }
    }
    return mask;
  }
  // A brush: round-ended strokes between the points, each tested only near itself.
  const radius = (area.size ?? 1) / 2;
  const r2 = radius * radius;
  const points = area.points.length === 1 ? [area.points[0], area.points[0]] : area.points;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const x0 = Math.max(box.x, Math.floor(Math.min(a[0], b[0]) - radius));
    const x1 = Math.min(box.x + box.width, Math.ceil(Math.max(a[0], b[0]) + radius));
    const y0 = Math.max(box.y, Math.floor(Math.min(a[1], b[1]) - radius));
    const y1 = Math.min(box.y + box.height, Math.ceil(Math.max(a[1], b[1]) + radius));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const at = (y - box.y) * box.width + (x - box.x);
        if (mask[at] === 0 && segmentDistance2(x + 0.5, y + 0.5, a, b) <= r2) mask[at] = 1;
      }
    }
  }
  return mask;
}

/**
 * Pixelate: blocks of `block` px, counted from the box's top-left corner,
 * each the average colour of its pixels (weighted by their opacity).
 */
export function pixelate(image: Pixels, box: Box, block: number, mask: Uint8Array): void {
  const { data, width } = image;
  const size = Math.max(1, Math.round(block));
  for (let by = 0; by < box.height; by += size) {
    for (let bx = 0; bx < box.width; bx += size) {
      const w = Math.min(size, box.width - bx);
      const h = Math.min(size, box.height - by);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = 0; y < h; y += 1) {
        let i = ((box.y + by + y) * width + box.x + bx) * 4;
        for (let x = 0; x < w; x += 1, i += 4) {
          const alpha = data[i + 3] ?? 0;
          r += (data[i] ?? 0) * alpha;
          g += (data[i + 1] ?? 0) * alpha;
          b += (data[i + 2] ?? 0) * alpha;
          a += alpha;
        }
      }
      const value =
        a === 0
          ? [0, 0, 0, 0]
          : [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / (w * h))];
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if (!mask[(by + y) * box.width + bx + x]) continue;
          const i = ((box.y + by + y) * width + box.x + bx + x) * 4;
          data[i] = value[0] ?? 0;
          data[i + 1] = value[1] ?? 0;
          data[i + 2] = value[2] ?? 0;
          data[i + 3] = value[3] ?? 0;
        }
      }
    }
  }
}

/** One box-blur pass along a line of `n` values `stride` apart, edges clamped. */
function boxLine(
  src: Float32Array,
  dst: Float32Array,
  start: number,
  n: number,
  stride: number,
  r: number,
) {
  const at = (k: number) => src[start + Math.min(n - 1, Math.max(0, k)) * stride] ?? 0;
  let sum = 0;
  for (let k = -r; k <= r; k += 1) sum += at(k);
  const width = 2 * r + 1;
  for (let k = 0; k < n; k += 1) {
    dst[start + k * stride] = sum / width;
    sum += at(k + r + 1) - at(k - r);
  }
}

/**
 * Blur: three box blurs each way (close to a Gaussian with σ ≈ radius / 2),
 * read from the box and `radius` px around it, opacity-weighted so
 * transparent pixels don't darken the edges.
 */
export function blur(image: Pixels, box: Box, radius: number, mask: Uint8Array): void {
  const { data, width, height } = image;
  const r = Math.max(1, Math.round(radius / 2));
  const reach = 3 * r;
  const x0 = Math.max(0, box.x - reach);
  const y0 = Math.max(0, box.y - reach);
  const w = Math.min(width, box.x + box.width + reach) - x0;
  const h = Math.min(height, box.y + box.height + reach) - y0;
  const n = w * h;
  // Premultiplied channels, then alpha.
  const channels = [0, 1, 2, 3].map(() => new Float32Array(n));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y0 + y) * width + x0 + x) * 4;
      const k = y * w + x;
      const alpha = (data[i + 3] ?? 0) / 255;
      for (let c = 0; c < 3; c += 1) {
        const channel = channels[c];
        if (channel) channel[k] = (data[i + c] ?? 0) * alpha;
      }
      const alphas = channels[3];
      if (alphas) alphas[k] = alpha;
    }
  }
  const scratch = new Float32Array(n);
  for (const channel of channels) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let y = 0; y < h; y += 1) boxLine(channel, scratch, y * w, w, 1, r);
      for (let x = 0; x < w; x += 1) boxLine(scratch, channel, x, h, w, r);
    }
  }
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      if (!mask[y * box.width + x]) continue;
      const k = (box.y + y - y0) * w + (box.x + x - x0);
      const i = ((box.y + y) * width + box.x + x) * 4;
      const alpha = channels[3]?.[k] ?? 0;
      for (let c = 0; c < 3; c += 1) {
        data[i + c] = alpha > 0 ? (channels[c]?.[k] ?? 0) / alpha : 0;
      }
      data[i + 3] = alpha * 255;
    }
  }
}

/** "#rrggbb" → [r, g, b]; black for anything else. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m?.[1] ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function solid(image: Pixels, box: Box, color: string, mask: Uint8Array): void {
  const [r, g, b] = hexRgb(color);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      if (!mask[y * box.width + x]) continue;
      const i = ((box.y + y) * image.width + box.x + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
}

/** The area at `scale` (the decode, or the editor's preview, smaller than the image). */
function scaled(area: Redaction, scale: number): Redaction {
  if (scale === 1) return area;
  return {
    ...area,
    points: area.points.map(([x, y]) => [x * scale, y * scale] as const),
    ...(area.size !== undefined && { size: area.size * scale }),
  };
}

/** The area's box at `scale`, not clipped: for outlines on a preview. */
export function areaBoxOf(area: Redaction, scale: number): Box | null {
  return areaBox(scaled(area, scale), Infinity, Infinity);
}

/** The areas that hide something: drawn ones, and found faces not turned off. */
export const activeAreas = (redact: Redact) => redact.areas.filter((a) => !a.off);

/**
 * Hides every active area in the pixels, in order. `scale` is the pixels'
 * size over the image's own (below 1 for a preview or a scaled-down decode).
 * Returns how many areas were hidden.
 */
export function applyRedact(image: Pixels, redact: Redact, scale = 1): number {
  let count = 0;
  const amount = Math.max(1, redact.amount * scale);
  for (const area of activeAreas(redact)) {
    const at = scaled(area, scale);
    const box = areaBox(at, image.width, image.height);
    if (!box) continue;
    const mask = areaMask(at, box);
    if (redact.effect === 'pixelate') pixelate(image, box, amount, mask);
    else if (redact.effect === 'solid') solid(image, box, redact.color, mask);
    else blur(image, box, amount, mask);
    count += 1;
  }
  return count;
}
