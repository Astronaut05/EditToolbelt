import { codecCapabilities } from '../image/codec-support';
import type { MetadataOptions } from '../image/metadata';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P15 Photo Metadata Viewer & Remover, before the engine loads. */
export const METADATA_META: EngineMeta<MetadataOptions> = {
  capabilities: codecCapabilities,
  estimate: (input) => ({ seconds: Math.max(0.2, input.size / 50_000_000) }),
};

export const imageMetadataEngine = lazyEngine(
  () => import('../image/metadata').then((m) => m.imageMetadataEngine),
  METADATA_META,
);
