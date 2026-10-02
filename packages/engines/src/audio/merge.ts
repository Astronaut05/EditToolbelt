/**
 * A04 Merge Audio (tools/audio.md): files joined in order, straight on,
 * crossfaded or with a gap at each join; or mixed on top of each other,
 * lowered just enough not to clip. Each file is decoded and brought to one
 * rate and channel count; the result can be normalised to a loudness
 * target. Rendering is streamed, a block at a time, so long files fit.
 */
import {
  applyPlan,
  LoudnessScan,
  measure,
  placedGain,
  placedLength,
  placeJoined,
  placeMixed,
  planNormalize,
  type NormalizePlan,
  type Placement,
} from '@etb/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Output,
  Quality,
  type AudioCodec,
  type Input,
  type InputAudioTrack,
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
import { Frames, framesOf } from './stream';

export interface MergeAudioOptions {
  /** The files, in order (the shell's file list). */
  files?: Blob[];
  /** cut (back to back), crossfade, gap, or mix (on top of each other). */
  join?: string;
  /** Seconds of crossfade or gap. */
  joinLength?: string;
  /** off, or a loudness target in LUFS ("-14"). */
  normalize?: string;
  /** keep (the first file's format), mp3, wav, flac, m4a or ogg. */
  format?: string;
}

/** Most files at once. */
export const MERGE_MAX_FILES = 20;
/** Frames rendered at a time. */
const BLOCK = 8192;
/** Where a mix is lowered to when it would clip: −1 dBFS. */
const MIX_CEILING = 10 ** (-1 / 20);

interface Opened {
  input: Input;
  track: InputAudioTrack;
  rate: number;
  channels: number;
  durationSec: number;
  codec: AudioCodec | null;
}

