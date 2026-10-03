import type { ImagesToPdfOptions } from '../image/images-to-pdf';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P18 Images to PDF, before the engine loads. */
export const IMAGES_TO_PDF_META: EngineMeta<ImagesToPdfOptions> = {
  capabilities: () => ({
    supported: typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined',
    reason: 'This browser can’t read images here. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 20_000_000) }),
};

export const imagesToPdfEngine = lazyEngine(
  () => import('../image/images-to-pdf').then((m) => m.imagesToPdfEngine),
  IMAGES_TO_PDF_META,
);
