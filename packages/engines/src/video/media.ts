/**
 * `video-webcodecs`: the browser's own decoders and encoders (WebCodecs),
 * driven by Mediabunny, which reads and writes the containers (MP4, MOV, WebM,
 * MKV, MP3, WAV, OGG, FLAC). Nothing is uploaded, and no codec of our own
 * ships for H.264 or AAC: those come with the browser (open question 10).
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  CanvasSink,
  canEncodeVideo,
  Conversion,
  Input,
  Output,
  type ConversionOptions,
  type OutputFormat,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';

import { VIDEO_LIMITS } from './limits';

export { VIDEO_LIMITS };

export class MediaInputError extends Error {}

export interface VideoInfo {
  codec: string | null;
  /** As displayed: rotation applied. */
  width: number;
  height: number;
  rotation: number;
  fps: number | null;
  /** No steady frame rate was found (phone recordings, screen captures). */
  variableFrameRate: boolean;
  hdr: boolean;
  canDecode: boolean;
}

export interface AudioInfo {
  /** 1-based, as players number tracks. */
  number: number;
  codec: string | null;
  channels: number;
  sampleRate: number;
  canDecode: boolean;
}

export interface MediaInfo {
  /** "MP4", "QuickTime", "WebM", "Matroska" … */
  format: string;
  durationSec: number;
  video: VideoInfo | null;
  audio: AudioInfo[];
}

export const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264',
  hevc: 'H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
};

export const codecLabel = (codec: string | null | undefined) =>
  codec ? (CODEC_LABELS[codec] ?? codec.toUpperCase()) : 'unknown';

export function openInput(file: Blob): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

/** What's in the file: format, length, and the video and audio tracks. */
export async function probeMedia(file: Blob): Promise<MediaInfo> {
  if (file.size > VIDEO_LIMITS.maxBytes) {
    throw new MediaInputError(
      `This file is ${(file.size / 1024 ** 3).toFixed(1)} GB; the browser limit is 2 GB.`,
    );
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t a video this tool can read. Try MP4, MOV, WebM or MKV.',
      );
    }
    const format = (await input.getFormat()).name;
    const durationSec = await input.computeDuration();
    const track = await input.getPrimaryVideoTrack();
    let video: VideoInfo | null = null;
    if (track) {
      const metrics = await track.computeFrameRateMetrics().catch(() => null);
      video = {
        codec: await track.getCodec(),
        width: await track.getDisplayWidth(),
        height: await track.getDisplayHeight(),
        rotation: await track.getRotation(),
        fps: metrics ? Math.round(metrics.bestGuessFrameRate * 1000) / 1000 : null,
        variableFrameRate: metrics ? metrics.underlyingFrameRate === null : false,
        hdr: await track.hasHighDynamicRange().catch(() => false),
        canDecode: await track.canDecode(),
      };
    }
    const audio = await Promise.all(
      (await input.getAudioTracks()).map(async (a, i) => ({
        number: i + 1,
        codec: await a.getCodec(),
        channels: await a.getNumberOfChannels(),
        sampleRate: await a.getSampleRate(),
        canDecode: await a.canDecode(),
      })),
    );
    if (durationSec > VIDEO_LIMITS.maxSeconds) {
      throw new MediaInputError(
        `This file is ${String(Math.round(durationSec / 60))} min long; the browser limit is 60 min.`,
      );
    }
    return { format, durationSec, video, audio };
  } finally {
    input.dispose();
  }
}

/** The facts a tool shows once a file is in: "1920 × 1080 · 29.97 fps · H.264 + AAC". */
export function describeMedia(info: MediaInfo): string {
  const parts: string[] = [];
  if (info.video) {
    parts.push(`${String(info.video.width)} × ${String(info.video.height)} px`);
    if (info.video.fps)
      parts.push(
        `${String(info.video.fps)} fps${info.video.variableFrameRate ? ' (variable)' : ''}`,
      );
  }
  const codecs = [info.video?.codec, info.audio[0]?.codec].filter(Boolean).map(codecLabel);
  if (codecs.length) parts.push(codecs.join(' + '));
  return parts.join(' · ');
}

