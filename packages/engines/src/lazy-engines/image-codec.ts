import { codecCapabilities } from '../image/codec-support';
import type { ImageCodecOptions } from '../image/image-codec';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P05 Compress Image and P06 Image Converter, before the engine loads. */
export const CODEC_META: EngineMeta<ImageCodecOptions> = {
  capabilities: codecCapabilities,
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 4_000_000) }),
};

export const imageCodecEngine = lazyEngine(
  () => import('../image/image-codec').then((m) => m.imageCodecEngine),
  CODEC_META,
);
