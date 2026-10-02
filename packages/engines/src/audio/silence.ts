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

/** Levels already read, by file: changing a setting finds again without decoding again. */
const read = new WeakMap<Blob, Promise<{ levels: Float32Array; duration: number }>>();

function levelsOf(file: Blob) {
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
        const scan = new LevelScan(await track.getSampleRate(), await track.getNumberOfChannels());
        for await (const sample of new AudioSampleSink(track).samples()) {
          scan.push(
            Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
              const plane = new Float32Array(sample.numberOfFrames);
              sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
              return plane;
            }),
          );
          sample.close();
        }
        return { levels: scan.finish(), duration: await track.computeDuration() };
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
