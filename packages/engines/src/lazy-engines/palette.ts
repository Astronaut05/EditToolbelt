import type { PaletteEngineOptions } from '../image/palette';
import { lazyEngine, type EngineMeta } from '../lazy';

export const PALETTE_LIMITS = { maxBytes: 100 * 1024 ** 2 };

/** C01 Color Palette from Image, before the engine loads. */
export const PALETTE_META: EngineMeta<PaletteEngineOptions> = {
  capabilities: () => ({
    supported: typeof OffscreenCanvas === 'function',
    reason:
      'This browser can’t read images here yet. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: () => ({ seconds: 0.5 }),
};

export const paletteEngine = lazyEngine(
  () => import('../image/palette').then((m) => m.paletteEngine),
  PALETTE_META,
);
