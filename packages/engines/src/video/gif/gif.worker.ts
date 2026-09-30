/**
 * The GIF worker: quantising, dithering and LZW (or WebP frames) off the main
 * thread, so the page stays responsive while a clip becomes a GIF.
 */
import { encodeGif } from './encode';
import { muxAnimatedWebp, type WebpFrame } from './webp';

export interface GifJob {
  frames: ArrayBuffer[];
  width: number;
  height: number;
  fps: number;
  /** 0 plays forever. */
  plays: number;
  palette: 'global' | 'frame';
  dither: boolean;
  format: 'gif' | 'webp';
  /** WebP quality, 1-100. */
  quality: number;
}

export type GifMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

interface WorkerScope {
  postMessage(message: GifMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<GifJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

async function run(job: GifJob): Promise<ArrayBuffer> {
  const progress = (fraction: number) => {
    scope.postMessage({ type: 'progress', fraction });
  };
  if (job.format === 'gif') {
    const frames = job.frames.map((buffer) => new Uint8Array(buffer));
    return encodeGif(frames, job, progress).buffer;
  }
  const { default: encode } = await import('@jsquash/webp/encode');
  // Milliseconds per frame, spread so the average holds (12 fps → 83, 84, 83, …).
  const at = (k: number) => Math.round((k * 1000) / job.fps);
  const delays = job.frames.map((_, k) => at(k + 1) - at(k));
  const webps: WebpFrame[] = [];
  for (const [i, buffer] of job.frames.entries()) {
    const image = new ImageData(new Uint8ClampedArray(buffer), job.width, job.height);
    webps.push({
      webp: new Uint8Array(await encode(image, { quality: job.quality })),
      durationMs: delays[i] ?? 1000 / job.fps,
    });
    progress((i + 1) / job.frames.length);
  }
  return muxAnimatedWebp(webps, job.width, job.height, job.plays, false).buffer;
}

scope.onmessage = (event) => {
  run(event.data).then(
    (bytes) => {
      scope.postMessage({ type: 'done', bytes }, [bytes]);
    },
    (error: unknown) => {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'The GIF couldn’t be made',
      });
    },
  );
};
