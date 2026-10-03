import { codecCapabilities } from '../image/codec-support';
import type { ImageGeometryOptions } from '../image/image-geometry';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P01-P04 and the editor tools on the image worker, before the engine loads. */
export const GEOMETRY_META: EngineMeta<ImageGeometryOptions> = {
  capabilities: codecCapabilities,
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 3_000_000) }),
};

export const imageGeometryEngine = lazyEngine(
  () => import('../image/image-geometry').then((m) => m.imageGeometryEngine),
  GEOMETRY_META,
);
