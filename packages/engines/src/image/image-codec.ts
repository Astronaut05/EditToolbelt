/**
 * `image-codec` engine: P05 Compress Image and P06 Image Converter.
 * The main thread checks the file (magic bytes, 200 MB, 100 MP from the
 * header) and hands it to a worker that decodes and encodes.
 */
import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import {
  OUTPUT_EXT,
  OUTPUT_MIME,
  type ImageJob,
  type OutputFormat,
  type WorkerMessage,
} from './protocol';
import { FORMAT_LABELS, headerSize, sniffImage, type ImageFormat } from './sniff';

/** tools/photo.md → Limits (browser). */
export const IMAGE_LIMITS = { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 };

export interface ImageCodecOptions {
  /** keep, jpeg, png, webp, avif, bmp */
  format?: string;
  /** 1-100 */
  quality?: string;
  /** Fill for transparency in JPG: white or black. */
  background?: string;
  /** keep (camera EXIF, no GPS) or none */
  metadata?: string;
  /** quality or target */
  mode?: string;
  /** Target size in KB, with mode "target". */
  targetKb?: string;
  /** Longest side in px, or "" for none. */
  maxSide?: string;
  /** Compress: return the original when re-encoding would grow it. */
  neverGrow?: boolean;
}

const OUTPUTS: readonly OutputFormat[] = ['jpeg', 'png', 'webp', 'avif', 'bmp'];

/** "Keep format" for each source; formats we can't write become JPG (photos) or PNG (graphics). */
const KEEP: Record<ImageFormat, OutputFormat> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
  gif: 'png',
  tiff: 'jpeg',
  heic: 'jpeg',
};

const BACKGROUNDS: Record<string, string> = { white: '#ffffff', black: '#000000' };

/** The format the user picked, or what "Keep" means for this source. */
export function pickOutput(choice: string | undefined, source: ImageFormat): OutputFormat {
  return choice && (OUTPUTS as readonly string[]).includes(choice)
    ? (choice as OutputFormat)
    : KEEP[source];
}

/** The shared settings every image job carries, from the tool's options. */
export function baseJob(
  bytes: ArrayBuffer,
  format: ImageFormat,
  opts: Pick<ImageCodecOptions, 'format' | 'quality' | 'background' | 'metadata'>,
): ImageJob {
  const output = pickOutput(opts.format, format);
  const quality = Number(opts.quality);
  return {
    bytes,
    format,
    output,
    quality: Number.isFinite(quality) && quality >= 1 && quality <= 100 ? quality : 80,
    background: BACKGROUNDS[opts.background ?? 'white'] ?? '#ffffff',
    metadata: opts.metadata === 'none' ? 'none' : 'keep',
    optimise: output === 'png',
  };
}

export class ImageInputError extends Error {}

/** Checks a file before decoding: the format by its bytes, then the limits. */
export function checkImage(bytes: Uint8Array, size: number): ImageFormat {
  const format = sniffImage(bytes);
  if (!format) {
    throw new ImageInputError(
      'This isn’t an image this tool can read. Try JPG, PNG, WebP, AVIF, GIF, BMP, TIFF or HEIC.',
    );
  }
  if (size > IMAGE_LIMITS.maxBytes) {
    throw new ImageInputError(
      `This file is ${String(Math.round(size / 1048576))} MB; the browser limit is 200 MB.`,
    );
  }
  const dims = headerSize(bytes, format);
  if (dims && dims.width * dims.height > IMAGE_LIMITS.maxPixels) {
    const mp = ((dims.width * dims.height) / 1e6).toFixed(0);
    throw new ImageInputError(
      `This image is ${String(dims.width)} × ${String(dims.height)} px (${mp} MP); the browser limit is 100 MP.`,
    );
  }
  return format;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Runs a job in the shared image worker; aborting replaces the worker. */
export function runImageJob(
  job: ImageJob,
  signal: AbortSignal,
  progress: (fraction: number, stage?: string) => void,
) {
  return new Promise<Extract<WorkerMessage, { type: 'done' }>>((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const current = getWorker();
    const onAbort = () => {
      // A running encode can't be interrupted; the worker is replaced instead.
      current.terminate();
      worker = null;
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    current.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progress(message.fraction, message.stage);
        return;
      }
      signal.removeEventListener('abort', onAbort);
      if (message.type === 'error') reject(new ImageInputError(message.message));
      else resolve(message);
    };
    current.onerror = (event) => {
      signal.removeEventListener('abort', onAbort);
      current.terminate();
      worker = null;
      reject(new Error(event.message || 'The image worker stopped'));
    };
    current.postMessage(job, [job.bytes]);
  });
}

/** Size change as it reads best: "−62%", "+34%", or "151× larger". */
export function sizeChange(before: number, after: number): string {
  const ratio = after / before;
  if (ratio >= 2) return `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}× larger`;
  const change = Math.round((ratio - 1) * 100);
  return change < 0 ? `−${String(-change)}%` : `+${String(change)}%`;
}

export const imageCodecEngine: Engine<ImageCodecOptions> = {
  capabilities: () => ({
    supported: typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function',
    reason:
      'This browser is too old for in-browser image processing. Try a current Chrome, Firefox or Safari.',
  }),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 4_000_000) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const targetKb = opts.mode === 'target' ? Number(opts.targetKb) : NaN;
    const maxSide = Number(opts.maxSide);
    const done = await runImageJob(
      {
        ...baseJob(bytes, format, opts),
        maxSide: Number.isFinite(maxSide) && maxSide > 0 ? maxSide : undefined,
        targetBytes: Number.isFinite(targetKb) && targetKb > 0 ? targetKb * 1000 : undefined,
        neverGrow: opts.neverGrow,
      },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    return imageOutput(done, format, input.size);
  },
};

/** The engine result for a finished job: file, size, notes and readout facts. */
export function imageOutput(
  done: Extract<WorkerMessage, { type: 'done' }>,
  format: ImageFormat,
  inputSize: number,
): EngineOutput {
  return {
    blob: new Blob([done.bytes], { type: OUTPUT_MIME[done.output] }),
    ext: OUTPUT_EXT[done.output],
    width: done.width,
    height: done.height,
    path: 'Browser · WASM',
    notes: done.notes,
    details: [
      {
        label: 'Formats',
        value: `${FORMAT_LABELS[format]} → ${OUTPUT_EXT[done.output].toUpperCase()}`,
      },
      ...(done.quality === undefined
        ? []
        : [{ label: 'Quality', value: `Quality ${String(done.quality)}` }]),
      { label: 'Change', value: sizeChange(inputSize, done.bytes.byteLength) },
    ],
  };
}
