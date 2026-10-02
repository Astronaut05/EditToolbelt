/**
 * A08 Change Speed & Pitch (tools/audio.md): tempo without pitch, pitch
 * without tempo, or both together like a record played faster. The sound is
 * decoded, run through @etb/core's TimeStretch and Resampler a block at a
 * time, and encoded in its own format unless another is picked.
 */
import { Resampler, TimeStretch } from '@etb/core';
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  Output,
  Quality,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { AUDIO_LIMITS, MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import {
  AUDIO_TARGETS,
  ensureEncoder,
  KEEP_FORMAT,
  type AudioFormat,
} from '../video/extract-audio';
import { codecLabel, MediaInputError, openInput } from '../video/media';
import { planesOf } from './stream';

export interface PitchOptions {
  /** tempo (keep the pitch), pitch (keep the length) or vinyl (both change). */
  mode?: string;
  /** Tempo or vinyl: % of the original speed, 25-400. */
  tempo?: string;
  /** Pitch: semitones, −12 to +12, and cents, −50 to +50. */
  semitones?: string;
  cents?: string;
  format?: string;
}

/** What a mode does to the sound, as the stretch (output ÷ input length) and the resampling. */
export function pitchPlan(opts: PitchOptions): {
  stretch: number;
  resample: number;
  label: string;
} {
  const mode = opts.mode === 'pitch' || opts.mode === 'vinyl' ? opts.mode : 'tempo';
  if (mode === 'pitch') {
    const semitones = Math.min(12, Math.max(-12, Number(opts.semitones) || 0));
    const cents = Math.min(50, Math.max(-50, Number(opts.cents) || 0));
    const steps = semitones + cents / 100;
    if (steps === 0) throw new MediaInputError('Set a pitch change other than 0.');
    const r = 2 ** (steps / 12);
    const sign = steps > 0 ? '+' : '−';
    const label = `${sign}${String(Math.abs(semitones))} semitone${Math.abs(semitones) === 1 ? '' : 's'}${cents ? ` ${cents > 0 ? '+' : '−'}${String(Math.abs(cents))} cents` : ''}`;
    // Longer by r at the same pitch, then played r times faster: the same length, r times higher.
    return { stretch: r, resample: r, label };
  }
  const tempo = Math.min(400, Math.max(25, Number(opts.tempo) || 100)) / 100;
  if (tempo === 1) throw new MediaInputError('Set a speed other than 100%.');
  const label = `${String(Math.round(tempo * 100))}%`;
  // Vinyl: played faster or slower, pitch and all. Tempo: stretched, pitch kept.
  return mode === 'vinyl'
    ? { stretch: 1, resample: tempo, label }
    : { stretch: 1 / tempo, resample: 1, label };
}

export const pitchEngine: Engine<PitchOptions> = {
  ...MEDIA_META.audioEdit,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
    }
    const plan = pitchPlan(opts);
    const input = openInput(file);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new MediaInputError('This file has no audio in it.');
      const codec = await track.getCodec();
      if (!(await track.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(codec)} audio in this file.`,
        );
      }
      const keep = codec ? KEEP_FORMAT[codec] : undefined;
      const format: AudioFormat =
        opts.format && opts.format in AUDIO_TARGETS
          ? (opts.format as AudioFormat)
          : (keep ?? 'wav');
      const target = AUDIO_TARGETS[format];
      const outCodec = format === 'wav' && codec?.startsWith('pcm') ? codec : target.codec;
      await ensureEncoder(outCodec);
      const rate = await track.getSampleRate();
      const channels = Math.min(2, await track.getNumberOfChannels());
      const duration = await track.computeDuration();
      const length = (duration * plan.stretch) / plan.resample;

      const buffer = new BufferTarget();
      const output = new Output({ format: target.format(), target: buffer });
      output.setMetadataTags(await input.getMetadataTags());
      const bitrate = target.lossy
        ? ((await track.getAverageBitrate().catch(() => null)) ?? 192_000)
        : null;
      const source = new AudioSampleSource({
        codec: outCodec,
        ...(bitrate && { quality: new Quality({ bitrate }) }),
      });
      output.addAudioTrack(source);
      await output.start();

      const stretcher = plan.stretch === 1 ? null : new TimeStretch(channels, plan.stretch);
      const resampler =
        plan.resample === 1 ? null : new Resampler(rate * plan.resample, rate, channels);
      let written = 0;
      const write = async (planes: Float32Array[]) => {
        const n = planes[0]?.length ?? 0;
        if (n === 0) return;
        const data = new Float32Array(n * channels);
        planes.forEach((plane, c) => {
          data.set(plane, c * n);
        });
        const sample = new AudioSample({
          data,
          format: 'f32-planar',
          numberOfChannels: channels,
          sampleRate: rate,
          timestamp: written / rate,
        });
        await source.add(sample);
        sample.close();
        written += n;
        ctx.progress(Math.min(1, written / rate / length), 'Changing');
      };
      const through = async (planes: Float32Array[], last: boolean) => {
        let out = planes;
        if (stretcher) out = last ? stretcher.flush() : stretcher.push(out);
        if (resampler) {
          const resampled = resampler.push(out);
          await write(resampled);
          if (last) await write(resampler.flush());
          return;
        }
        await write(out);
      };
      try {
        for await (const decoded of new AudioSampleSink(track).samples()) {
          if (ctx.signal.aborted) {
            decoded.close();
            throw new EngineAbortError();
          }
          const planes = planesOf(decoded, channels);
          decoded.close();
          await through(planes, false);
        }
        await through(
          Array.from({ length: channels }, () => new Float32Array(0)),
          true,
        );
        source.close();
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = buffer.buffer;
      if (!bytes) throw new Error('No file was written');
      const mode =
        opts.mode === 'pitch' ? 'Pitch' : opts.mode === 'vinyl' ? 'Speed and pitch' : 'Tempo';
      return {
        blob: new Blob([bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: written / rate,
        path: 'Browser · WebCodecs',
        notes: [
          opts.mode === 'pitch'
            ? `Pitch ${plan.label}, length kept: ${(written / rate).toFixed(2)} s`
            : opts.mode === 'vinyl'
              ? `Played at ${plan.label}, pitch moving with it: ${(written / rate).toFixed(2)} s`
              : `Tempo ${plan.label}, pitch kept: ${duration.toFixed(2)} s → ${(written / rate).toFixed(2)} s`,
          target.lossy
            ? `Re-encoded as ${codecLabel(outCodec)} at the file's own bitrate`
            : `${outCodec === 'flac' ? 'FLAC' : 'PCM'}: lossless`,
        ],
        details: [
          { label: mode, value: plan.label },
          { label: 'Length', value: `${(written / rate).toFixed(2)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
