/**
 * The background-removal worker: decodes the photo, runs the model with
 * ONNX Runtime Web (WebGPU in quality mode, WASM in light mode), refines the
 * mask against the photo with a guided filter, paints the Refine strokes and
 * composites the result. ONNX Runtime loads from MODELS_BASE_URL at run time,
 * never from the app bundle (no host in code; its WASM is 14 to 27 MB).
 * The last mask is kept, so a new background or edge setting doesn't run the
 * model again.
 */
import type * as Ort from 'onnxruntime-web';

import {
  composite,
  fromHalf,
  guidedFilter,
  hardenMask,
  luminance,
  paintStrokes,
  resizeMask,
  toHalf,
  toMask,
  toTensor,
  type Backdrop,
  type Stroke,
} from './mask';
import { decodeImage, ImageReadError } from '../decode';
import type { ImageFormat } from '../sniff';
import type { SegmentModel } from './models';

export interface RmbgJob {
  image: ArrayBuffer;
  format: ImageFormat;
  /** The photo and model: the same key reuses the last mask. */
  key: string;
  modelId: SegmentModel['id'];
  /** The model file and ONNX Runtime's WASM, sent the first time this worker needs them. */
  model: ArrayBuffer | null;
  wasmBinary: ArrayBuffer | null;
  spec: Pick<SegmentModel, 'size' | 'mean' | 'std' | 'output'>;
  /** ONNX Runtime's module URL, and the folder its WASM files are in. */
  ortUrl: string;
  wasmPaths: string;
  provider: 'webgpu' | 'wasm';
  backdrop: 'transparent' | 'color' | 'blur' | 'image';
  color: [number, number, number];
  backdropImage: { bytes: ArrayBuffer; format: ImageFormat } | null;
  edges: 'soft' | 'hard';
  strokes: Stroke[];
  output: 'png' | 'webp';
  maxPixels: number;
}

export type RmbgMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'done'; bytes: ArrayBuffer; width: number; height: number; reused: boolean }
  | { type: 'need-files' }
  /** input: a problem with the photo (light mode would fail too); otherwise the model or runtime. */
  | { type: 'error'; message: string; input: boolean };

