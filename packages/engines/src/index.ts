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
