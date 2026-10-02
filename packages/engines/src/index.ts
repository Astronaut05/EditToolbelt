/**
 * @etb/engines: browser processing engines (docs/02 → Engines).
 *
 * The engine contract, a dummy engine for building the ToolShell (M1), and the
 * real engines as their tools go live (docs/12-milestones.md → M2).
 */
export type { Capabilities, Engine, EngineOutput, InputMeta, RunContext } from './types';
export { dummyEngine, EngineAbortError, type DummyOptions } from './dummy';
export { subtitleEngine, type SubtitleEngineOptions } from './subtitles';
export {
  checkImage,
  IMAGE_LIMITS,
  imageCodecEngine,
  ImageInputError,
  type ImageCodecOptions,
} from './image/image-codec';
export { FORMAT_LABELS as IMAGE_FORMAT_LABELS, sniffImage, type ImageFormat } from './image/sniff';
export { cleanExif, jpegWithExif, readJpegExif } from './image/exif';
export { imageGeometryEngine, ratioValue, type ImageGeometryOptions } from './image/image-geometry';
export { imageSplitEngine, type ImageSplitOptions } from './image/image-split';
export { socialResizeEngine, type SocialResizeOptions } from './image/social-resize';
export { lutPreviewEngine, type LutPreviewOptions } from './image/lut-preview';
export { watermarkEngine, type WatermarkOptions } from './image/watermark';
export { fitPlacement, focusCrop, focusOf, type Focus, type SocialFit } from './image/social';
export { imageMetadataEngine, type MetadataOptions } from './image/metadata';
export {
  centredRatio,
  clampRect,
  turnedSize,
  type Filter,
  type Rect,
  type Size,
} from './image/geometry';
export {
  codecLabel,
  describeMedia,
  MediaInputError,
  probeMedia,
  thumbnails,
  type MediaInfo,
} from './video/media';
export { VIDEO_LIMITS } from './video/limits';
export { trimEngine, type TrimOptions } from './video/trim';
export { muteGain, muteVideoEngine, silence, type MuteOptions } from './video/mute';
export type { ReplaceAudioOptions } from './video/replace-audio';
export {
  videoInfoEngine,
  videoReport,
  type VideoInfoOptions,
  type VideoReport,
} from './video/info';
export {
  AUDIO_TARGETS,
  extractAudioEngine,
  type AudioFormat,
  type ExtractAudioOptions,
} from './video/extract-audio';
export { compressEngine, minBpp, planCompress, type CompressOptions } from './video/compress';
export {
  gifSize,
  GIF_LIMITS,
  videoToGifEngine,
  type VideoToGifOptions,
} from './video/video-to-gif';
export {
  parseHex,
  removeBackgroundEngine,
  RMBG_LIMITS,
  type RemoveBackgroundOptions,
} from './image/rmbg/remove-background';
export { canRunQuality, modelCached, pickModel } from './image/rmbg/support';
export { lazyEngine } from './lazy';
export {
  AUDIO_LIMITS,
  estimateGifBytes,
  GIF_INPUT_LIMITS,
  gifFrameCount,
  MEDIA_META,
} from './media-meta';
export {
  ORT_BUILDS,
  ORT_FILES,
  ORT_VERSION,
  SEGMENT_MODELS,
  type SegmentModel,
} from './image/rmbg/models';
export type { Stroke } from './image/rmbg/mask';
export {
  planShift,
  readSubtitles,
  readTime,
  signedSeconds,
  SubtitleShiftError,
  subtitleShiftEngine,
  type SubtitleShiftOptions,
} from './subtitle-shift';
export { audioConverterEngine, type AudioConverterOptions } from './audio/convert';
export { probeAudio, type AudioProbe } from './audio/probe';
export { audioPeaks, trimAudioEngine, type TrimAudioOptions } from './audio/trim';
export { gifToVideoEngine, videoFrameTimes, type GifToVideoOptions } from './video/gif-to-video';
export { gifFrames, readGif, type GifInfo } from './video/gif/decode';
export { paletteEngine, PALETTE_LIMITS, type PaletteEngineOptions } from './image/palette';
export {
  describeColor,
  pickedColorsEngine,
  readPicked,
  sampleColor,
  type PickedColor,
  type PickedColorsOptions,
} from './image/pick';
export {
  planConversion,
  videoConverterEngine,
  videoFrameSource,
  videoPackets,
  type ConversionPlan,
  type FrameSource,
  type VideoConverterOptions,
} from './video/convert-video';
export { bpmKeyEngine, Downmix, type BpmKeyOptions } from './audio/bpm-key';
export { addTap, tapBpm } from '@etb/core';
export {
  batchRenameEngine,
  renamePlan,
  rulesFrom,
  type NamedFile,
  type NamesPlan,
} from './files/batch-rename';
export { takenDate } from './files/taken';
export { trackEnds } from './video/merge-videos';
export { fileChecksumEngine, type FileChecksumOptions } from './files/checksum';
export {
  arrowHead,
  centredPoints,
  drawMark,
  drawMarks,
  MARK_TOOLS,
  markBounds,
  moveMark,
  nextMarker,
  resizeMark,
  type Mark,
  type MarkTool,
  type Point,
} from './image/annotate';
export {
  addUserFont,
  cssFont,
  drawTextLayer,
  drawTextLayers,
  hitsLayer,
  layerFrame,
  loadTextFont,
  measureText,
  snapCentre,
  type TextAlign,
  type TextBlock,
  type TextLayer,
} from './image/text-layer';
export { TEXT_FONTS } from './image/text-fonts';
export {
  throughFrame,
  throughUpright,
  uprightFor,
  type Frame,
  type Upright,
} from './image/upright';
export {
  ADJUST_RANGES,
  adjustNote,
  adjustValue,
  applyAdjust,
  isNeutral,
  NO_ADJUST,
  type Adjust,
} from './image/adjust';
export {
  activeAreas,
  applyRedact,
  areaBoxOf,
  defaultAmount,
  faceArea,
  maxAmount,
  REDACT_EFFECTS,
  REDACT_SHAPES,
  type Redact,
  type RedactEffect,
  type Redaction,
  type RedactShape,
} from './image/redact';
export { YUNET, type FaceBox } from './image/faces/yunet';
