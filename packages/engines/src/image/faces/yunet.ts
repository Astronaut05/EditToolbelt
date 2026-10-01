/**
 * P12's face finder (tools/photo.md → P12): YuNet, OpenCV's small face
 * detector (MIT, 232 KB), run with ONNX Runtime Web. Pure parts here: the
 * model's file, the tiles a photo is read in, the input tensor and decoding
 * the outputs into boxes, so they are unit tested without a browser.
 *
 * The model reads a fixed 640 × 640 BGR input with 0-255 values. A photo is
 * read whole (scaled to fit 640) and, when it's large, again in overlapping
 * tiles at twice and four times that detail, so a face 30 px wide in a
 * 4000 px group photo is still found. Overlaps are then merged.
 */

export const YUNET = {
  /** Path under MODELS_BASE_URL. */
  file: 'faces/yunet-2023mar.onnx',
  sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  bytes: 232_589,
  /** Square input side, px. */
  size: 640,
} as const;

/** OpenCV's default is 0.9; lower, because a missed face is worse than a box the user turns off. */
export const FACE_THRESHOLD = 0.7;
const NMS_IOU = 0.3;
const STRIDES = [8, 16, 32] as const;
/** Overlap between tiles, input px: a face cut by one tile's edge is whole in the next. */
const OVERLAP = 128;
/** Tiles read at most at 4× the whole-photo detail, and never past the photo's own pixels. */
const MAX_LEVEL = 2;

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-1. */
  score: number;
}

/** A square of the photo read as one model input: its corner and side in photo px. */
export interface Tile {
  x: number;
  y: number;
  /** Photo px covered by the 640 px input (it may run past the photo's edge: that part is black). */
  side: number;
}

/** The squares a photo is read in: the whole photo, then finer tiles while they add detail. */
export function tilePlan(width: number, height: number): Tile[] {
  const longest = Math.max(width, height);
  const tiles: Tile[] = [{ x: 0, y: 0, side: longest }];
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const side = longest / 2 ** level;
    // Finer than the photo's own pixels adds nothing.
    if (side < YUNET.size) break;
    const overlap = (OVERLAP * side) / YUNET.size;
    const along = (length: number): number[] => {
      if (length <= side) return [0];
      const count = Math.ceil((length - overlap) / (side - overlap));
      const step = (length - side) / (count - 1);
      return Array.from({ length: count }, (_, i) => Math.round(i * step));
    };
    for (const y of along(height)) for (const x of along(width)) tiles.push({ x, y, side });
  }
  return tiles;
}

/**
 * RGBA pixels of one 640 × 640 input → the model's tensor: planar B, G, R,
 * 0-255, as OpenCV's blobFromImage makes it with no scaling or mean.
 */
export function toInput(rgba: Uint8ClampedArray | Uint8Array, size: number = YUNET.size) {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    out[i] = rgba[i * 4 + 2] ?? 0;
    out[plane + i] = rgba[i * 4 + 1] ?? 0;
    out[2 * plane + i] = rgba[i * 4] ?? 0;
  }
  return out;
}

/** The model's outputs by name: cls_8, obj_8, bbox_8 and so on. */
export type YunetOutputs = Record<string, ArrayLike<number>>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Decodes the outputs into boxes in input px, as OpenCV's FaceDetectorYN does:
 * per stride, each cell's score is √(class × objectness), its box centre is
 * offset from the cell and its size is exp() of the output, in strides.
 */
export function decodeFaces(
  outputs: YunetOutputs,
  threshold = FACE_THRESHOLD,
  size: number = YUNET.size,
): FaceBox[] {
  const faces: FaceBox[] = [];
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${String(stride)}`];
    const obj = outputs[`obj_${String(stride)}`];
    const bbox = outputs[`bbox_${String(stride)}`];
    if (!cls || !obj || !bbox) throw new Error(`The face model gave no stride ${String(stride)}`);
    const cols = size / stride;
    const rows = size / stride;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i] ?? 0) * clamp01(obj[i] ?? 0));
        if (score < threshold) continue;
        const cx = (c + (bbox[i * 4] ?? 0)) * stride;
        const cy = (r + (bbox[i * 4 + 1] ?? 0)) * stride;
        const w = Math.exp(bbox[i * 4 + 2] ?? 0) * stride;
        const h = Math.exp(bbox[i * 4 + 3] ?? 0) * stride;
        faces.push({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, score });
      }
    }
  }
  return faces;
}

/** Boxes found in a tile's input px → photo px. */
export function fromTile(faces: FaceBox[], tile: Tile, size: number = YUNET.size): FaceBox[] {
  const scale = tile.side / size;
  return faces.map((f) => ({
    x: tile.x + f.x * scale,
    y: tile.y + f.y * scale,
    width: f.width * scale,
    height: f.height * scale,
    score: f.score,
  }));
}

function overlap(a: FaceBox, b: FaceBox): { iou: number; ofSmaller: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return { iou: 0, ofSmaller: 0 };
  const inter = w * h;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return { iou: inter / (areaA + areaB - inter), ofSmaller: inter / Math.min(areaA, areaB) };
}

/**
 * One box per face: the best-scoring box wins over any that overlaps it
 * (IoU above 0.3), or that lies mostly inside it (a face cut by a tile's edge).
 * Clipped to the photo, sorted left to right then top to bottom.
 */
export function mergeFaces(faces: FaceBox[], width: number, height: number): FaceBox[] {
  const kept: FaceBox[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    const same = kept.some((k) => {
      const o = overlap(k, face);
      return o.iou > NMS_IOU || o.ofSmaller > 0.6;
    });
    if (!same) kept.push(face);
  }
  return kept
    .map((f) => {
      const x = Math.max(0, f.x);
      const y = Math.max(0, f.y);
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(Math.min(width, f.x + f.width) - x),
        height: Math.round(Math.min(height, f.y + f.height) - y),
        score: Math.round(f.score * 1000) / 1000,
      };
    })
    .filter((f) => f.width > 1 && f.height > 1)
    .sort((a, b) => a.x - b.x || a.y - b.y);
}
