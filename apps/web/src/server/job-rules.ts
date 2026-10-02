/**
 * Per-tool rules the jobs API applies to the worker's probe before any job
 * exists (docs/05 → Pricing a job): what a tool's price is computed from,
 * and a tool's own reasons not to take a file. Nothing to do means nothing
 * to pay, so these answer before credits are reserved. Pure, so tested on
 * their own (job-rules.test.ts).
 */
import { gpuRateUsd } from '@etb/config/business';
import type { PriceInput } from '@etb/registry/pricing';
import type { ToolDef } from '@etb/registry/schema';

import {
  fits4k,
  fpsLabel,
  framesOf,
  maskFits,
  MAX_PRORES_BYTES,
  MAX_VIDEO_FRAMES,
  proresBytesOf,
  workingFps,
} from '../lib/gpu-limits';

export interface Probe {
  duration_ms?: number;
  video?: {
    width?: number;
    height?: number;
    fps?: number;
    vfr?: boolean | null;
    /** Degrees the stored frames are turned to show them (phones). */
    rotation?: number;
  } | null;
  audio?: { codec?: string; sample_rate?: number; channels?: number } | null;
}

export interface Refusal {
  status: 413 | 422;
  code: 'FILE_TOO_LARGE' | 'NOTHING_TO_DO' | 'UNSUPPORTED_FORMAT';
  title: string;
  detail: string;
}

/** Upscale Image's results stop here (tools/photo.md → P08: "Output capped at 64 MP"). */
export const MAX_UPSCALE_PIXELS = 64_000_000;

function upscaleScale(options: Record<string, unknown>): number {
  return options.scale === '2' ? 2 : 4;
}

/** The picture as shown: a phone's rotation applied. */
export function shownSize(probe: Probe): { width: number; height: number } {
  const width = probe.video?.width ?? 0;
  const height = probe.video?.height ?? 0;
  return (probe.video?.rotation ?? 0) % 180 === 90
    ? { width: height, height: width }
    : { width, height };
}

/** Frames a video tool will process: the length at the clip's rate (30 when it doesn't say). */
export function frameCount(probe: Probe): number {
  return framesOf((probe.duration_ms ?? 0) / 1000, probe.video?.fps);
}

/** About how big V21's ProRes 4444 result of this clip would be, in bytes. */
export function proresBytes(probe: Probe): number {
  const { width, height } = shownSize(probe);
  return proresBytesOf(width, height, frameCount(probe));
}

/** The picture a job makes, where the tool changes its size (Upscale Image, Upscale Video). */
export function outputSize(
  toolId: string,
  probe: Probe,
  options: Record<string, unknown>,
): { width: number; height: number } {
  if (toolId === 'upscale-video') {
    const { width, height } = shownSize(probe);
    const scale = upscaleScale(options);
    return { width: width * scale, height: height * scale };
  }
  const width = probe.video?.width ?? 0;
  const height = probe.video?.height ?? 0;
  if (toolId !== 'upscale-image') return { width, height };
  const scale = upscaleScale(options);
  return { width: width * scale, height: height * scale };
}

/** What `priceOf` reads: the length, and the OUTPUT megapixels (docs/05 → CreditRule). */
export function priceInput(
  toolId: string,
  probe: Probe,
  options: Record<string, unknown>,
): PriceInput {
  const { width, height } = outputSize(toolId, probe, options);
  return { durationMs: probe.duration_ms ?? 0, megapixels: (width * height) / 1e6 };
}

/** A clip with more frames than the video GPU tools take, or null. */
function tooManyFrames(name: string, probe: Probe): Refusal | null {
  const frames = frameCount(probe);
  if (frames <= MAX_VIDEO_FRAMES) return null;
  const fps = workingFps(probe.video?.fps);
  return {
    status: 413,
    code: 'FILE_TOO_LARGE',
    title: 'Too long',
    detail: `This clip is ${frames.toLocaleString('en-US')} frames (${((probe.duration_ms ?? 0) / 60_000).toFixed(1)} min at ${fpsLabel(fps)} fps); ${name} takes up to ${MAX_VIDEO_FRAMES.toLocaleString('en-US')}, which is ${(MAX_VIDEO_FRAMES / fps / 60).toFixed(1)} min at this frame rate. Trim it first.`,
  };
}

