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
  estimateGifBytes,
  gifFrameCount,
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
export {
  gifToVideoEngine,
  GIF_INPUT_LIMITS,
  videoFrameTimes,
  type GifToVideoOptions,
} from './video/gif-to-video';
export { gifFrames, readGif, type GifInfo } from './video/gif/decode';
export {
  planConversion,
  videoConverterEngine,
  videoPackets,
  type ConversionPlan,
  type VideoConverterOptions,
} from './video/convert-video';
export { AUDIO_LIMITS, audioConverterEngine, type AudioConverterOptions } from './audio/convert';
export { probeAudio, type AudioProbe } from './audio/probe';
export { audioPeaks, fadeGain, trimAudioEngine, type TrimAudioOptions } from './audio/trim';
export { bpmKeyEngine, Downmix, type BpmKeyOptions } from './audio/bpm-key';
export { addTap, tapBpm } from '@etb/core';
