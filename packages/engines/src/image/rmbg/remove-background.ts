/**
 * P07 Remove Background (tools/photo.md): picks the model this device can
 * run (quality on WebGPU with 16-bit floats, light on WASM), downloads it
 * once with progress into the models cache, checks its SHA-256, and runs it
 * in ./rmbg.worker.ts. A new background, edge or Refine setting for the same
 * photo reuses the last mask, so it takes a moment instead of a model run.
 */
import { EngineAbortError } from '../../dummy';
import type { Engine, EngineOutput, RunContext } from '../../types';
import { checkImage, ImageInputError } from '../image-codec';
import { fetchCached } from '../model-fetch';
import { sniffImage, type ImageFormat } from '../sniff';
import { parseStrokes } from './mask';
import { SEGMENT_MODELS, type SegmentModel } from './models';
import type { RmbgJob, RmbgMessage } from './rmbg.worker';
import { filesFor, modelCached, openCache, pickModel } from './support';

export const RMBG_LIMITS = { maxPixels: 24_000_000 };

export interface RemoveBackgroundOptions {
  background?: string;
  /** "#rrggbb" for the Color background. */
  color?: string;
  /** Object URL of the image to put behind the subject. */
  backgroundImage?: string;
  edges?: string;
  format?: string;
  /** "light" asks for light mode even where quality mode runs. */
  model?: string;
  /** Refine brush strokes, as JSON (see parseStrokes). */
  refine?: string;
  /** MODELS_BASE_URL, from the app: models and ONNX Runtime are served from there. */
  modelsBase?: string;
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(0);

/** Downloads (or reads from the cache) a model and its runtime, reporting "74 / 115 MB". */
async function loadFiles(model: SegmentModel, base: string, ctx: RunContext) {
  const files = filesFor(model, base);
  const cache = await openCache();
  const cached = await modelCached(model, base);
  let modelLoaded = 0;
  let wasmLoaded = 0;
  const report = () => {
    if (cached) return;
    const loaded = modelLoaded + wasmLoaded;
    ctx.progress(
      Math.min(0.6, (loaded / files.bytes) * 0.6),
      'Downloading the AI model, first time only',
      {
        amount: `${mb(loaded)} / ${mb(files.bytes)} MB`,
        step: 'Step 1 of 2 · then finding the subject',
      },
    );
  };
  report();
  const [modelBytes, wasmBytes] = await Promise.all([
    fetchCached(
      files.modelUrl,
      cache,
      ctx.signal,
      (n) => {
        modelLoaded = n;
        report();
      },
      model.sha256,
    ),
    fetchCached(files.wasmUrl, cache, ctx.signal, (n) => {
      wasmLoaded = n;
      report();
    }),
  ]);
  return { files, modelBytes, wasmBytes, cached };
}

let worker: Worker | null = null;
/** The model the current worker holds, so the file is sent once. */
let workerModel: string | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./rmbg.worker.ts', import.meta.url), { type: 'module' });
    workerModel = null;
  }
  return worker;
}

function dropWorker() {
  worker?.terminate();
  worker = null;
  workerModel = null;
}

function post(job: RmbgJob, ctx: RunContext) {
  return new Promise<Extract<RmbgMessage, { type: 'done' }> | 'need-files'>((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const current = getWorker();
    const onAbort = () => {
      // Inference can't be interrupted; the worker is replaced instead.
      dropWorker();
      reject(new EngineAbortError());
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    current.onmessage = (event: MessageEvent<RmbgMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        ctx.progress(0.6 + message.fraction * 0.4, message.stage);
        return;
      }
      ctx.signal.removeEventListener('abort', onAbort);
      if (message.type === 'need-files') resolve('need-files');
      else if (message.type === 'error') {
        reject(message.input ? new ImageInputError(message.message) : new Error(message.message));
      } else resolve(message);
    };
    current.onerror = (event) => {
      ctx.signal.removeEventListener('abort', onAbort);
      dropWorker();
      reject(new Error(event.message || 'The background removal stopped'));
    };
    const transfer = [job.image, job.model, job.wasmBinary, job.backdropImage?.bytes].filter(
      (b): b is ArrayBuffer => b instanceof ArrayBuffer,
    );
    current.postMessage(job, transfer);
  });
}

