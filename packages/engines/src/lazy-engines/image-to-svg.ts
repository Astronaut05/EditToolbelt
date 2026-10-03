import type { ImageToSvgOptions } from '../image/vector/image-to-svg';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P20 Image to SVG, before the engine loads. */
export const TO_SVG_META: EngineMeta<ImageToSvgOptions> = {
  capabilities: () => ({
    supported:
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function',
    reason: 'This browser can’t trace images here. Try a current Chrome, Edge, Firefox or Safari.',
  }),
  estimate: (input) => ({ seconds: Math.max(1, Math.min(8, input.size / 1_500_000)) }),
};

export const imageToSvgEngine = lazyEngine(
  () => import('../image/vector/image-to-svg').then((m) => m.imageToSvgEngine),
  TO_SVG_META,
);
