/**
 * A job's files against its tool (docs/11 → File intake: "Limits enforced
 * server-side from the registry, regardless of what the client says").
 *
 * A job has its own upload, and may name more in its options
 * (`uploadOptions` in the registry): Burn Subtitles' subtitle file, Object
 * Eraser's mask, or Merge Videos' other 1 to 19 clips, in order. What can be
 * checked without the database lives here, pure and unit-tested: which
 * uploads the options name, what each must be, and the tier's limits per
 * file and in all. jobs.ts checks ownership, completion, one job per upload
 * and the probes, then calls these.
 */
import { limitsOf } from '@etb/registry';
import { uploadKinds, uploadOptions, type UploadKind } from '@etb/registry/options';
import type { ToolDef } from '@etb/registry/schema';

import type { Probe } from './job-rules';
import { ApiError } from './problem';

export interface NamedUpload {
  option: string;
  id: string;
  /** What it must be (`uploadKinds` in the registry). */
  kind: UploadKind | undefined;
  /** One of a list (Merge Videos' clips). */
  listed: boolean;
  /** How the person knows it: "the subtitles file", "clip 3". */
  label: string;
}

/**
 * The uploads a job's checked options name, in order: one per option, or
 * each of a list (Merge Videos' `clips`, which play after the job's own
 * upload, so the first of them is clip 2).
 */
export function namedUploads(toolId: string, options: Record<string, unknown>): NamedUpload[] {
  const tool = toolId as keyof typeof uploadOptions;
  const named: NamedUpload[] = [];
  for (const option of uploadOptions[tool] ?? []) {
    const kind = uploadKinds[tool]?.[option];
    const value = options[option];
    if (Array.isArray(value)) {
      value.forEach((id, i) => {
        named.push({ option, id: String(id), kind, listed: true, label: `clip ${String(i + 2)}` });
      });
    } else if (typeof value === 'string') {
      named.push({ option, id: value, kind, listed: false, label: `the ${option} file` });
    }
  }
  return named;
}

/** A named upload is the kind of file its option takes, by the type it was uploaded as. */
export function checkKind(named: NamedUpload, mime: string): void {
  const kind = named.kind;
  if (!kind || kind.types.includes(mime)) return;
  throw new ApiError(
    400,
    'BAD_REQUEST',
    kind.title,
    named.listed
      ? `${named.option}: ${named.label} isn’t ${kind.is}.`
      : `${named.option}: ${kind.is}.`,
  );
}

/** A clip the probe found no picture in can't be joined (checked before anything is charged). */
export function checkHasVideo(probe: Probe, label: string): void {
  if (!probe.video) {
    throw new ApiError(
      422,
      'UNSUPPORTED_FORMAT',
      'A clip has no video',
      `${label.charAt(0).toUpperCase()}${label.slice(1)} has no picture in it, only sound.`,
    );
  }
}

export interface Input {
  bytes: number;
  probe: Probe;
}

/**
 * The tier's limits (`limits.server` in the registry) for the files that
 * count: the job's own upload, and any more videos. Each file's pixels; one
 * file's length; several files' length and size in all (Merge Videos' limits
 * are the clips together, as in the browser). Each upload's own size was
 * checked when it began. Answers their length together: what a per-minute
 * price is for.
 */
export function checkInputs(
  tool: Pick<ToolDef, 'id' | 'name' | 'limits'>,
  tier: 'free' | 'paid',
  inputs: readonly Input[],
): number {
  const limit = limitsOf(tool)?.server?.[tier];
  if (!limit) {
    throw new ApiError(409, 'TOOL_UNAVAILABLE', `${tool.name} doesn’t run on our servers yet`);
  }
  for (const { probe } of inputs) {
    const pixels = (probe.video?.width ?? 0) * (probe.video?.height ?? 0);
    if (limit.maxPixels !== undefined && pixels > limit.maxPixels) {
      throw new ApiError(413, 'FILE_TOO_LARGE', 'Too many pixels', undefined, {
        max_pixels: limit.maxPixels,
      });
    }
  }
  const several = inputs.length > 1;
  const durationMs = inputs.reduce((sum, input) => sum + (input.probe.duration_ms ?? 0), 0);
  const seconds = durationMs / 1000;
  if (limit.maxDurationSec !== undefined && seconds > limit.maxDurationSec) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      'Too long',
      `${several ? 'These clips come to' : 'This is'} ${(seconds / 60).toFixed(1)} min${several ? ' together' : ''}; the limit for ${tool.name} is ${String(limit.maxDurationSec / 60)} min.`,
      { max_duration_sec: limit.maxDurationSec },
    );
  }
  const bytes = inputs.reduce((sum, input) => sum + input.bytes, 0);
  if (several && bytes > limit.maxBytes) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      'Too large',
      `These clips come to ${formatBytes(bytes)} together; the limit for ${tool.name} is ${formatBytes(limit.maxBytes)}.`,
      { max_bytes: limit.maxBytes },
    );
  }
  return durationMs;
}

/**
 * Merge Videos' crossfade overlaps two clips, so it can be at most half the
 * shortest one (as in the browser); said before anything is charged.
 */
export function checkCrossfade(
  toolId: string,
  options: Record<string, unknown>,
  probes: readonly Probe[],
): void {
  if (toolId !== 'merge-videos' || options.transition !== 'crossfade') return;
  const seconds = Number(options.transitionLength);
  const shortest = Math.min(...probes.map((probe) => (probe.duration_ms ?? 0) / 1000));
  if (seconds * 2 > shortest) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'Crossfade too long',
      `A ${String(seconds)} s crossfade needs clips of at least ${String(seconds * 2)} s; the shortest is ${shortest.toFixed(1)} s. Pick a shorter crossfade, or a cut.`,
    );
  }
}

export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? ''}`;
}
