/**
 * V07 Mute Video (tools/video.md): the audio goes, the picture is copied
 * packet for packet (no decode, no re-encode). Muting only a range keeps the
 * audio track but re-encodes it, silent between the two times with 10 ms
 * fades so there's no click; the picture is still a copy.
 */
import { AudioSample, getFirstEncodableAudioCodec, type AudioCodec } from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { codecLabel, convert, MediaInputError, openInput } from './media';
import { checkRange, containerFormat, sourceFamily } from './trim';

export interface MuteOptions {
  /** all (remove the audio track) or range (silence part of it) */
  mode?: string;
  /** Range, seconds. */
  start?: number;
  end?: number;
}

/** Fade in and out of the silence, seconds. */
export const MUTE_FADE = 0.01;

/**
 * The gain for a sample at time `t`: 0 inside the range, 1 outside, and a
 * linear ramp over `fade` seconds at each edge, inside the range.
 */
export function muteGain(t: number, start: number, end: number, fade = MUTE_FADE): number {
  if (t <= start || t >= end) return 1;
  const into = t - start;
  const left = end - t;
  const edge = Math.min(into, left);
  return edge >= fade ? 0 : 1 - edge / fade;
}

/** Silences planar samples in place, given the time of the first one. */
export function silence(
  planes: Float32Array[],
  timestamp: number,
  sampleRate: number,
  start: number,
  end: number,
): boolean {
  const frames = planes[0]?.length ?? 0;
  const last = timestamp + frames / sampleRate;
  if (last <= start || timestamp >= end) return false;
  for (let i = 0; i < frames; i += 1) {
    const gain = muteGain(timestamp + i / sampleRate, start, end);
    if (gain === 1) continue;
    for (const plane of planes) plane[i] = (plane[i] ?? 0) * gain;
  }
  return true;
}

function muted(sample: AudioSample, start: number, end: number): AudioSample {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const planes = Array.from({ length: channels }, (_, planeIndex) => {
    const plane = new Float32Array(frames);
    sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
    return plane;
  });
  if (!silence(planes, sample.timestamp, sample.sampleRate, start, end)) return sample;
  const data = new Float32Array(frames * channels);
  planes.forEach((plane, c) => {
    data.set(plane, c * frames);
  });
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

const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`;

export const muteVideoEngine: Engine<MuteOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: (input) => ({ seconds: Math.max(0.5, input.size / 200_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video)
        throw new MediaInputError('This file has no video track. For audio, use Trim Audio.');
      const audio = await input.getAudioTracks();
      const family = await sourceFamily(input);
      const format = containerFormat(family);
      const duration = await input.computeDuration();
      const notes: string[] = [];

      if (opts.mode !== 'range' || audio.length === 0) {
        const out = await convert({ input, format, audio: { discard: true } }, ctx.signal, (f) => {
          ctx.progress(f, 'Copying the picture');
        });
        notes.push(
          audio.length === 0
            ? 'This video had no audio track already; the picture is copied as it was'
            : `Audio removed (${audio.length === 1 ? 'one track' : `${String(audio.length)} tracks`}); the picture is copied, not re-encoded`,
        );
        return {
          blob: new Blob([out.bytes], { type: out.mime }),
          ext: out.ext,
          durationSec: duration,
          path: 'Browser · stream copy',
          notes,
          details: [{ label: 'Audio', value: 'Removed' }],
        };
      }

      const [start, end] = checkRange(opts.start ?? 0, opts.end ?? duration, duration);
      const source = audio[0];
      const sourceCodec = source ? await source.getCodec() : null;
      if (source && !(await source.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(sourceCodec)} audio, so it can’t mute part of it. Removing all the audio still works.`,
        );
      }
      const codec: AudioCodec | null =
        sourceCodec && (await getFirstEncodableAudioCodec([sourceCodec]))
          ? sourceCodec
          : await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs());
      if (!codec) {
        throw new MediaInputError(
          'This browser can’t encode audio for this file. Removing all the audio still works.',
        );
      }
      const out = await convert(
        {
          input,
          format,
          audio: (track) =>
            track === source
              ? {
                  codec,
                  forceTranscode: true,
                  process: (sample: AudioSample) => muted(sample, start, end),
                }
              : { discard: true },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, 'Muting the range');
        },
      );
      notes.push(
        `Muted ${secs(start)} – ${secs(end)}, with ${String(MUTE_FADE * 1000)} ms fades`,
        codec === sourceCodec
          ? `Audio re-encoded as ${codecLabel(codec)}; the picture is copied, not re-encoded`
          : `Audio re-encoded as ${codecLabel(codec)} (this browser can’t write ${codecLabel(sourceCodec)}); the picture is copied`,
        ...out.dropped,
      );
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        durationSec: duration,
        path: 'Browser · WebCodecs',
        notes,
        details: [{ label: 'Audio', value: `Muted ${secs(start)} – ${secs(end)}` }],
      };
    } finally {
      input.dispose();
    }
  },
};
