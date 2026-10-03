import type { PickedColorsOptions } from '../image/pick';
import { lazyEngine, type EngineMeta } from '../lazy';

/** C02 Color Picker from Image, before the engine loads. */
export const PICKED_META: EngineMeta<PickedColorsOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0 }),
};

export const pickedColorsEngine = lazyEngine(
  () => import('../image/pick').then((m) => m.pickedColorsEngine),
  PICKED_META,
);
