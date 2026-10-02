import { socialPresetsOf } from '@etb/core';

import { codecCapabilities } from '../image/codec-support';
import type { SocialResizeOptions } from '../image/social-resize';
import { lazyEngine, type EngineMeta } from '../lazy';

/** P13 Social Media Image Resizer, before the engine loads. */
export const SOCIAL_META: EngineMeta<SocialResizeOptions> = {
  capabilities: codecCapabilities,
  estimate: (input, opts) => ({
    seconds: Math.max(0.5, (input.size / 3_000_000) * (1 + socialPresetsOf(opts.sizes).length)),
  }),
};

export const socialResizeEngine = lazyEngine(
  () => import('../image/social-resize').then((m) => m.socialResizeEngine),
  SOCIAL_META,
);