/**
 * Frames across the clip for the timeline strip, as small JPEG object URLs
 * ("" where a frame can't be decoded). Needs the browser's video decoder.
 */
export async function thumbnails(file: Blob, count: number, height = 72): Promise<string[]> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return [];
    const duration = await input.computeDuration();
    const sink = new CanvasSink(track, { height, poolSize: 1 });
    const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
    const urls: string[] = [];
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      const canvas = frame?.canvas;
      if (!canvas) {
        urls.push('');
        continue;
      }
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
          : await new Promise<Blob | null>((resolve) => {
              canvas.toBlob(resolve, 'image/jpeg', 0.7);
            });
      urls.push(blob ? URL.createObjectURL(blob) : '');
    }
    return urls;
  } finally {
    input.dispose();
  }
}

export type Container = 'mp4' | 'webm';

/**
 * The container and codecs this browser can write: MP4 with H.264 and AAC
 * where it has those encoders, else WebM with VP9 and Opus. Audio that is
 * already AAC is copied into MP4 without an encoder, so only re-encoded audio
 * needs one; Opus never goes into an MP4 (tools/video.md → Audio).
 */
export async function pickOutput(
  wanted: Container,
  size: { width: number; height: number },
  audio: { needsEncode: boolean; copyable: boolean },
): Promise<{ container: Container; video: 'avc' | 'vp9'; audio: 'aac' | 'opus'; note?: string }> {
  if (wanted === 'mp4') {
    const h264 = await canEncodeVideo('avc', size);
    const aac = !audio.needsEncode || audio.copyable || (await canEncodeAudio('aac'));
    if (h264 && aac) return { container: 'mp4', video: 'avc', audio: 'aac' };
    return {
      container: 'webm',
      video: 'vp9',
      audio: 'opus',
      note: h264
        ? 'Saved as WebM: this browser can’t encode AAC audio for an MP4. Chrome on Windows and macOS, Safari and Edge can.'
        : 'Saved as WebM: this browser can’t encode H.264 for an MP4. Chrome, Safari and Edge can.',
    };
  }
  return { container: 'webm', video: 'vp9', audio: 'opus' };
}

export interface RunOutput {
  bytes: ArrayBuffer;
  mime: string;
  ext: string;
}

/**
 * Runs a Mediabunny conversion with progress and cancel, and says why a
 * track was left out when one was.
 */
export async function convert(
  options: Omit<ConversionOptions, 'output'> & { format: OutputFormat },
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<RunOutput & { dropped: string[] }> {
  const { format, ...rest } = options;
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const conversion = await Conversion.init({ ...rest, output });
  const dropped = conversion.discardedTracks
    .filter((track) => track.reason !== 'discarded_by_user')
    .map((track) =>
      track.reason === 'undecodable_source_codec' || track.reason === 'unknown_source_codec'
        ? `The ${track.track.type} track couldn’t be read by this browser, so it was left out`
        : `The ${track.track.type} track couldn’t be written as ${format.fileExtension.slice(1).toUpperCase()}, so it was left out`,
    );
  if (!conversion.isValid) {
    throw new MediaInputError(
      dropped[0]
        ? `${dropped[0]}, and nothing else was left.`
        : 'This file can’t be converted here.',
    );
  }
  conversion.onProgress = (fraction) => {
    progress(fraction);
  };
  const onAbort = () => {
    void conversion.cancel();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await conversion.execute();
  } catch (error) {
    if (signal.aborted) throw new EngineAbortError();
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (signal.aborted) throw new EngineAbortError();
  const bytes = target.buffer;
  if (!bytes) throw new Error('The converter produced no file');
  return { bytes, mime: format.mimeType, ext: format.fileExtension.slice(1), dropped };
}
