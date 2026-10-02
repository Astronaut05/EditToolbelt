/**
 * P12's face finder worker: reads the photo in the squares tilePlan picks,
 * runs YuNet on each with ONNX Runtime Web (WASM), and merges the boxes.
 * ONNX Runtime loads from MODELS_BASE_URL at run time, as for P07; the
 * session is kept, so a second photo doesn't load the model again.
 */
import type * as Ort from 'onnxruntime-web';

import { decodeFaces, fromTile, mergeFaces, tilePlan, toInput, YUNET, type FaceBox } from './yunet';

export interface FacesJob {
  bitmap: ImageBitmap;
  /** The model file and ONNX Runtime's WASM, sent the first time this worker needs them. */
  model: ArrayBuffer | null;
  wasmBinary: ArrayBuffer | null;
  ortUrl: string;
  wasmPaths: string;
}

export type FacesMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; faces: FaceBox[] }
  | { type: 'need-files' }
  | { type: 'error'; message: string };

interface WorkerScope {
  postMessage(message: FacesMessage): void;
  onmessage: ((event: MessageEvent<FacesJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

class NeedFiles extends Error {}

let session: Promise<{ ort: typeof Ort; session: Ort.InferenceSession }> | null = null;

function load(job: FacesJob) {
  if (!session) {
    const { model, wasmBinary } = job;
    if (!model || !wasmBinary) throw new NeedFiles();
    session = (
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ job.ortUrl) as Promise<
        typeof Ort
      >
    ).then(async (ort) => {
      ort.env.wasm.wasmPaths = job.wasmPaths;
      ort.env.wasm.wasmBinary = wasmBinary;
      // One thread: tool pages aren't cross-origin isolated, so no SharedArrayBuffer.
      ort.env.wasm.numThreads = 1;
      return {
        ort,
        session: await ort.InferenceSession.create(new Uint8Array(model), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        }),
      };
    });
    // A failed load is tried again next time, with the files sent again.
    session.catch(() => {
      session = null;
    });
  }
  return session;
}

async function run(job: FacesJob): Promise<FaceBox[]> {
  const { ort, session: model } = await load(job);
  const { bitmap } = job;
  const size = YUNET.size;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const tiles = tilePlan(bitmap.width, bitmap.height);
  const found: FaceBox[] = [];
  for (const [index, tile] of tiles.entries()) {
    // Past the photo's edge the input stays black, as OpenCV pads it.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const w = Math.min(tile.side, bitmap.width - tile.x);
    const h = Math.min(tile.side, bitmap.height - tile.y);
    const k = size / tile.side;
    ctx.drawImage(bitmap, tile.x, tile.y, w, h, 0, 0, w * k, h * k);
    const input = toInput(ctx.getImageData(0, 0, size, size).data);
    const result = await model.run({
      [model.inputNames[0] ?? 'input']: new ort.Tensor('float32', input, [1, 3, size, size]),
    });
    const outputs = Object.fromEntries(
      Object.entries(result).map(([name, tensor]) => [name, tensor.data as Float32Array]),
    );
    found.push(...fromTile(decodeFaces(outputs), tile));
    scope.postMessage({ type: 'progress', done: index + 1, total: tiles.length });
  }
  const faces = mergeFaces(found, bitmap.width, bitmap.height);
  bitmap.close();
  return faces;
}

scope.onmessage = (event) => {
  run(event.data).then(
    (faces) => {
      scope.postMessage({ type: 'done', faces });
    },
    (error: unknown) => {
      event.data.bitmap.close();
      if (error instanceof NeedFiles) {
        scope.postMessage({ type: 'need-files' });
        return;
      }
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    },
  );
};
