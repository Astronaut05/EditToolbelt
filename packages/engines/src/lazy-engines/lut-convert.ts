import type { LutConvertOptions } from '../lut-convert';
import { lazyEngine, type EngineMeta } from '../lazy';

/** C05 LUT Converter, before the engine loads. */
export const LUT_CONVERT_META: EngineMeta<LutConvertOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0.3 }),
};

export const lutConvertEngine = lazyEngine(
  () => import('../lut-convert').then((m) => m.lutConvertEngine),
  LUT_CONVERT_META,
);
