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
import { sniffImage, type ImageFormat } from '../sniff';
import { parseStrokes } from './mask';
import { ORT_BUILDS, ORT_VERSION, SEGMENT_MODELS, type SegmentModel } from './models';
import type { RmbgJob, RmbgMessage } from './rmbg.worker';

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

/** Cache Storage name shared with the service worker (apps/web/scripts/sw.ts). */
const MODELS_CACHE = 'etb-models';

/** `base` without trailing slashes, then `/file`. A loop, not a regex: the base comes from config. */
function join(base: string, file: string): string {
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end -= 1;
  return `${base.slice(0, end)}/${file}`;
}

let f16: Promise<boolean> | null = null;

/** Whether quality mode can run here: WebGPU with 16-bit float shaders. */
export function canRunQuality(): Promise<boolean> {
  f16 ??= (async () => {
    // Typed as always there, but missing in Firefox and Safari without WebGPU.
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      const adapter = (await gpu.requestAdapter()) as { features: Set<string> } | null;
      return adapter?.features.has('shader-f16') ?? false;
    } catch {
      return false;
    }
  })();
  return f16;
}

/** The model a run will use: quality where it runs, unless light mode is asked for. */
export async function pickModel(preference: string | undefined): Promise<SegmentModel> {
  if (preference !== 'light' && (await canRunQuality())) return SEGMENT_MODELS['birefnet-lite'];
  return SEGMENT_MODELS.u2netp;
}

/** The files a model needs: itself and the ONNX Runtime build for its backend. */
function filesFor(model: SegmentModel, base: string) {
  const build = model.needs === 'webgpu-f16' ? ORT_BUILDS.webgpu : ORT_BUILDS.wasm;
  const ortBase = join(base, `ort/${ORT_VERSION}`);
  const wasm = build.files.find((file) => file.endsWith('.wasm')) ?? '';
  return {
    provider: model.needs === 'webgpu-f16' ? ('webgpu' as const) : ('wasm' as const),
    modelUrl: join(base, model.file),
    ortUrl: join(ortBase, build.module),
    wasmPaths: `${ortBase}/`,
    wasmUrl: join(ortBase, wasm),
    bytes: model.bytes + build.bytes,
    runtimeBytes: build.bytes,
  };
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MODELS_CACHE);
  } catch {
    return null; // Not a secure context, or storage is blocked.
  }
}

/** Whether a model and its runtime are already on this device. */
export async function modelCached(model: SegmentModel, base: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  const files = filesFor(model, base);
  const hits = await Promise.all([cache.match(files.modelUrl), cache.match(files.wasmUrl)]);
  return hits.every(Boolean);
}

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !('subtle' in crypto)) return null;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class ModelUnavailable extends Error {}

/** One file from the models cache, or downloaded into it with progress. */
async function fetchCached(
  url: string,
  cache: Cache | null,
  signal: AbortSignal,
  onBytes: (loaded: number) => void,
  expected?: string | null,
): Promise<ArrayBuffer> {
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = await hit.arrayBuffer();
    onBytes(bytes.byteLength);
    return bytes;
  }
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw new EngineAbortError();
    throw new ModelUnavailable(error instanceof Error ? error.message : 'network error');
  }
  if (!response.ok || !response.body) {
    throw new ModelUnavailable(`HTTP ${String(response.status)}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expected) {
    const actual = await sha256(bytes.buffer);
    if (actual && actual !== expected) {
      throw new ModelUnavailable('the file doesn’t match its checksum');
    }
  }
  await cache
    ?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }))
    .catch(() => undefined);
  return bytes.buffer;
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
