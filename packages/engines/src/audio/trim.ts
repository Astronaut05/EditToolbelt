/**
 * A02 Trim Audio (tools/audio.md): keep a range, or remove it and join the two
 * sides, with optional fades in and out. WAV and FLAC are cut to the sample
 * (PCM stays lossless). MP3, AAC and Opus are copied frame by frame when a
 * kept range has no fades, so nothing is re-encoded; otherwise they are
 * re-encoded in their own codec. The waveform for the timeline is drawn from
 * a quick peak scan.
 */
import { AudioSample, AudioSampleSink, Quality, type AudioCodec } from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { codecLabel, convert, MediaInputError, openInput } from '../video/media';
import { encodeAudio } from '../video/encode-audio';
import { AUDIO_TARGETS, ensureEncoder, type AudioFormat } from '../video/extract-audio';
import { checkRange } from '../video/trim';
import { AUDIO_LIMITS } from './convert';

export interface TrimAudioOptions {
  /** keep (the selection) or remove (it, joining what's either side) */
  mode?: string;
  start?: number;
  end?: number;
  /** Fade lengths in ms. */
  fadeIn?: string;
  fadeOut?: string;
  /** keep, or a format from AUDIO_TARGETS */
  format?: string;
}

/** The output for a source codec when the format is kept. */
const KEEP: Partial<Record<AudioCodec, AudioFormat>> = {
  mp3: 'mp3',
  aac: 'm4a',
  opus: 'ogg',
  flac: 'flac',
  'pcm-s16': 'wav',
  'pcm-s24': 'wav',
  'pcm-f32': 'wav',
};

/** The fade on each side of a join, seconds: short enough to hear as a cut, long enough not to click. */
export const JOIN_FADE = 0.005;

/**
 * Gain at time `t` (seconds from the start of the kept range, `length` long):
 * a linear ramp up over `fadeIn` and down over `fadeOut`.
 */
export function fadeGain(t: number, length: number, fadeIn: number, fadeOut: number): number {
  let gain = 1;
  if (fadeIn > 0 && t < fadeIn) gain = Math.max(0, t / fadeIn);
  const left = length - t;
  if (fadeOut > 0 && left < fadeOut) gain = Math.min(gain, Math.max(0, left / fadeOut));
  return gain;
}

/**
 * Drops the frames of `sample` that fall in [start, end) and moves the ones
 * after it back by the gap, so the two sides meet. Null when nothing is left.
 */
export function cutOut(sample: AudioSample, start: number, end: number): AudioSample | null {
  const rate = sample.sampleRate;
  const frames = sample.numberOfFrames;
  const gap = end - start;
  const stop = Math.min(frames, Math.max(0, Math.round((start - sample.timestamp) * rate)));
  const resume = Math.min(frames, Math.max(0, Math.round((end - sample.timestamp) * rate)));
  if (stop >= frames) return sample;
  if (resume <= 0) {
    const moved = sample.clone();
    moved.setTimestamp(sample.timestamp - gap);
    sample.close();
    return moved;
  }
  const kept = stop + frames - resume;
  if (kept <= 0) {
    sample.close();
    return null;
  }
  const channels = sample.numberOfChannels;
  const data = new Float32Array(kept * channels);
  for (let c = 0; c < channels; c += 1) {
    const plane = data.subarray(c * kept, (c + 1) * kept);
    if (stop > 0) {
      sample.copyTo(plane.subarray(0, stop), {
        planeIndex: c,
        format: 'f32-planar',
        frameOffset: 0,
        frameCount: stop,
      });
    }
    if (resume < frames) {
      sample.copyTo(plane.subarray(stop), {
        planeIndex: c,
        format: 'f32-planar',
        frameOffset: resume,
        frameCount: frames - resume,
      });
    }
  }
  const out = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels,
    sampleRate: rate,
    timestamp: stop > 0 ? sample.timestamp : sample.timestamp + resume / rate - gap,
  });
  sample.close();
  return out;
}

/** Multiplies every frame by `gain(t)`, `t` being the frame's timestamp. */
function shaped(sample: AudioSample, gain: (t: number) => number): AudioSample {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const data = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c += 1) {
    const plane = data.subarray(c * frames, (c + 1) * frames);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < frames; i += 1) {
      plane[i] = (plane[i] ?? 0) * gain(sample.timestamp + i / sample.sampleRate);
    }
  }
  const out = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
  sample.close();
  return out;
}

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
  capabilities: () => ({ supported: true }),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 60_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
    }
    const input = openInput(file);
    try {
      const source = await input.getPrimaryAudioTrack();
      if (!source) throw new MediaInputError('This file has no audio in it.');
      const duration = await input.computeDuration();
      const [start, end] = checkRange(opts.start ?? 0, opts.end ?? duration, duration);
      const remove = opts.mode === 'remove';
      if (remove && start <= 0.001 && end >= duration - 0.001) {
        throw new MediaInputError('That removes the whole file. Select only the part to remove.');
      }
      const length = remove ? duration - (end - start) : end - start;
      const fadeIn = Math.max(0, Number(opts.fadeIn) || 0) / 1000;
      const fadeOut = Math.max(0, Number(opts.fadeOut) || 0) / 1000;
      if (fadeIn + fadeOut > length) {
        throw new MediaInputError('The fades are longer than the part you kept. Shorten them.');
      }
      const sourceCodec = await source.getCodec();
      const keepFormat = sourceCodec ? KEEP[sourceCodec] : undefined;
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
      // A kept range of a lossy file in its own format, without fades, is copied frame by frame.
      const copy = sourceCodec === codec && lossy && !fades && !remove;
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
      // Encoded audio starts at 0: at `start` when keeping, at the file's start when
      // removing, so the join sits at `start`.
      const gain = (t: number) =>
        fadeGain(t, length, fadeIn, fadeOut) *
        (remove && start > 0 ? Math.min(1, Math.abs(t - start) / JOIN_FADE) : 1);
      const progress = (f: number) => {
        ctx.progress(f, copy ? 'Copying' : 'Trimming');
      };
      const out = copy
        ? await convert(
            {
              input,
              format: target.format(),
              trim: { start, end },
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
                ...(!remove && { start, end }),
                ...((fades || remove) && {
                  process: (sample: AudioSample) => {
                    const kept = remove ? cutOut(sample, start, end) : sample;
                    return kept && shaped(kept, gain);
                  },
                }),
              },
              ctx.signal,
              progress,
            )),
            dropped: [],
          };
      const notes = [
        remove
          ? `Removed ${secs(start)} – ${secs(end)}; ${secs(length)} left`
          : `Kept ${secs(start)} – ${secs(end)} (${secs(length)})`,
        copy
          ? `Copied without re-encoding, cut at the nearest ${codecLabel(sourceCodec)} frame`
          : lossy
            ? `Re-encoded as ${codecLabel(codec)}${fades ? ' for the fades' : remove ? ' to join the two parts' : ''}`
            : `${codecLabel(codec.startsWith('pcm') ? 'PCM' : codec)}: cut to the sample, lossless`,
        ...(remove && start > 0 && end < duration
          ? [`A ${String(JOIN_FADE * 1000)} ms fade either side of the join, so it doesn’t click`]
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
