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

export interface Probe {
  duration_ms?: number;
  video?: { width?: number; height?: number; fps?: number; vfr?: boolean | null } | null;
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

/** The picture a job makes, where the tool changes its size (Upscale Image). */
export function outputSize(
  toolId: string,
  probe: Probe,
  options: Record<string, unknown>,
): { width: number; height: number } {
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

const NO_SOUND: Refusal = {
  status: 422,
  code: 'NOTHING_TO_DO',
  title: 'Nothing to transcribe',
  detail: 'This file has no sound, so there is nothing to transcribe. Nothing was charged.',
};

const RULES: Record<string, (probe: Probe, options: Record<string, unknown>) => Refusal | null> = {
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
};

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
