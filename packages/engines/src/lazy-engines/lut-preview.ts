import { codecCapabilities } from '../image/codec-support';
import type { LutPreviewOptions } from '../image/lut-preview';
import { lazyEngine, type EngineMeta } from '../lazy';

/** C04 LUT Preview, before the engine loads. */
export const LUT_PREVIEW_META: EngineMeta<LutPreviewOptions> = {
  capabilities: codecCapabilities,
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
};

export const lutPreviewEngine = lazyEngine(
  () => import('../image/lut-preview').then((m) => m.lutPreviewEngine),
  LUT_PREVIEW_META,
);
