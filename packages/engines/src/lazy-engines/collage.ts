import type { CollageOptions } from '../image/collage';
import { lazyEngine, type EngineMeta } from '../lazy';

/** Output sizes: twice the social sizes, so they stay sharp when a platform scales them. */
export const COLLAGE_SIZES: Record<string, { width: number; height: number; label: string }> = {
  square: { width: 2160, height: 2160, label: 'Square' },
  portrait: { width: 2160, height: 2700, label: 'Portrait 4:5' },
  story: { width: 2160, height: 3840, label: 'Story 9:16' },
  landscape: { width: 3840, height: 2160, label: 'Landscape 16:9' },
  a4: { width: 2480, height: 3508, label: 'A4 at 300 dpi' },
};

/** P16 Collage Maker, before the engine loads. */
export const COLLAGE_META: EngineMeta<CollageOptions> = {
  capabilities: () => ({
    supported: typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined',
    reason: 'This browser can’t draw images here. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input, opts) => ({
    seconds: Math.max(1, (opts.files ?? [input]).reduce((sum, f) => sum + f.size, 0) / 15_000_000),
  }),
};

export const collageEngine = lazyEngine(
  () => import('../image/collage').then((m) => m.collageEngine),
  COLLAGE_META,
);
