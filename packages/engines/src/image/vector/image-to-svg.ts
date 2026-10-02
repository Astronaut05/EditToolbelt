/**
 * `image-vector` for P19 Image to SVG (tools/photo.md): our own tracer
 * (@etb/core/vectorize) in ./vector.worker.ts. The SVG holds nothing but
 * filled paths: no scripts, no embedded images, no links.
 */
import type { TraceOptions } from '@etb/core/vectorize';

import { EngineAbortError } from '../../dummy';
import type { Engine, EngineOutput } from '../../types';
import { checkImage, ImageInputError } from '../image-codec';
import type { VectorJob, VectorMessage } from './vector.worker';

export interface ImageToSvgOptions {
  /** color or bw. */
  mode?: string;
  /** 2-16, colour mode. */
  colors?: string;
  /** low, medium or high: the smallest shape kept. */
  detail?: string;
  /** pixels, sharp or smooth. */
  smoothness?: string;
}

/** The longest side traced: plenty for a logo, and the trace stays a second or two. */
export const MAX_TRACE_SIDE = 2000;

/** Shapes smaller than this many pixels (at the traced size) join a neighbour. */
export const DETAIL_AREA: Record<string, number> = { low: 64, medium: 16, high: 4 };

const SMOOTHNESS: Record<string, Pick<TraceOptions, 'tolerance' | 'cornerAngle' | 'exact'>> = {
  pixels: { tolerance: 0, cornerAngle: 0, exact: true },
  sharp: { tolerance: 0.75, cornerAngle: 40 },
  smooth: { tolerance: 1, cornerAngle: 60 },
};

/** The trace settings from the page's options. */
export function traceOptions(opts: ImageToSvgOptions): TraceOptions {
  const colors = Number(opts.colors);
  return {
    mode: opts.mode === 'bw' ? 'bw' : 'color',
    colors: Number.isFinite(colors) ? Math.min(16, Math.max(2, Math.round(colors))) : 6,
    minArea: DETAIL_AREA[opts.detail ?? 'medium'] ?? 16,
    ...(SMOOTHNESS[opts.smoothness ?? 'smooth'] ?? SMOOTHNESS.smooth),
  } as TraceOptions;
}

function trace(job: VectorJob, signal: AbortSignal, progress: (f: number, stage: string) => void) {
  return new Promise<Extract<VectorMessage, { type: 'done' }>>((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const worker = new Worker(new URL('./vector.worker.ts', import.meta.url), { type: 'module' });
    const onAbort = () => {
      worker.terminate();
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<VectorMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progress(message.fraction, message.stage);
        return;
      }
      finish();
      if (message.type === 'done') resolve(message);
      else reject(new ImageInputError(message.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The tracer stopped'));
    };
    worker.postMessage(job, [job.bytes]);
  });
}

export const imageToSvgEngine: Engine<ImageToSvgOptions> = {
  capabilities: () => ({
    supported:
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function',
    reason: 'This browser can’t trace images here. Try a current Chrome, Edge, Firefox or Safari.',
  }),
  estimate: (input) => ({ seconds: Math.max(1, Math.min(8, input.size / 1_500_000)) }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const bytes = await input.arrayBuffer();
    const format = checkImage(new Uint8Array(bytes), input.size);
    const options = traceOptions(opts);
    const done = await trace(
      { bytes, format, options, maxSide: MAX_TRACE_SIDE },
      ctx.signal,
      (fraction, stage) => {
        ctx.progress(fraction, stage);
      },
    );
    ctx.progress(1, 'Done');
    const blob = new Blob([done.svg], { type: 'image/svg+xml' });
    const scaled = done.tracedWidth !== done.width;
    const colourCount = done.colours.length;
    return {
      blob,
      ext: 'svg',
      width: done.width,
      height: done.height,
      path: 'Browser',
      notes: [
        options.mode === 'bw'
          ? 'Black shapes, the white left transparent'
          : `${String(colourCount)} ${colourCount === 1 ? 'colour' : 'colours'}`,
        ...(scaled
          ? [
              `Traced at ${String(done.tracedWidth)} × ${String(done.tracedHeight)} px, drawn at ${String(done.width)} × ${String(done.height)} px`,
            ]
          : []),
      ],
      details: [
        { label: 'Colours', value: options.mode === 'bw' ? 'Black' : String(colourCount) },
        { label: 'Smallest shape', value: `${String(options.minArea)} px` },
      ],
    };
  },
};