/** "#ff8800" → [255, 136, 0]; white for anything else. */
export function parseHex(value: string | undefined): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value ?? '')?.[1];
  if (!hex) return [255, 255, 255];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function backdropImage(url: string | undefined) {
  if (!url) return null;
  const bytes = await (await fetch(url)).arrayBuffer();
  const format = sniffImage(new Uint8Array(bytes));
  if (!format) throw new ImageInputError('The background image isn’t an image this tool can open');
  return { bytes, format };
}

const PATH_LABEL = { webgpu: 'WebGPU', wasm: 'WASM' } as const;

async function runWith(
  input: File | Blob,
  bytes: ArrayBuffer,
  format: ImageFormat,
  model: SegmentModel,
  opts: RemoveBackgroundOptions,
  ctx: RunContext,
): Promise<EngineOutput & { model: SegmentModel; cached: boolean }> {
  const base = opts.modelsBase ?? '/models';
  const loaded = workerModel === model.id ? null : await loadFiles(model, base, ctx);
  const files = loaded?.files ?? filesFor(model, base);
  const background = opts.background ?? 'transparent';
  const job = async (
    withFiles: Awaited<ReturnType<typeof loadFiles>> | null,
  ): Promise<RmbgJob> => ({
    image: bytes.slice(0),
    format,
    key: `${input instanceof File ? `${input.name}|${String(input.lastModified)}` : ''}|${String(input.size)}|${model.id}`,
    modelId: model.id,
    model: withFiles?.modelBytes ?? null,
    wasmBinary: withFiles?.wasmBytes ?? null,
    spec: model,
    ortUrl: files.ortUrl,
    wasmPaths: files.wasmPaths,
    provider: files.provider,
    backdrop:
      background === 'color' || background === 'blur' || background === 'image'
        ? background
        : 'transparent',
    color: parseHex(opts.color),
    backdropImage: background === 'image' ? await backdropImage(opts.backgroundImage) : null,
    edges: opts.edges === 'hard' ? 'hard' : 'soft',
    strokes: parseStrokes(opts.refine),
    output: opts.format === 'webp' ? 'webp' : 'png',
    maxPixels: RMBG_LIMITS.maxPixels,
  });
  let done = await post(await job(loaded), ctx);
  if (done === 'need-files') {
    // The worker was replaced since (a cancel): send the files again.
    done = await post(await job(await loadFiles(model, base, ctx)), ctx);
    if (done === 'need-files') throw new Error('The AI model didn’t load');
  }
  workerModel = model.id;
  const output = opts.format === 'webp' ? 'webp' : 'png';
  const notes: string[] = [];
  if (background === 'image' && !opts.backgroundImage) {
    notes.push('No background image was chosen, so the background is transparent');
  }
  return {
    blob: new Blob([done.bytes], { type: `image/${output}` }),
    ext: output,
    width: done.width,
    height: done.height,
    path: PATH_LABEL[files.provider],
    notes,
    details: [{ label: 'Model', value: model.id === 'u2netp' ? 'Light' : 'Quality' }],
    model,
    cached: loaded?.cached ?? true,
  };
}

export const removeBackgroundEngine: Engine<RemoveBackgroundOptions> = {
  capabilities: () => ({
    supported:
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function' &&
      typeof WebAssembly !== 'undefined',
    reason:
      'This browser is too old to run the AI model. Try a current Chrome, Edge, Firefox or Safari.',
  }),
  estimate: () => ({ seconds: 3 }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const model = await pickModel(opts.model);
    try {
      return await runWith(input, bytes, format, model, opts, ctx);
    } catch (error) {
      // Quality mode that can't load or run here falls back to light mode, and says so;
      // a problem with the photo itself would fail the same way in light mode.
      if (model.id === 'u2netp' || error instanceof EngineAbortError) throw error;
      if (error instanceof ImageInputError) throw error;
      dropWorker();
      const light = await runWith(input, bytes, format, SEGMENT_MODELS.u2netp, opts, ctx);
      return {
        ...light,
        notes: [
          `Quality mode couldn’t run on this device (${error instanceof Error ? error.message : 'unknown error'}), so Light mode was used`,
          ...(light.notes ?? []),
        ],
      };
    }
  },
};