interface WorkerScope {
  postMessage(message: RmbgMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<RmbgJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (message: RmbgMessage, transfer: Transferable[] = []) => {
  scope.postMessage(message, transfer);
};

class RmbgError extends Error {}
/** The worker was started fresh (or switched model) and needs the files sent again. */
class NeedFiles extends Error {}

function canvas2d(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function pixels(source: CanvasImageSource, width: number, height: number): ImageData {
  const { ctx } = canvas2d(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** A soft blur of the photo for "Blur": down to 1/24, then back up. */
function blurred(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const small = canvas2d(Math.max(1, Math.round(width / 24)), Math.max(1, Math.round(height / 24)));
  small.ctx.drawImage(bitmap, 0, 0, small.canvas.width, small.canvas.height);
  return pixels(small.canvas, width, height);
}

/** Another image behind the subject, scaled to cover the photo and centred. */
function covering(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const { ctx } = canvas2d(width, height);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  return ctx.getImageData(0, 0, width, height);
}

const runtimes = new Map<string, Promise<typeof Ort>>();
let session: { id: string; session: Ort.InferenceSession } | null = null;
let last: { key: string; mask: Float32Array } | null = null;

function loadOrt(job: RmbgJob): Promise<typeof Ort> {
  let runtime = runtimes.get(job.ortUrl);
  if (!runtime) {
    const { wasmBinary } = job;
    if (!wasmBinary) throw new NeedFiles();
    runtime = (
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ job.ortUrl) as Promise<
        typeof Ort
      >
    ).then((ort) => {
      ort.env.wasm.wasmPaths = job.wasmPaths;
      // Downloaded (and cached) by the page with progress, so it isn't fetched twice.
      ort.env.wasm.wasmBinary = wasmBinary;
      // One thread: tool pages aren't cross-origin isolated, so no SharedArrayBuffer.
      ort.env.wasm.numThreads = 1;
      return ort;
    });
    // A failed load (offline, say) is tried again next time.
    runtime.catch(() => runtimes.delete(job.ortUrl));
    runtimes.set(job.ortUrl, runtime);
  }
  return runtime;
}

/** Runs the model on the photo at its input size; 16-bit models get 16-bit input. */
async function segment(job: RmbgJob, rgba: Uint8ClampedArray): Promise<Float32Array> {
  const ort = await loadOrt(job);
  if (session?.id !== job.modelId) {
    if (!job.model) throw new NeedFiles();
    await session?.session.release();
    session = null;
    session = {
      id: job.modelId,
      session: await ort.InferenceSession.create(new Uint8Array(job.model), {
        executionProviders: [job.provider],
        graphOptimizationLevel: 'all',
      }),
    };
  }
  const s = session.session;
  const { size, mean, std, output } = job.spec;
  const input = toTensor(rgba, size, mean, std);
  const name = s.inputNames[0] ?? 'input';
  const meta = s.inputMetadata.find((m) => m.name === name);
  const half = meta?.isTensor === true && meta.type === 'float16';
  const tensor = half
    ? new ort.Tensor('float16', toHalf(input), [1, 3, size, size])
    : new ort.Tensor('float32', input, [1, 3, size, size]);
  const result = await s.run({ [name]: tensor });
  const out = result[s.outputNames[0] ?? ''];
  if (!out) throw new Error('The model returned nothing');
  const data =
    out.type === 'float16' && out.data instanceof Uint16Array
      ? fromHalf(out.data)
      : Float32Array.from(out.data as ArrayLike<number>);
  // Some exports return several side outputs at once: the first plane is the final mask.
  return toMask(data.subarray(0, size * size), output);
}

async function run(job: RmbgJob): Promise<Extract<RmbgMessage, { type: 'done' }>> {
  post({ type: 'progress', fraction: 0.02, stage: 'Reading the photo' });
  const bitmap = await decodeImage(job.image, job.format);
  const { width, height } = bitmap;
  if (width * height > job.maxPixels) {
    bitmap.close();
    throw new RmbgError(
      `This photo is ${((width * height) / 1e6).toFixed(1)} MP; up to ${String(job.maxPixels / 1e6)} MP works in the browser. Make it smaller with Resize Image first`,
    );
  }

  const size = job.spec.size;
  const reused = last?.key === job.key;
  let lowMask: Float32Array;
  if (last && reused) {
    lowMask = last.mask;
  } else {
    post({ type: 'progress', fraction: 0.1, stage: 'Finding the subject' });
    lowMask = await segment(job, pixels(bitmap, size, size).data);
    last = { key: job.key, mask: lowMask };
  }

  // Edges: refine at up to 2048 px against the photo, then scale to full size.
  post({ type: 'progress', fraction: 0.7, stage: 'Refining the edges' });
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const ww = Math.max(1, Math.round(width * scale));
  const wh = Math.max(1, Math.round(height * scale));
  const guide = luminance(pixels(bitmap, ww, wh).data);
  const radius = Math.max(2, Math.round(Math.max(ww, wh) / 256));
  let mask = guidedFilter(guide, resizeMask(lowMask, size, size, ww, wh), ww, wh, radius, 1e-4);
  if (job.edges === 'hard') mask = hardenMask(mask);
  let full = scale < 1 ? resizeMask(mask, ww, wh, width, height) : mask;
  if (job.strokes.length) full = paintStrokes(full, width, height, job.strokes);

  post({ type: 'progress', fraction: 0.85, stage: 'Making the image' });
  const photo = pixels(bitmap, width, height);
  let backdrop: Backdrop;
  if (job.backdrop === 'blur') {
    backdrop = { kind: 'pixels', rgba: blurred(bitmap, width, height).data };
  } else if (job.backdrop === 'image' && job.backdropImage) {
    let behind: ImageBitmap;
    try {
      behind = await decodeImage(job.backdropImage.bytes, job.backdropImage.format);
    } catch (error) {
      throw new RmbgError(
        `The background image didn’t open. ${error instanceof Error ? error.message : ''}`.trim(),
      );
    }
    backdrop = { kind: 'pixels', rgba: covering(behind, width, height).data };
    behind.close();
  } else if (job.backdrop === 'color') {
    backdrop = { kind: 'color', rgb: job.color };
  } else {
    backdrop = { kind: 'transparent' };
  }
  bitmap.close();
  const out = new ImageData(composite(photo.data, full, backdrop), width, height);

  post({ type: 'progress', fraction: 0.93, stage: 'Saving' });
  let bytes: ArrayBuffer;
  if (job.output === 'webp') {
    const { default: encode } = await import('@jsquash/webp/encode');
    bytes = await encode(out, { quality: 90 });
  } else {
    const { canvas, ctx } = canvas2d(width, height);
    ctx.putImageData(out, 0, 0);
    bytes = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  }
  return { type: 'done', bytes, width, height, reused };
}

scope.onmessage = (event) => {
  run(event.data).then(
    (done) => {
      post(done, [done.bytes]);
    },
    (error: unknown) => {
      if (error instanceof NeedFiles) {
        post({ type: 'need-files' });
        return;
      }
      const input = error instanceof RmbgError || error instanceof ImageReadError;
      post({
        type: 'error',
        input,
        message: input
          ? error.message
          : `The background couldn’t be removed: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    },
  );
};
