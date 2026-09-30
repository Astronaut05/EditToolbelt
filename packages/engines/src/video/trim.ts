/**
 * V01 Trim Video. Keeps or removes one or more ranges and joins what's kept
 * (join.ts). Fast copies the packets without re-encoding: each part starts at
 * the keyframe at or before its In point, so it can begin up to one keyframe
 * interval early, and the result says where. Precise cuts on the frame: VP8
 * and VP9 in WebM or Matroska by smart cut (only the frames from each In point
 * to the next keyframe are re-encoded), anything else by a full re-encode
 * (tools/video.md → Fast vs precise).
 */
import {
  canEncodeVideo,
  EncodedPacketSink,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Quality,
  WebMOutputFormat,
  type Input,
  type InputVideoTrack,
  type OutputFormat,
} from 'mediabunny';

import { keptSpans, normalizeRanges, type Span } from '@etb/core';

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
import { joinParts, VIDEO_JOIN_CROSSFADE, type JoinResult } from './join';

export interface TrimOptions {
  /** Seconds. */
  start?: number;
  end?: number;
  /** Several selections (the timeline's ranges), seconds; `start`–`end` when absent. */
  ranges?: Span[];
  /** keep (the selection, joined) or remove (it, joining what's left) */
  selection?: string;
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

/**
 * Whether a precise cut can be a smart cut: VP8 or VP9 (profile 0, 8-bit) in
 * WebM or Matroska going out as WebM or Matroska, unrotated, with an encoder
 * for the same codec at this size. Only then can re-encoded and copied frames
 * share a track.
 */
async function smartCutFits(video: InputVideoTrack, family: Family, wanted?: string) {
  if ((family !== 'webm' && family !== 'mkv') || wanted === 'mp4') return false;
  const codec = await video.getCodec();
  if (codec !== 'vp8' && codec !== 'vp9') return false;
  const config = await video.getDecoderConfig();
  if (codec === 'vp9' && !config?.codec.startsWith('vp09.00.')) return false;
  if ((await video.getRotation()) !== 0 || (await video.getFlip())) return false;
  const size = { width: await video.getCodedWidth(), height: await video.getCodedHeight() };
  return (await video.canDecode()) && (await canEncodeVideo(codec, size));
}

/** Shorter than this, what's left beside a removed range isn't kept: under two frames at 50 fps. */
const MIN_LEFT = 0.04;

const parts = (n: number) => (n === 1 ? '1 part' : `${String(n)} parts`);

/** The notes and details every joined trim shares: what was kept, and how the audio went. */
function joinNotes(out: JoinResult, remove: boolean, removed: number): string[] {
  const joins = out.parts.length - 1;
  return [
    remove
      ? `Removed ${parts(removed)}; ${secs(out.length)} left`
      : `Kept ${parts(out.parts.length)}, joined: ${secs(out.length)}`,
    ...(joins > 0 && out.audio === 'spliced'
      ? [
          `The audio crossfades over ${String(VIDEO_JOIN_CROSSFADE * 1000)} ms at ${joins === 1 ? 'the join' : `each of the ${String(joins)} joins`}, so it doesn’t click`,
        ]
      : []),
    ...out.notes,
  ];
}

export const trimEngine: Engine<TrimOptions> = {
  ...MEDIA_META.trim,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      const duration = await input.computeDuration();
      const selection = checkRanges(opts, duration);
      const remove = opts.selection === 'remove';
      // What's left beside a removed range can be a sliver, the container's
      // rounding past the last frame: not a part.
      const spans = keptSpans(selection, duration, remove ? 'remove' : 'keep').filter(
        (s) => !remove || s.end - s.start >= MIN_LEFT,
      );
      if (spans.length === 0) {
        throw new MediaInputError('That removes the whole video. Select only the parts to remove.');
      }
      const [only] = spans.length === 1 ? spans : [];
      const family = await sourceFamily(input);
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      const notes: string[] = [];
      const details: { label: string; value: string }[] = [];
      const join = (
        mode: 'copy' | 'smart' | 'encode',
        format: OutputFormat,
        label: string,
        extra?: { videoCodec: 'avc' | 'vp9'; audioCodec: 'aac' | 'opus' },
      ) => {
        if (!video) throw new MediaInputError('This file has no video in it.');
        return joinParts(
          { input, video, audio, spans, mode, format, ...extra },
          ctx.signal,
          (f) => {
            ctx.progress(f, label);
          },
        );
      };

      if (opts.mode !== 'precise') {
        if (!only) {
          const out = await join('copy', containerFormat(family), 'Copying');
          const early = out.parts.filter((p, i) => p.start < (spans[i]?.start ?? 0) - 0.001);
          notes.push(
            ...joinNotes(out, remove, selection.length),
            early.length > 0
              ? `Fast (no re-encode): each part starts at the keyframe at or before its In point, up to ${secs(Math.max(...out.parts.map((p, i) => (spans[i]?.start ?? 0) - p.start)))} early. Pick Precise to cut on the frame.`
              : 'Fast (no re-encode): every part starts on a keyframe, so no quality is lost',
          );
          details.push(
            { label: 'Mode', value: 'Fast · copied' },
            { label: 'Parts', value: String(out.parts.length) },
          );
          return result(out, out.length, notes, details, 'Browser · stream copy');
        }
        const { start, end } = only;
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
        if (remove) notes.push(`Removed ${parts(selection.length)}; ${secs(end - from)} left`);
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

      if (video && (await smartCutFits(video, family, opts.format))) {
        const out = await join(
          'smart',
          containerFormat(family === 'mkv' && opts.format !== 'webm' ? 'mkv' : 'webm'),
          'Cutting',
        );
        const reencoded = out.parts.reduce((sum, p) => sum + p.reencoded, 0);
        const codec = codecLabel(await video.getCodec());
        notes.push(
          ...(only && !remove ? [] : joinNotes(out, remove, selection.length)),
          reencoded > 0.001
            ? `Smart cut: re-encoded ${secs(reencoded)} as ${codec} at the ${out.parts.length === 1 ? 'cut' : 'cuts'}, up to the next keyframe; the other ${secs(out.length - reencoded)} copied untouched`
            : `Smart cut: every cut is on a keyframe, so nothing was re-encoded`,
        );
        details.push(
          { label: 'Mode', value: 'Precise · smart cut' },
          only
            ? { label: 'Cut', value: `${secs(only.start)} – ${secs(only.end)}` }
            : { label: 'Parts', value: String(out.parts.length) },
          { label: 'Re-encoded', value: secs(reencoded) },
        );
        return result(out, out.length, notes, details, 'Browser · smart cut');
      }

      const wanted: Container =
        opts.format === 'webm' || (opts.format !== 'mp4' && family === 'webm') ? 'webm' : 'mp4';
      const plan = await pickOutput(
        wanted,
        {
          width: (await video?.getDisplayWidth()) ?? 1280,
          height: (await video?.getDisplayHeight()) ?? 720,
        },
        { needsEncode: !only, copyable: !!only && (await audio?.getCodec()) === 'aac' },
      );
      if (plan.note) notes.push(plan.note);
      const format = containerFormat(
        plan.container === 'mp4' ? (family === 'mov' ? 'mov' : 'mp4') : 'webm',
      );
      if (!only) {
        const out = await join('encode', format, 'Re-encoding', {
          videoCodec: plan.video,
          audioCodec: plan.audio,
        });
        notes.push(
          ...joinNotes(out, remove, selection.length),
          `Precise: re-encoded as ${codecLabel(plan.video)}, cut on the frame`,
        );
        details.push(
          { label: 'Mode', value: 'Precise · re-encoded' },
          { label: 'Parts', value: String(out.parts.length) },
        );
        return result(out, out.length, notes, details, 'Browser · WebCodecs');
      }
      const { start, end } = only;
      const out = await convert(
        {
          input,
          format,
          trim: { start, end },
          video: { forceTranscode: true, codec: plan.video, quality: new Quality('high') },
          audio: { codec: plan.audio, quality: new Quality('high') },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, 'Re-encoding');
        },
      );
      if (remove) notes.push(`Removed ${parts(selection.length)}; ${secs(end - start)} left`);
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
