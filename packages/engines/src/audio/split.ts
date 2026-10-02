/**
 * A14 Split Audio (tools/audio.md): one file cut into parts, each saved as a
 * file and all of them in one ZIP. The parts are the timeline's ranges,
 * filled in from the settings (@etb/core's equalParts, pieceParts and
 * silenceParts) and changeable by hand before the split. Each part is a
 * Trim Audio "keep": WAV and FLAC cut to the sample, and MP3, AAC and Opus
 * in their own format copied frame by frame, so nothing is re-encoded.
 */
import {
  autoThreshold,
  equalParts,
  findSilences,
  MAX_PARTS,
  pieceParts,
  silenceParts,
  type Span,
} from '@etb/core';
import { zipSync } from 'fflate';

import { MEDIA_META } from '../media-meta';
import { safeStem } from '../names';
import type { Engine, EngineOutput } from '../types';
import { MediaInputError } from '../video/media';
import { probeAudio } from './probe';
import { levelsOf } from './silence';
import { trimAudioEngine } from './trim';

export interface SplitAudioOptions {
  /** equal (a number of parts), length (pieces of a set length), silence, or marks (by hand). */
  split?: string;
  parts?: string;
  /** Seconds. */
  pieceLength?: string;
  /** Silence: "auto", or dBFS. */
  threshold?: string;
  /** Silence: the shortest pause that splits, seconds. */
  minSilence?: string;
  /** keep, or a format. */
  format?: string;
  /** The timeline's ranges: the parts. */
  ranges?: Span[];
  start?: number;
  end?: number;
}

/** The parts for the timeline, from the settings. "By hand" starts from the whole file. */
export async function detectSplits(file: Blob, opts: SplitAudioOptions): Promise<Span[]> {
  if (opts.split === 'silence') {
    const { levels, duration } = await levelsOf(file);
    const threshold =
      opts.threshold && opts.threshold !== 'auto' ? Number(opts.threshold) : autoThreshold(levels);
    const minimum = Number(opts.minSilence);
    return silenceParts(
      duration,
      findSilences(levels, threshold, Number.isFinite(minimum) && minimum > 0 ? minimum : 1),
    );
  }
  const { durationSec } = await probeAudio(file);
  if (opts.split === 'length') return pieceParts(durationSec, Number(opts.pieceLength));
  if (opts.split === 'marks') return [{ start: 0, end: durationSec }];
  return equalParts(durationSec, Number(opts.parts));
}

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${String(m)}:${(seconds - m * 60).toFixed(3).padStart(6, '0')}`;
};

export const splitAudioEngine: Engine<SplitAudioOptions> = {
  ...MEDIA_META.trimAudio,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const parts = [
      ...(opts.ranges?.length
        ? opts.ranges
        : opts.start !== undefined && opts.end !== undefined
          ? [{ start: opts.start, end: opts.end }]
          : []),
    ].sort((a, b) => a.start - b.start);
    if (parts.length === 0) throw new MediaInputError('Mark at least one part to save.');
    if (parts.length > MAX_PARTS) {
      throw new MediaInputError(
        `That’s ${String(parts.length)} parts; a split makes up to ${String(MAX_PARTS)}. Join some of them.`,
      );
    }
    const stem = safeStem(file instanceof File ? file.name : 'audio', 'audio');
    const width = Math.max(2, String(parts.length).length);
    const files: Record<string, Uint8Array> = {};
    let ext = '';
    let how = '';
    let path = '';
    let single: EngineOutput | null = null;
    for (const [i, part] of parts.entries()) {
      const step = `Part ${String(i + 1)} of ${String(parts.length)}`;
      const out = await trimAudioEngine.run(
        file,
        { mode: 'keep', start: part.start, end: part.end, format: opts.format },
        {
          signal: ctx.signal,
          progress: (fraction, stage) => {
            ctx.progress((i + fraction) / parts.length, stage, { step });
          },
        },
      );
      ext = out.ext;
      how = out.notes?.[1] ?? how;
      path = out.path;
      files[`${stem}_${String(i + 1).padStart(width, '0')}.${out.ext}`] = new Uint8Array(
        await out.blob.arrayBuffer(),
      );
      if (parts.length === 1) single = out;
    }
    if (single) return single;
    // Audio is already compressed: stored as it is, the ZIP is instant.
    const zip = zipSync(files, { level: 0 });
    const first = parts[0];
    const last = parts.at(-1);
    return {
      blob: new Blob([zip], { type: 'application/zip' }),
      ext: 'zip',
      name: `${stem}_parts.zip`,
      path,
      notes: [
        `${String(parts.length)} parts, ${first && last ? `${clock(first.start)} to ${clock(last.end)}` : ''}, named ${stem}_${'1'.padStart(width, '0')}.${ext} and on`,
        how,
      ].filter(Boolean),
      details: [
        { label: 'Parts', value: String(parts.length) },
        { label: 'Format', value: ext.toUpperCase() },
      ],
    };
  },
};
