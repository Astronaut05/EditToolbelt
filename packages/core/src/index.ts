/**
 * @etb/core: pure logic shared by web and the Premiere panel (calculators,
 * subtitle parsing, timecode arrive with their tools).
 *
 * Node-only modules have their own entry points so they never end up in a
 * browser bundle by accident: `@etb/core/env`, `@etb/core/logger`. So does
 * `@etb/core/qr`, so its dependency only loads where QR codes are made.
 */
export { REDACTED, isSensitiveKey, redact, redactString } from './redact';
export { joinUrl } from './urls';
export * as timecode from './calc/timecode';
export * as aspect from './calc/aspect';
export * as bitrate from './calc/bitrate';
export * as print from './calc/print';
export * as color from './color/color';
export * as contrast from './color/contrast';
export { CSS_NAMED_COLORS } from './color/names';
export {
  extractPalette,
  paletteAse,
  paletteCss,
  paletteJson,
  type PaletteMethod,
  type Swatch,
} from './color/palette';
export * as subtitles from './subtitles';
export {
  beatMarkers,
  beatTimes,
  detectKey,
  detectTempo,
  keysRelated,
  type KeyResult,
  type TempoRange,
  type TempoResult,
} from './audio/analysis';
export { addTap, tapBpm } from './audio/tap';
export {
  addRange,
  clampRange,
  invertRanges,
  keptSpans,
  layoutSpans,
  MIN_SPAN,
  normalizeRanges,
  type Layout,
  type Span,
} from './media/ranges';
export { Splicer, type SpliceOptions } from './media/splice';
export {
  PLATFORM_NAMES,
  PLATFORMS,
  SOCIAL_PRESETS,
  socialLabel,
  socialPreset,
  socialPresetsOf,
  type Platform,
  type SocialPreset,
} from './social-presets';
