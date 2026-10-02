/**
 * A02 Trim Audio (tools/audio.md): keep one or more ranges, or remove them,
 * and join what's left with a 10 ms crossfade at each join, with optional
 * fades in and out. WAV and FLAC are cut to the sample (PCM stays lossless).
 * MP3, AAC and Opus are copied frame by frame when one part is kept without
 * fades, so nothing is re-encoded; otherwise they are re-encoded in their own
 * codec. The waveform for the timeline is drawn from a quick peak scan.
 */
import { keptSpans, layoutSpans, type Span } from '@etb/core';
import { AudioSampleSink, Quality, type AudioCodec } from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { codecLabel, convert, MediaInputError, openInput } from '../video/media';
import { encodeAudio } from '../video/encode-audio';
import {
  AUDIO_TARGETS,
  type AudioFormat,
  ensureEncoder,
  KEEP_FORMAT,
} from '../video/extract-audio';
import { checkRanges } from '../video/trim';
import { AUDIO_LIMITS } from './convert';
import { MEDIA_META } from '../media-meta';

export interface TrimAudioOptions {
  /** keep (the selection) or remove (it, joining what's either side) */
  mode?: string;
  start?: number;
  end?: number;
  /** Several selections (the timeline's ranges), seconds; `start`–`end` when absent. */
  ranges?: Span[];
  /** Fade lengths in ms. */
  fadeIn?: string;
  fadeOut?: string;
  /** keep, or a format from AUDIO_TARGETS */
  format?: string;
}

/** The crossfade centred on each join, seconds: heard as a cut, but it doesn't click. */
export const JOIN_CROSSFADE = 0.01;

/** Peaks (0-1) for `buckets` equal slices of the audio: the waveform. */
export async function audioPeaks(file: Blob, buckets: number): Promise<number[]> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return [];
    const duration = await input.computeDuration();
    const peaks = new Array<number>(buckets).fill(0);
    for await (const sample of new AudioSampleSink(track).samples()) {
      const frames = sample.numberOfFrames;
      const plane = new Float32Array(frames);
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      for (let i = 0; i < frames; i += 32) {
        const t = sample.timestamp + i / sample.sampleRate;
        const b = Math.min(buckets - 1, Math.max(0, Math.floor((t / duration) * buckets)));
        const v = Math.abs(plane[i] ?? 0);
        if (v > (peaks[b] ?? 0)) peaks[b] = v;
      }
      sample.close();
    }
    return peaks;
  } finally {
    input.dispose();
  }
}

const secs = (t: number) => `${t.toFixed(3)} s`;

export const trimAudioEngine: Engine<TrimAudioOptions> = {
  ...MEDIA_META.trimAudio,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
    }
    const input = openInput(file);
    try {
      const source = await input.getPrimaryAudioTrack();
      if (!source) throw new MediaInputError('This file has no audio in it.');
      const duration = await input.computeDuration();
      const selection = checkRanges(opts, duration);
      const remove = opts.mode === 'remove';
      const spans = keptSpans(selection, duration, remove ? 'remove' : 'keep');
      if (spans.length === 0) {
        throw new MediaInputError('That removes the whole file. Select only the part to remove.');
      }
      const { length } = layoutSpans(spans);
      const fadeIn = Math.max(0, Number(opts.fadeIn) || 0) / 1000;
      const fadeOut = Math.max(0, Number(opts.fadeOut) || 0) / 1000;
      if (fadeIn + fadeOut > length) {
        throw new MediaInputError('The fades are longer than the part you kept. Shorten them.');
      }
      const joins = spans.length - 1;
      const sourceCodec = await source.getCodec();
      const keepFormat = sourceCodec ? KEEP_FORMAT[sourceCodec] : undefined;
      const format: AudioFormat =
        opts.format && opts.format in AUDIO_TARGETS
          ? (opts.format as AudioFormat)
          : (keepFormat ?? 'wav');
      const target = AUDIO_TARGETS[format];
      // PCM keeps its own sample format; other targets use theirs.
      const codec: AudioCodec =
        format === 'wav' && sourceCodec?.startsWith('pcm') ? sourceCodec : target.codec;
      const lossy = target.lossy;
      const fades = fadeIn > 0 || fadeOut > 0;
      // One kept part of a lossy file in its own format, without fades, is copied frame by frame.
      const only = joins === 0 ? spans[0] : undefined;
      const copy = sourceCodec === codec && lossy && !fades && only !== undefined;
      if (!copy) {
        if (!(await source.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode the ${codecLabel(sourceCodec)} audio in this file.`,
          );
        }
        await ensureEncoder(codec);
      }
      const bitrate = copy
        ? null
        : ((await source.getAverageBitrate().catch(() => null)) ?? 192_000);
      const progress = (f: number) => {
        ctx.progress(f, copy ? 'Copying' : 'Trimming');
      };
      const out = copy
        ? await convert(
            {
              input,
              format: target.format(),
              trim: { start: only.start, end: only.end },
              video: { discard: true },
              copy: { mode: 'forced', boundaryPolicy: 'expand' },
              audio: (track) => (track === source ? {} : { discard: true }),
            },
            ctx.signal,
            progress,
          )
        : {
            ...(await encodeAudio(
              {
                input,
                track: source,
                format: target.format(),
                codec,
                ...(lossy && bitrate && { quality: new Quality({ bitrate }) }),
                splice: { spans, crossfade: JOIN_CROSSFADE, fadeIn, fadeOut },
              },
              ctx.signal,
              progress,
            )),
            dropped: [],
          };
      const first = selection[0];
      const parts = (n: number) => (n === 1 ? 'part' : `${String(n)} parts`);
      const notes = [
        remove
          ? selection.length === 1 && first
            ? `Removed ${secs(first.start)} – ${secs(first.end)}; ${secs(length)} left`
            : `Removed ${parts(selection.length)}; ${secs(length)} left`
          : spans.length === 1 && only
            ? `Kept ${secs(only.start)} – ${secs(only.end)} (${secs(length)})`
            : `Kept ${parts(spans.length)}, joined: ${secs(length)}`,
        copy
          ? `Copied without re-encoding, cut at the nearest ${codecLabel(sourceCodec)} frame`
          : lossy
            ? `Re-encoded as ${codecLabel(codec)}${fades ? ' for the fades' : joins > 0 ? ' to join the parts' : ''}`
            : `${codecLabel(codec.startsWith('pcm') ? 'PCM' : codec)}: cut to the sample, lossless`,
        ...(joins > 0
          ? [
              `A ${String(JOIN_CROSSFADE * 1000)} ms crossfade at ${joins === 1 ? 'the join' : `each of the ${String(joins)} joins`}, so ${joins === 1 ? 'it doesn’t' : 'they don’t'} click`,
            ]
          : []),
        ...(fades
          ? [
              `Fades: ${String(Math.round(fadeIn * 1000))} ms in, ${String(Math.round(fadeOut * 1000))} ms out`,
            ]
          : []),
        ...out.dropped,
      ];
      return {
        blob: new Blob([out.bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: length,
        path: copy ? 'Browser · stream copy' : 'Browser · WebCodecs',
        notes,
        details: [{ label: 'Length', value: secs(length) }],
      };
    } finally {
      input.dispose();
    }
  },
};
