/**
 * A11 Remove Silence (tools/audio.md): the audio's level every 10 ms is read
 * once per file, then the silences are found for whatever threshold, length
 * and padding are set, as the timeline's ranges to cut. The cut itself is
 * Trim Audio's: the ranges removed, the rest joined with a 10 ms crossfade.
 * Or the cut list as CSV, to make the same cuts to a video in an editor.
 */
import { autoThreshold, cutsCsv, findSilences, LevelScan, silenceCuts, type Span } from '@etb/core';
import { AudioSampleSink } from 'mediabunny';

import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS } from './convert';
import { trimAudioEngine, type TrimAudioOptions } from './trim';

export interface SilenceOptions {
  /** "auto", or dBFS ("-40"). */
  threshold?: string;
  /** Shortest silence that counts, seconds. */
  minSilence?: string;
  /** remove or shorten. */
  mode?: string;
  /** Remove: quiet kept beside the sound either side, seconds. */
  padding?: string;
  /** Shorten: pause left, seconds. */
  keep?: string;
}

const QUIET = new Float32Array(4096);

/**
 * Decoded blocks read into levels on the track's own timeline, the one the
 * cut is made on (encode-audio → seamless; loudness.ts → scanFile keeps the
 * same one). Blocks laid end to end are not that timeline: a track that
 * starts half a second in, or has a gap, would have every silence, cut and
 * split point that much early. So a block that starts after the last one
 * ended has silence before it, and frames that overlap what was read are
 * dropped; two frames either way are rounding. The rate is the decoder's:
 * a track can declare another (HE-AAC declares half).
 */
export function timedLevels() {
  let scan: LevelScan | undefined;
  let next = 0;
  return {
    push(planes: Float32Array[], timestamp: number, rate: number): void {
      scan ??= new LevelScan(rate, planes.length);
      const gap = Math.round(timestamp * rate) - next;
      let block = planes;
      if (gap > 2) {
        // A plane the scan isn't given counts as silence, so one quiet plane does for all.
        for (let left = gap; left > 0; left -= QUIET.length) {
          scan.push([QUIET.subarray(0, Math.min(left, QUIET.length))]);
        }
        next += gap;
      } else if (gap < -2) {
        block = planes.map((plane) => plane.subarray(Math.min(plane.length, -gap)));
      }
      scan.push(block);
      next += block[0]?.length ?? 0;
    },
    finish: (): Float32Array => scan?.finish() ?? new Float32Array(0),
  };
}

/** Levels already read, by file: changing a setting finds again without decoding again (A11, A14). */
const read = new WeakMap<Blob, Promise<{ levels: Float32Array; duration: number }>>();

export function levelsOf(file: Blob) {
  let found = read.get(file);
  if (!found) {
    found = (async () => {
      if (file.size > AUDIO_LIMITS.maxBytes) {
        throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
      }
      const input = openInput(file);
      try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !(await track.canDecode())) {
          throw new MediaInputError('This browser can’t decode the audio in this file.');
        }
        const timed = timedLevels();
        for await (const sample of new AudioSampleSink(track).samples()) {
          timed.push(
            Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
              const plane = new Float32Array(sample.numberOfFrames);
              sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
              return plane;
            }),
            sample.timestamp,
            sample.sampleRate,
          );
          sample.close();
        }
        return { levels: timed.finish(), duration: await track.computeDuration() };
      } finally {
        input.dispose();
      }
    })();
    found.catch(() => {
      read.delete(file);
    });
    read.set(file, found);
  }
  return found;
}

const seconds = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The ranges to cut, for the timeline: the silences found with these settings. */
export async function detectSilences(
  file: Blob,
  opts: SilenceOptions,
): Promise<{ cuts: Span[]; threshold: number; duration: number }> {
  const { levels, duration } = await levelsOf(file);
  const threshold =
    opts.threshold && opts.threshold !== 'auto' ? Number(opts.threshold) : autoThreshold(levels);
  const silences = findSilences(levels, threshold, seconds(opts.minSilence, 0.5));
  const cuts = silenceCuts(silences, duration, {
    mode: opts.mode === 'shorten' ? 'shorten' : 'remove',
    padding: seconds(opts.padding, 0.1),
    keep: seconds(opts.keep, 0.3),
  });
  return { cuts, threshold, duration };
}

export interface RemoveSilenceOptions extends Pick<TrimAudioOptions, 'format'> {
  /** The timeline's ranges: what to cut. */
  ranges?: Span[];
  start?: number;
  end?: number;
  /** audio, or csv (the cut list). */
  export?: string;
}

const secs = (t: number) => `${t.toFixed(2)} s`;

export const removeSilenceEngine: Engine<RemoveSilenceOptions> = {
  ...MEDIA_META.trimAudio,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const cuts = opts.ranges ?? [];
    if (cuts.length === 0) {
      throw new MediaInputError(
        'There are no silences to cut. Lower the threshold or the minimum length.',
      );
    }
    const total = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
    const summary = `${String(cuts.length)} ${cuts.length === 1 ? 'silence' : 'silences'} cut, ${secs(total)} in all`;
    if (opts.export === 'csv') {
      return {
        blob: new Blob([cutsCsv(cuts)], { type: 'text/csv' }),
        ext: 'csv',
        nameSuffix: 'cuts',
        path: 'Browser',
        notes: [summary, 'The cut list: start and end of each cut, as a timecode and in seconds'],
        details: [{ label: 'Cuts', value: String(cuts.length) }],
      };
    }
    const out = await trimAudioEngine.run(
      file,
      {
        mode: 'remove',
        ranges: cuts,
        start: cuts[0]?.start,
        end: cuts[0]?.end,
        format: opts.format,
      },
      ctx,
    );
    return {
      ...out,
      nameSuffix: 'trimmed',
      notes: [summary, ...(out.notes ?? []).filter((note) => !note.startsWith('Removed '))],
      details: [{ label: 'Cut', value: secs(total) }, ...(out.details ?? [])],
    };
  },
};