const NO_VIDEO: Refusal = {
  status: 422,
  code: 'UNSUPPORTED_FORMAT',
  title: 'No video',
  detail: 'This file has no video in it.',
};

const NO_SOUND: Refusal = {
  status: 422,
  code: 'NOTHING_TO_DO',
  title: 'Nothing to transcribe',
  detail: 'This file has no sound, so there is nothing to transcribe. Nothing was charged.',
};

/** More channels than this is not speech (Noise Reduction, tools/audio.md → A10). */
export const MAX_NOISE_CHANNELS = 8;

/**
 * Noise Reduction keeps two working copies on the worker's disk, the decoded
 * and the cleaned sound, as raw 32-bit float at the file's own rate and
 * channels. Together they stay within what a job slot's disk holds for one
 * upload (docs/01 → worker): about 3 h 6 min of stereo at 48 kHz.
 */
export const MAX_NOISE_WORK_BYTES = 8 * 1024 ** 3;

/** Bytes of Noise Reduction's two working copies for this file. */
export function noiseWorkBytes(probe: Probe): number {
  const rate = probe.audio?.sample_rate ?? 0;
  const channels = probe.audio?.channels ?? 0;
  return ((probe.duration_ms ?? 0) / 1000) * rate * channels * 4 * 2;
}

function hoursAndMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${String(minutes)} min`
    : `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

const RULES: Record<string, (probe: Probe, options: Record<string, unknown>) => Refusal | null> = {
  'remove-noise': (probe) => {
    const audio = probe.audio;
    if (!audio?.sample_rate || !audio.channels) {
      return {
        status: 422,
        code: 'NOTHING_TO_DO',
        title: 'Nothing to clean',
        detail: 'This file has no sound, so there is nothing to clean. Nothing was charged.',
      };
    }
    if (audio.channels > MAX_NOISE_CHANNELS) {
      return {
        status: 422,
        code: 'UNSUPPORTED_FORMAT',
        title: 'Too many channels',
        detail: `This file has ${String(audio.channels)} channels; noise reduction takes up to ${String(MAX_NOISE_CHANNELS)}. Mix it down to stereo or mono first.`,
      };
    }
    if (noiseWorkBytes(probe) <= MAX_NOISE_WORK_BYTES) return null;
    const perSecond = audio.sample_rate * audio.channels * 4 * 2;
    return {
      status: 413,
      code: 'FILE_TOO_LARGE',
      title: 'Too long to clean at once',
      detail: `At ${String(audio.sample_rate / 1000)} kHz with ${String(audio.channels)} channels we clean up to ${hoursAndMinutes(MAX_NOISE_WORK_BYTES / perSecond)} at once; this file is ${hoursAndMinutes((probe.duration_ms ?? 0) / 1000)}. Split it into parts, or mix it down to fewer channels.`,
    };
  },
  'vfr-to-cfr': (probe) =>
    probe.video?.vfr === false
      ? {
          status: 422,
          code: 'NOTHING_TO_DO',
          title: 'Nothing to fix',
          detail: `This video already has a constant frame rate${probe.video.fps ? ` (${probe.video.fps.toFixed(2)} fps)` : ''}, so it stays in sync as it is. Nothing to fix, and nothing was charged.`,
        }
      : null,
  'upscale-image': (probe, options) => {
    if (!probe.video?.width || !probe.video.height) {
      return {
        status: 422,
        code: 'UNSUPPORTED_FORMAT',
        title: 'Not an image',
        detail: 'We couldn’t read a picture in this file.',
      };
    }
    const { width, height } = outputSize('upscale-image', probe, options);
    if (width * height <= MAX_UPSCALE_PIXELS) return null;
    return {
      status: 413,
      code: 'FILE_TOO_LARGE',
      title: 'The result would be too big',
      detail: `At ${String(upscaleScale(options))}× this would be ${String(width)} × ${String(height)} px, ${(
        (width * height) /
        1e6
      ).toFixed(0)} MP; Upscale Image makes up to 64 MP. Pick 2×, or a smaller image.`,
    };
  },
  'transcribe-audio': (probe) => (probe.audio ? null : NO_SOUND),
  'auto-subtitles': (probe) => (probe.audio ? null : NO_SOUND),
  'object-eraser': (probe) =>
    probe.video?.width && probe.video.height
      ? null
      : {
          status: 422,
          code: 'UNSUPPORTED_FORMAT',
          title: 'Not an image',
          detail: 'We couldn’t read a picture in this file.',
        },
  'upscale-video': (probe, options) => {
    if (!probe.video?.width || !probe.video.height) return NO_VIDEO;
    const { width, height } = outputSize('upscale-video', probe, options);
    if (!fits4k(width, height)) {
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        title: 'The result would be too big',
        detail: `At ${String(upscaleScale(options))}× this would be ${String(width)} × ${String(height)} px; Upscale Video makes up to 4K (3840 × 2160). Pick 2×, or a smaller video.`,
      };
    }
    return tooManyFrames('Upscale Video', probe);
  },
  'video-background-remover': (probe, options) => {
    if (!probe.video?.width || !probe.video.height) return NO_VIDEO;
    const { width, height } = shownSize(probe);
    if (!fits4k(width, height)) {
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        title: 'Too many pixels',
        detail: `This video is ${String(width)} × ${String(height)} px; Video Background Remover takes up to 4K (3840 × 2160).`,
      };
    }
    const long = tooManyFrames('Video Background Remover', probe);
    if (long) return long;
    const bytes = proresBytes(probe);
    if ((options.output ?? 'prores') === 'prores' && bytes > MAX_PRORES_BYTES) {
      const perMinute = bytes / Math.max(1, (probe.duration_ms ?? 0) / 60_000);
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        title: 'Too big as ProRes',
        detail: `As ProRes 4444 this would be about ${(bytes / 1e9).toFixed(1)} GB; we make up to ${String(MAX_PRORES_BYTES / 1e9)} GB, about ${(MAX_PRORES_BYTES / perMinute).toFixed(1)} min of this video. Pick WebM or a green screen, or trim it.`,
      };
    }
    return null;
  },
};

