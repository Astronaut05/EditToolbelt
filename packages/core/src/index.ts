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
export * as shutter from './calc/shutter';
export * as storage from './calc/storage';
export * as checksum from './checksum';
export * as color from './color/color';
export * as contrast from './color/contrast';
export * as gradient from './color/gradient';
export { CSS_NAMED_COLORS } from './color/names';
export { applyLut, identityLut, lookup, LutError, parseCube, type Lut } from './color/lut';
export {
  ANCHORS,
  markBox,
  tileBoxes,
  type Anchor,
  type MarkBox,
  type Placement as MarkPlacement,
} from './image/watermark';
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
export { joinGain, reversePieces, type ReversePiece } from './media/reverse';
export { equalParts, MAX_PARTS, pieceParts, silenceParts, TooManyParts } from './media/split';
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
export {
  applyPlan,
  dbOf,
  LoudnessScan,
  lufs,
  measure,
  planNormalize,
  type Loudness,
  type NormalizePlan,
  type ScanResult,
} from './audio/loudness';
export { LOUDNESS_TARGETS, targetVerdict, type LoudnessTarget } from './audio/targets';
export {
  applyFades,
  FADE_CURVES,
  fadeCurveOf,
  fadeGain,
  type FadeCurve,
  type Fades,
} from './audio/fades';
export {
  CHANNEL_ACTIONS,
  channelActionOf,
  ChannelStats,
  channelVerdict,
  needsStereo,
  remix,
  VERDICTS,
  type ChannelAction,
  type ChannelVerdict,
} from './audio/channels';
export {
  autoThreshold,
  cutsCsv,
  findSilences,
  LEVEL_STEP,
  LevelScan,
  silenceCuts,
  type CutOptions,
} from './audio/silence';
export { Resampler } from './audio/resample';
export { Fft } from './audio/fft';
export { TimeStretch } from './audio/stretch';
export {
  placedGain,
  placedLength,
  placeJoined,
  placeMixed,
  type JoinKind,
  type Placement,
} from './audio/merge';
export {
  dbGain,
  LOOP_FADE,
  MAX_LOOPS,
  musicEnd,
  musicGain,
  musicParts,
  type MusicGain,
  type MusicPart,
} from './audio/mix';
export {
  DATE_FORMATS,
  DEFAULT_RULES,
  planRenames,
  RenameError,
  splitName,
  type RenameFile,
  type RenameRules,
} from './rename';