async function openAll(files: Blob[]): Promise<Opened[]> {
  const opened: Opened[] = [];
  try {
    for (const [i, file] of files.entries()) {
      const name = file instanceof File ? file.name : `File ${String(i + 1)}`;
      if (file.size > AUDIO_LIMITS.maxBytes) {
        throw new MediaInputError(`${name} is over 1 GB, the browser limit for audio.`);
      }
      const input = openInput(file);
      const track = await input.getPrimaryAudioTrack().catch(() => null);
      if (!track) {
        input.dispose();
        throw new MediaInputError(`${name} has no audio this tool can read.`);
      }
      const codec = await track.getCodec();
      if (!(await track.canDecode())) {
        input.dispose();
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(codec)} audio in ${name}.`,
        );
      }
      opened.push({
        input,
        track,
        rate: await track.getSampleRate(),
        channels: await track.getNumberOfChannels(),
        durationSec: await track.computeDuration(),
        codec,
      });
    }
    return opened;
  } catch (error) {
    for (const o of opened) o.input.dispose();
    throw error;
  }
}

/** The result, a block at a time: every file's frames at its place, with its crossfade gains, added up. */
async function* render(
  sources: Opened[],
  placed: Placement[],
  rate: number,
  channels: number,
  signal: AbortSignal,
): AsyncGenerator<{ planes: Float32Array[]; start: number }> {
  const readers = sources.map(
    (s) =>
      new Frames(
        framesOf(s.track, [{ from: 0, to: s.durationSec, at: 0 }], rate, channels, signal),
        channels,
      ),
  );
  const total = placedLength(placed);
  for (let start = 0; start < total; start += BLOCK) {
    if (signal.aborted) throw new EngineAbortError();
    const n = Math.min(BLOCK, total - start);
    const planes = Array.from({ length: channels }, () => new Float32Array(n));
    for (const [i, p] of placed.entries()) {
      const from = Math.max(start, p.at);
      const to = Math.min(start + n, p.at + p.length);
      const reader = readers[i];
      if (to <= from || !reader) continue;
      const frames = await reader.take(to - from);
      for (let j = 0; j < to - from; j += 1) {
        const gain = placedGain(p, from - p.at + j);
        for (let c = 0; c < channels; c += 1) {
          const target = planes[c];
          if (target)
            target[from - start + j] =
              (target[from - start + j] ?? 0) + (frames[c]?.[j] ?? 0) * gain;
        }
      }
    }
    yield { planes, start };
  }
}

const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`;

export const mergeAudioEngine: Engine<MergeAudioOptions> = {
  ...MEDIA_META.audioEdit,
  async run(_file, opts, ctx): Promise<EngineOutput> {
    const files = opts.files ?? [];
    if (files.length < 2) throw new MediaInputError('Add at least 2 files to merge.');
    if (files.length > MERGE_MAX_FILES) {
      throw new MediaInputError(`Merge up to ${String(MERGE_MAX_FILES)} files at once.`);
    }
    const sources = await openAll(files);
    try {
      const mix = opts.join === 'mix';
      const first = sources[0];
      const keep = first?.codec ? KEEP_FORMAT[first.codec] : undefined;
      const format: AudioFormat =
        opts.format && opts.format in AUDIO_TARGETS
          ? (opts.format as AudioFormat)
          : (keep ?? 'wav');
      const target = AUDIO_TARGETS[format];
      await ensureEncoder(target.codec);
      // One rate for all: theirs if they share one (nothing resampled), else 48 kHz.
      const rates = new Set(sources.map((s) => s.rate));
      const shared = rates.size === 1 ? (first?.rate ?? 48_000) : 48_000;
      const rate = target.codec === 'opus' || (target.lossy && shared > 48_000) ? 48_000 : shared;
      const channels = Math.min(2, Math.max(...sources.map((s) => s.channels)));
      const lengths = sources.map((s) => Math.round(s.durationSec * rate));
      const join = opts.join === 'crossfade' || opts.join === 'gap' ? opts.join : 'cut';
      const joinFrames = Math.round(Math.max(0, Number(opts.joinLength) || 0) * rate);
      let placed: Placement[];
      try {
        placed = mix ? placeMixed(lengths) : placeJoined(lengths, join, joinFrames);
      } catch {
        throw new MediaInputError(
          'A crossfade can be at most half as long as the shortest file. Shorten it.',
        );
      }
      const total = placedLength(placed);

      // A first pass when the level depends on the whole: a mix's peak, or its loudness.
      const target_ = opts.normalize && opts.normalize !== 'off' ? Number(opts.normalize) : null;
      let gain = 1;
      let plan: NormalizePlan | null = null;
      if (mix || target_ !== null) {
        const scan = target_ !== null ? new LoudnessScan(rate, channels, { perMs: true }) : null;
        let peak = 0;
        for await (const { planes, start } of render(sources, placed, rate, channels, ctx.signal)) {
          for (const plane of planes) for (const v of plane) peak = Math.max(peak, Math.abs(v));
          scan?.push(planes);
          ctx.progress(((start + (planes[0]?.length ?? 0)) / total) * 0.45, 'Measuring');
        }
        if (scan && target_ !== null) {
          try {
            plan = planNormalize(scan.finish(), { target: target_, ceiling: -1, limit: true });
          } catch (error) {
            if (error instanceof RangeError) {
              throw new MediaInputError('The result is silent: there is no loudness to set.');
            }
            throw error;
          }
        } else if (peak > MIX_CEILING) {
          gain = MIX_CEILING / peak;
        }
      }

      const buffer = new BufferTarget();
      const output = new Output({ format: target.format(), target: buffer });
      const source = new AudioSampleSource({
        codec: target.codec,
        ...(target.lossy && {
          quality: new Quality({ bitrate: channels === 2 ? 192_000 : 128_000 }),
        }),
      });
      output.addAudioTrack(source);
      await output.start();
      const after = target_ !== null ? new LoudnessScan(rate, channels) : null;
      let clipped = 0;
      const base = mix || target_ !== null ? 0.45 : 0;
      try {
        for await (const { planes, start } of render(sources, placed, rate, channels, ctx.signal)) {
          if (plan) applyPlan(planes, start, plan);
          for (const plane of planes) {
            for (let i = 0; i < plane.length; i += 1) {
              let v = (plane[i] ?? 0) * gain;
              if (v > 1 || v < -1) {
                clipped += 1;
                v = v > 1 ? 1 : -1;
              }
              plane[i] = v;
            }
          }
          after?.push(planes);
          const n = planes[0]?.length ?? 0;
          const data = new Float32Array(n * channels);
          planes.forEach((plane, c) => {
            data.set(plane, c * n);
          });
          const sample = new AudioSample({
            data,
            format: 'f32-planar',
            numberOfChannels: channels,
            sampleRate: rate,
            timestamp: start / rate,
          });
          await source.add(sample);
          sample.close();
          ctx.progress(base + ((start + n) / total) * (1 - base), mix ? 'Mixing' : 'Joining');
        }
        source.close();
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = buffer.buffer;
      if (!bytes) throw new Error('No file was written');

      const length = total / rate;
      const notes = [
        mix
          ? `${String(files.length)} files mixed, as long as the longest: ${secs(length)}`
          : join === 'crossfade'
            ? `${String(files.length)} files joined with ${secs(joinFrames / rate)} crossfades: ${secs(length)}`
            : join === 'gap'
              ? `${String(files.length)} files joined with ${secs(joinFrames / rate)} gaps: ${secs(length)}`
              : `${String(files.length)} files joined end to end: ${secs(length)}`,
      ];
      if (gain < 1) {
        notes.push(
          `Lowered by ${(-20 * Math.log10(gain)).toFixed(1)} dB so the mix peaks at −1 dBFS instead of clipping`,
        );
      }
      if (plan && after) {
        notes.push(
          `Normalised to ${String(target_)} LUFS: it measures ${measure(after.finish()).integrated.toFixed(1)} LUFS`,
        );
      }
      if (rates.size > 1 || rate !== shared) {
        notes.push(`Every file brought to ${String(rate / 1000)} kHz`);
      }
      if (clipped > 0) notes.push('Some peaks were over 0 dBFS and were clipped');
      notes.push(
        target.lossy
          ? `${codecLabel(target.codec)} at ${channels === 2 ? '192' : '128'} kbps`
          : `${target.codec === 'flac' ? 'FLAC' : 'PCM'}: lossless`,
      );
      return {
        blob: new Blob([bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: length,
        path: 'Browser · WebCodecs',
        notes,
        details: [
          { label: 'Files', value: String(files.length) },
          { label: 'Length', value: secs(length) },
        ],
      };
    } finally {
      for (const s of sources) s.input.dispose();
    }
  },
};
