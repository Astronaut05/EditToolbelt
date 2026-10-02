/**
 * P12's "Find faces": downloads the face model and ONNX Runtime's WASM once
 * into the models cache (shared with Remove Background, so a device that has
 * one has most of the other), checks the model's SHA-256, and runs the
 * detector in ./faces.worker.ts. Loaded only when the button is pressed.
 */
import { EngineAbortError } from '../../dummy';
import { fetchCached, ModelUnavailable } from '../model-fetch';
import { ORT_BUILDS, ORT_VERSION } from '../rmbg/models';
import { join, openCache } from '../rmbg/support';
import type { FacesJob, FacesMessage } from './faces.worker';
import { YUNET, type FaceBox } from './yunet';

export interface FindProgress {
  label: string;
  /** "3 / 15 MB" while downloading, "Part 4 of 27" while reading the photo. */
  amount?: string;
  /** 0-1. */
  fraction: number;
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(0);

let worker: Worker | null = null;
/** Whether the current worker has the model loaded, so the files are sent once. */
let ready = false;

function dropWorker() {
  worker?.terminate();
  worker = null;
  ready = false;
}

function files(base: string) {
  const build = ORT_BUILDS.wasm;
  const ortBase = join(base, `ort/${ORT_VERSION}`);
  return {
    model: join(base, YUNET.file),
    ortUrl: join(ortBase, build.module),
    wasmPaths: `${ortBase}/`,
    wasm: join(ortBase, build.files.find((file) => file.endsWith('.wasm')) ?? ''),
    bytes: YUNET.bytes + build.bytes,
  };
}

async function download(
  base: string,
  signal: AbortSignal,
  onProgress: (progress: FindProgress) => void,
) {
  const where = files(base);
  const cache = await openCache();
  let model = 0;
  let wasm = 0;
  const report = () => {
    const loaded = model + wasm;
    onProgress({
      label: 'Downloading the face finder, first time only',
      amount: `${mb(loaded)} / ${mb(where.bytes)} MB`,
      fraction: Math.min(0.5, (loaded / where.bytes) * 0.5),
    });
  };
  try {
    const [modelBytes, wasmBinary] = await Promise.all([
      fetchCached(
        where.model,
        cache,
        signal,
        (n) => {
          model = n;
          report();
        },
        YUNET.sha256,
      ),
      fetchCached(where.wasm, cache, signal, (n) => {
        wasm = n;
        report();
      }),
    ]);
    return { model: modelBytes, wasmBinary };
  } catch (error) {
    if (error instanceof ModelUnavailable) {
      throw new Error(`The face finder didn’t load (${error.message})`, { cause: error });
    }
    throw error;
  }
}

function post(
  job: FacesJob,
  signal: AbortSignal,
  onProgress: (progress: FindProgress) => void,
): Promise<FaceBox[] | 'need-files'> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      job.bitmap.close();
      reject(new EngineAbortError());
      return;
    }
    worker ??= new Worker(new URL('./faces.worker.ts', import.meta.url), { type: 'module' });
    const current = worker;
    const onAbort = () => {
      // A model run can't be interrupted; the worker is replaced instead.
      dropWorker();
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    current.onmessage = (event: MessageEvent<FacesMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress({
          label: 'Finding faces',
          amount: `Part ${String(message.done)} of ${String(message.total)}`,
          fraction: 0.5 + (message.done / message.total) * 0.5,
        });
        return;
      }
      signal.removeEventListener('abort', onAbort);
      if (message.type === 'need-files') resolve('need-files');
      else if (message.type === 'error') {
        dropWorker();
        reject(new Error(`Faces couldn’t be found: ${message.message}`));
      } else resolve(message.faces);
    };
    current.onerror = (event) => {
      signal.removeEventListener('abort', onAbort);
      dropWorker();
      reject(new Error(event.message || 'The face finder stopped'));
    };
    const transfer: Transferable[] = [job.bitmap];
    if (job.model) transfer.push(job.model);
    if (job.wasmBinary) transfer.push(job.wasmBinary);
    current.postMessage(job, transfer);
  });
}

/**
 * The faces in a photo, as boxes in its own pixels (orientation applied, as
 * the editor shows it), left to right. `photo` is the editor's decoded image
 * (or a file); `base` is MODELS_BASE_URL.
 */
export async function findFaces(
  photo: ImageBitmapSource,
  base: string,
  signal: AbortSignal,
  onProgress: (progress: FindProgress) => void,
): Promise<FaceBox[]> {
  const where = files(base);
  const job = async (withFiles: boolean): Promise<FacesJob> => {
    const loaded = withFiles ? await download(base, signal, onProgress) : null;
    return {
      bitmap: await createImageBitmap(photo),
      model: loaded?.model ?? null,
      wasmBinary: loaded?.wasmBinary ?? null,
      ortUrl: where.ortUrl,
      wasmPaths: where.wasmPaths,
    };
  };
  let found = await post(await job(!ready), signal, onProgress);
  if (found === 'need-files') {
    found = await post(await job(true), signal, onProgress);
    if (found === 'need-files') throw new Error('The face finder didn’t load');
  }
  ready = true;
  return found;
}

export type { FaceBox };
