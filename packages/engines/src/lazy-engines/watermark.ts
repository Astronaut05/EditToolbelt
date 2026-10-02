import { codecCapabilities } from '../image/codec-support';
import type { WatermarkOptions } from '../image/watermark';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P17 Watermark Images, before the engine loads. */
export const WATERMARK_META: EngineMeta<WatermarkOptions> = {
  capabilities: codecCapabilities,
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
};

export const watermarkEngine = lazyEngine(
  () => import('../image/watermark').then((m) => m.watermarkEngine),
  WATERMARK_META,
);
