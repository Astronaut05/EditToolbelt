/**
 * P19's worker: decode (upright, sRGB), scale down to the tracing size, and
 * trace with @etb/core's vectoriser, off the main thread.
 */
import { toSvg, vectorize, type TraceOptions } from '@etb/core/vectorize';

import { decodeImage } from '../decode';
import type { ImageFormat } from '../sniff';

export interface VectorJob {
  bytes: ArrayBuffer;
  format: ImageFormat;
  options: TraceOptions;
  /** The longest side traced; larger images are scaled down first. */
  maxSide: number;
}

export type VectorMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | {
      type: 'done';
      svg: string;
      width: number;
      height: number;
      tracedWidth: number;
      tracedHeight: number;
      colours: string[];
    }
  | { type: 'error'; message: string };

const post = (message: VectorMessage) => {
  postMessage(message);
};

self.onmessage = async (event: MessageEvent<VectorJob>) => {
  const { bytes, format, options, maxSide } = event.data;
  try {
    post({ type: 'progress', fraction: 0.05, stage: 'Reading the image' });
    const bitmap = await decodeImage(bytes, format);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas in this browser');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const rgba = ctx.getImageData(0, 0, w, h).data;
    post({ type: 'progress', fraction: 0.2, stage: 'Tracing' });
    const traced = vectorize(rgba, w, h, options);
    post({ type: 'progress', fraction: 0.95, stage: 'Writing the SVG' });
    post({
      type: 'done',
      svg: toSvg(traced, width, height),
      width,
      height,
      tracedWidth: w,
      tracedHeight: h,
      colours: traced.layers.map((layer) => layer.hex),
    });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
