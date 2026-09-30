/**
 * V04 Video to GIF: frames are decoded at the chosen rate and size with the
 * browser's video decoder, then quantised and written in a worker
 * (./gif/gif.worker.ts). Speed samples the clip faster or slower while the
 * GIF plays at the chosen frame rate.
 */
import { CanvasSink } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import type { GifJob, GifMessage } from './gif/gif.worker';
import { codecLabel, MediaInputError, openInput } from './media';
import { checkRange } from './trim';

export interface VideoToGifOptions {
  start?: number;
  end?: number;
  /** Frames per second, 5-30. */
  fps?: string;
  /** Width in px, or "original". */
  width?: string;
  /** forever, once, or a number of plays. */
  plays?: string;
  /** 0.5, 1, 1.5, 2 */
  speed?: string;
  /** global or frame */
  palette?: string;
  /** on or off */
  dither?: string;
  /** gif or webp */
  format?: string;
}

export const GIF_LIMITS = {
  maxFrames: 600,
  maxFrameBytes: 400 * 1024 * 1024,
  warnBytes: 15 * 1024 * 1024,
};

/** The frame size for a width, keeping the shape; no upscaling. */
export function gifSize(source: { width: number; height: number }, wanted: string | undefined) {
  const target = Number(wanted);
  const width = Math.min(
    source.width,
    Number.isFinite(target) && target > 0 ? target : Math.min(source.width, 1280),
  );
  return {
    width: Math.round(width),
    height: Math.max(1, Math.round((source.height * width) / source.width)),
  };
}

/** How many frames a range makes at a rate and speed. */
export function gifFrameCount(seconds: number, fps: number, speed: number): number {
  return Math.max(1, Math.floor((seconds / speed) * fps + 1e-6));
}

/** A rough size before starting: bytes per pixel per frame seen on dithered video GIFs. */
export function estimateGifBytes(frames: number, width: number, height: number): number {
  return Math.round(frames * width * height * 0.45);
}

function runWorker(job: GifJob, signal: AbortSignal, progress: (fraction: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(new URL('./gif/gif.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.onmessage = (event: MessageEvent<GifMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progress(message.fraction);
        return;
      }
      signal.removeEventListener('abort', stop);
      worker.terminate();
      if (message.type === 'done') resolve(message.bytes);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      reject(new Error(event.message || 'The GIF worker stopped'));
    };
    worker.postMessage(job, job.frames);
  });
}

export const videoToGifEngine: Engine<VideoToGifOptions> = {
  capabilities: () => ({
    supported: typeof VideoDecoder === 'function' && typeof OffscreenCanvas !== 'undefined',
    reason:
      'This browser can’t read video frames yet. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input) => ({ seconds: Math.max(2, input.size / 20_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new MediaInputError('This file has no video to turn into a GIF.');
      if (!(await track.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode ${codecLabel(await track.getCodec())} video, so it can’t make frames from it. Try Chrome, Edge or Safari.`,
        );
      }
      const duration = await input.computeDuration();
      const [start, end] = checkRange(opts.start ?? 0, opts.end ?? Math.min(duration, 5), duration);
      const fps = Math.min(30, Math.max(5, Number(opts.fps) || 12));
      const speed = Math.min(4, Math.max(0.25, Number(opts.speed) || 1));
      const size = gifSize(
        { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() },
        opts.width,
      );
      const count = gifFrameCount(end - start, fps, speed);
      if (
        count > GIF_LIMITS.maxFrames ||
        count * size.width * size.height * 4 > GIF_LIMITS.maxFrameBytes
      ) {
        throw new MediaInputError(
          `That’s ${String(count)} frames at ${String(size.width)} px wide, more than a browser can hold. Pick a shorter range, fewer frames per second or a smaller width.`,
        );
      }

      // Frames at the chosen rate, scaled on the GPU by the sink.
      const sink = new CanvasSink(track, {
        width: size.width,
        height: size.height,
        fit: 'fill',
        poolSize: 2,
      });
      const times = Array.from({ length: count }, (_, i) => start + (i * speed) / fps);
      const frames: ArrayBuffer[] = [];
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        if (ctx.signal.aborted) throw new EngineAbortError();
        const canvas = frame?.canvas;
        const g =
          canvas instanceof OffscreenCanvas
            ? canvas.getContext('2d')
            : (canvas?.getContext('2d') ?? null);
        if (!g) throw new Error('No 2D canvas for the frames');
        frames.push(g.getImageData(0, 0, size.width, size.height).data.buffer.slice(0));
        ctx.progress((0.45 * frames.length) / count, 'Reading frames');
      }

      const format = opts.format === 'webp' ? 'webp' : 'gif';
      const plays =
        opts.plays === 'once'
          ? 1
          : opts.plays === 'forever' || !opts.plays
            ? 0
            : Number(opts.plays) || 0;
      const bytes = await runWorker(
        {
          frames,
          ...size,
          fps,
          plays,
          palette: opts.palette === 'frame' ? 'frame' : 'global',
          dither: opts.dither !== 'off',
          format,
          quality: 75,
        },
        ctx.signal,
        (f) => {
          ctx.progress(0.45 + 0.55 * f, format === 'gif' ? 'Making the GIF' : 'Making the WebP');
        },
      );

      const notes = [
        `${String(count)} frames at ${String(fps)} fps${speed === 1 ? '' : `, ${String(speed)}× speed`}, ${String(size.width)} × ${String(size.height)} px`,
      ];
      if (bytes.byteLength > GIF_LIMITS.warnBytes) {
        notes.push(
          'Over 15 MB: many sites turn down GIFs this big. A smaller width, fewer frames per second or a shorter range helps; WebP is often a third of the size.',
        );
      }
      return {
        blob: new Blob([bytes], { type: format === 'gif' ? 'image/gif' : 'image/webp' }),
        ext: format,
        width: size.width,
        height: size.height,
        durationSec: count / fps,
        path: 'Browser · WebCodecs',
        notes,
        details: [
          { label: 'Frames', value: `${String(count)} frames` },
          {
            label: 'Plays',
            value:
              plays === 0
                ? 'Loops forever'
                : plays === 1
                  ? 'Plays once'
                  : `Plays ${String(plays)} times`,
          },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
