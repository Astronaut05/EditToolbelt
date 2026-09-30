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
export * as color from './color/color';
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
