/**
 * V01 Trim Video. Fast copies the packets without re-encoding: the cut
 * starts at the keyframe at or before the In point, so it can begin up to one
 * keyframe interval early, and the result says where. Precise re-encodes the
 * video so the cut lands on the frame; audio is copied when the container
 * takes it (tools/video.md → Fast vs precise).
 */
import {
  EncodedPacketSink,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Quality,
  WebMOutputFormat,
  type Input,
  type OutputFormat,
} from 'mediabunny';

import { normalizeRanges, type Span } from '@etb/core';

import type { Engine, EngineOutput } from '../types';
import {
  codecLabel,
  convert,
  MediaInputError,
  openInput,
  pickOutput,
  type Container,
} from './media';
import { MEDIA_META } from '../media-meta';

export interface TrimOptions {
  /** Seconds. */
  start?: number;
  end?: number;
  /** fast (copy, cut at keyframes) or precise (re-encode, cut on the frame) */
  mode?: string;
  /** keep, mp4 or webm (precise only; fast keeps the file's own format) */
  format?: string;
}

type Family = 'mp4' | 'mov' | 'webm' | 'mkv';

const FAMILY_BY_MIME: Record<string, Family> = {
  'video/mp4': 'mp4',
  'audio/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'video/x-matroska': 'mkv',
};

export function containerFormat(family: Family): OutputFormat {
  switch (family) {
    case 'mp4':
      return new Mp4OutputFormat({ fastStart: 'in-memory' });
    case 'mov':
      return new MovOutputFormat({ fastStart: 'in-memory' });
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
  }
}

export async function sourceFamily(input: Input): Promise<Family> {
  return FAMILY_BY_MIME[(await input.getFormat()).mimeType] ?? 'mp4';
}

/** The keyframe at or before a time: where a copy can start. */
export async function keyframeBefore(input: Input, time: number): Promise<number> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return time;
  const packet = await new EncodedPacketSink(track).getKeyPacket(time, { verifyKeyPackets: true });
  return packet ? Math.max(0, packet.timestamp) : 0;
}

/** At most this many ranges in one trim: the timeline's chips, and a bound for the API. */
export const MAX_RANGES = 50;

/**
 * The selection as ranges, in order and apart: `ranges` when the timeline
 * sent several, else `start`–`end`. The page's Timeline keeps them valid, the
 * API may not.
 */
export function checkRanges(
  opts: {
    ranges?: readonly Span[] | undefined;
    start?: number | undefined;
    end?: number | undefined;
  },
  duration: number,
): Span[] {
  if (opts.ranges && opts.ranges.length > MAX_RANGES) {
    throw new MediaInputError(`That’s more than ${String(MAX_RANGES)} ranges. Join some of them.`);
  }
  const picked = opts.ranges?.length
    ? opts.ranges
    : [{ start: opts.start ?? 0, end: opts.end ?? duration }];
  const ranges = normalizeRanges(picked, duration);
  if (ranges.reduce((sum, r) => sum + r.end - r.start, 0) < 0.05) {
    throw new MediaInputError('The selection is empty. Set In before Out.');
  }
  return ranges;
}

/** Checks a range against the clip; the page's Timeline keeps it valid, the API may not. */
export function checkRange(start: number, end: number, duration: number): [number, number] {
  const s = Math.max(0, Number.isFinite(start) ? start : 0);
  const e = Math.min(duration, Number.isFinite(end) ? end : duration);
  if (e - s < 0.05) throw new MediaInputError('The selection is empty. Set In before Out.');
  return [s, e];
}

const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`;

export const trimEngine: Engine<TrimOptions> = {
  ...MEDIA_META.trim,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      const duration = await input.computeDuration();
      const [start, end] = checkRange(opts.start ?? 0, opts.end ?? duration, duration);
      const family = await sourceFamily(input);
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      const notes: string[] = [];
      const details: { label: string; value: string }[] = [];

      if (opts.mode !== 'precise') {
        const from = await keyframeBefore(input, start);
        const out = await convert(
          {
            input,
            format: containerFormat(family),
            trim: { start: from, end },
            copy: { mode: 'forced', boundaryPolicy: 'expand' },
          },
          ctx.signal,
          (f) => {
            ctx.progress(f, 'Copying');
          },
        );
        notes.push(
          from < start - 0.001
            ? `Fast (no re-encode): starts at the keyframe at ${secs(from)}, ${secs(start - from)} before your In point. Pick Precise to cut on the frame.`
            : 'Fast (no re-encode): no quality lost',
          ...out.dropped,
        );
        details.push(
          { label: 'Mode', value: 'Fast · copied' },
          { label: 'Cut', value: `${secs(from)} – ${secs(end)}` },
        );
        return result(out, end - from, notes, details, 'Browser · stream copy');
      }

      const wanted: Container =
        opts.format === 'webm' || (opts.format !== 'mp4' && family === 'webm') ? 'webm' : 'mp4';
      const plan = await pickOutput(
        wanted,
        {
          width: (await video?.getDisplayWidth()) ?? 1280,
          height: (await video?.getDisplayHeight()) ?? 720,
        },
        { needsEncode: false, copyable: (await audio?.getCodec()) === 'aac' },
      );
      if (plan.note) notes.push(plan.note);
      const out = await convert(
        {
          input,
          format: containerFormat(
            plan.container === 'mp4' ? (family === 'mov' ? 'mov' : 'mp4') : 'webm',
          ),
          trim: { start, end },
          video: { forceTranscode: true, codec: plan.video, quality: new Quality('high') },
          audio: { codec: plan.audio, quality: new Quality('high') },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, 'Re-encoding');
        },
      );
      notes.push(
        `Precise: re-encoded as ${codecLabel(plan.video)}, cut on the frame`,
        ...out.dropped,
      );
      details.push(
        { label: 'Mode', value: 'Precise · re-encoded' },
        { label: 'Cut', value: `${secs(start)} – ${secs(end)}` },
      );
      return result(out, end - start, notes, details, 'Browser · WebCodecs');
    } finally {
      input.dispose();
    }
  },
};

function result(
  out: { bytes: ArrayBuffer; mime: string; ext: string },
  durationSec: number,
  notes: string[],
  details: { label: string; value: string }[],
  path: string,
): EngineOutput {
  return {
    blob: new Blob([out.bytes], { type: out.mime }),
    ext: out.ext,
    durationSec,
    path,
    notes,
    details,
  };
}