/**
 * A tool's reason not to take its other files with this one (Object Eraser:
 * a mask of another shape), before anything is charged; null to go on.
 */
export function extrasRefusal(toolId: string, probe: Probe, extras: Probe[]): Refusal | null {
  if (toolId !== 'object-eraser') return null;
  const mask = extras[0]?.video;
  if (!mask?.width || !mask.height) {
    return {
      status: 422,
      code: 'UNSUPPORTED_FORMAT',
      title: 'Not a mask',
      detail: 'We couldn’t read the mask. Send it as a PNG, white where to erase.',
    };
  }
  const width = probe.video?.width ?? 0;
  const height = probe.video?.height ?? 0;
  // A JPEG's probe gives its stored size; the mask is drawn on the photo upright.
  if (maskFits(mask.width, mask.height, width, height)) return null;
  if (maskFits(mask.width, mask.height, height, width)) return null;
  return {
    status: 422,
    code: 'UNSUPPORTED_FORMAT',
    title: 'The mask doesn’t fit',
    detail: `The mask is ${String(mask.width)} × ${String(mask.height)} px; it must have the image’s shape (${String(width)} × ${String(height)} px), at its size or scaled.`,
  };
}

/** A tool's own reason not to run this file, before anything is charged; null to go on. */
export function refusal(
  toolId: string,
  probe: Probe,
  options: Record<string, unknown>,
): Refusal | null {
  return RULES[toolId]?.(probe, options) ?? null;
}

/**
 * USD a second of the tool's GPU function, written on the job: the worker
 * prices the job's GPU time with it and keeps to the daily budget. Null for
 * tools without a GPU server path. As a string: it goes into a numeric column.
 */
export function gpuRate(tool: Pick<ToolDef, 'gpu'>): string | null {
  return tool.gpu ? gpuRateUsd(tool.gpu).toFixed(8) : null;
}
