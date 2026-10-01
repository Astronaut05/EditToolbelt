/**
 * A06 Loudness Meter and A05 Normalize Loudness (tools/audio.md): the track
 * is decoded block by block and measured to BS.1770-4 / EBU R128 by
 * @etb/core. The meter reports; the normaliser plans a gain (and, if the
 * peaks need it, a true-peak limiter) from that scan, encodes with it, and
 * measures what it made: from the file itself when the format is lossy.
 */
import {
  applyPlan,
  LOUDNESS_TARGETS,
  LoudnessScan,
  measure,
  planNormalize,
  targetVerdict,
  type Loudness,
  type NormalizePlan,
} from '@etb/core';
import { AudioSample, AudioSampleSink, Quality, type AudioCodec } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import { encodeAudio } from '../video/encode-audio';
import { AUDIO_TARGETS, ensureEncoder, type AudioFormat } from '../video/extract-audio';
import { codecLabel, MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS, MEDIA_META } from '../media-meta';

/** "−14.0": one decimal, a true minus sign, and "−∞" for silence. */
export function level(value: number, digits = 1): string {
  if (value === -Infinity) return '−∞';
  const text = Math.abs(value).toFixed(digits);
  return value < 0 && Number(text) !== 0 ? `−${text}` : text;
}

/** "+3.2" or "−6.0": a change, with its sign. */
export function change(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : level(value);
}

/** Copies a decoded block out as one Float32Array per channel. */
function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
    return plane;
  });
}

/** Decodes a file's audio and scans it. `perMs` keeps what the normaliser plans from. */
async function scanFile(
  file: Blob,
  perMs: boolean,
  signal: AbortSignal,
  progress: (fraction: number) => void,
) {
  if (file.size > AUDIO_LIMITS.maxBytes) {
    throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t an audio file this tool can read. Try MP3, WAV, FLAC, OGG, M4A or AAC.',
      );
    }
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new MediaInputError('This file has no audio in it.');
    const codec = await track.getCodec();
    if (!(await track.canDecode())) {
      throw new MediaInputError(
        `This browser can’t decode the ${codecLabel(codec)} audio in this file.`,
      );
    }
    const duration = await input.computeDuration();
    if (duration > AUDIO_LIMITS.maxSeconds) {
      throw new MediaInputError('This file is over 4 hours long, the browser limit for audio.');
    }
    const rate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    const scanner = new LoudnessScan(rate, channels, { perMs });
    // The same timeline the encoder keeps (encode-audio → seamless): a gap is silence and
    // an overlap is dropped, so frame numbers here are frame numbers there.
    let next = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      if (signal.aborted) {
        sample.close();
        throw new EngineAbortError();
      }
      const gap = Math.round(sample.timestamp * rate) - next;
      let planes = planesOf(sample);
      if (gap > 2) {
        scanner.push(Array.from({ length: channels }, () => new Float32Array(gap)));
        next += gap;
      } else if (gap < -2) {
        planes = planes.map((plane) => plane.subarray(Math.min(plane.length, -gap)));
      }
      scanner.push(planes);
      next += planes[0]?.length ?? 0;
      progress(Math.min(1, (sample.timestamp + sample.duration) / duration));
      sample.close();
    }
    const scan = scanner.finish();
    if (scan.frames === 0) throw new MediaInputError('No audio could be decoded from this file.');
    return { scan, codec, rate, channels, duration };
  } finally {
    input.dispose();
  }
}

const lu = (value: number) => `${level(value)} LUFS`;

/** The headline facts the meter shows: the number, then its unit. */
function facts(m: Loudness): { label: string; value: string; unit?: string }[] {
  return [
    { label: 'Integrated', value: level(m.integrated), unit: 'LUFS' },
    { label: 'True peak', value: level(m.truePeak), unit: 'dBTP' },
    { label: 'Loudness range', value: level(m.range), unit: 'LU' },
    m.durationSec < 3
      ? { label: 'Short-term max', value: 'Under 3 s' }
      : { label: 'Short-term max', value: level(m.shortTermMax), unit: 'LUFS' },
    { label: 'Momentary max', value: level(m.momentaryMax), unit: 'LUFS' },
    { label: 'RMS', value: level(m.rms), unit: 'dBFS' },
  ];
}

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m)}:${s.toFixed(1).padStart(4, '0')}`;
};

/** Every 100 ms: time, momentary and short-term loudness, for a spreadsheet or an editor. */
export function loudnessCsv(m: Loudness): string {
  const rows = ['time_s,momentary_lufs,short_term_lufs'];
  for (let i = 0; i < m.momentary.length; i += 1) {
    // Momentary values start at 0.4 s (index 0), short-term at 3 s (26 steps later).
    const time = 0.4 + i * 0.1;
    const short = i >= 26 ? m.shortTerm[i - 26] : undefined;
    const value = (v: number | undefined) =>
      v === undefined || v === -Infinity ? '' : v.toFixed(2);
    rows.push(`${time.toFixed(1)},${value(m.momentary[i])},${value(short)}`);
  }
  return `${rows.join('\n')}\n`;
}

/** At most `points` values: the loudest in each stretch, so short peaks still show. */
function thin(values: Float32Array, points: number): number[] {
  if (values.length <= points) return Array.from(values);
  const out: number[] = [];
  const per = values.length / points;
  for (let p = 0; p < points; p += 1) {
    let best = -Infinity;
    for (let i = Math.floor(p * per); i < Math.floor((p + 1) * per); i += 1) {
      best = Math.max(best, values[i] ?? -Infinity);
    }
    out.push(best);
  }
  return out;
}

export interface LoudnessMeterOptions {
  /** txt (the report) or csv (loudness every 100 ms). */
  export?: string;
}

export const loudnessMeterEngine: Engine<LoudnessMeterOptions> = {
  ...MEDIA_META.loudness,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const { scan, codec, rate, channels } = await scanFile(file, false, ctx.signal, (f) => {
      ctx.progress(f * 0.95, 'Measuring');
    });
    const m = measure(scan);
    if (m.integrated === -Infinity) {
      throw new MediaInputError('This audio is silent: there is no loudness to measure.');
    }
    const verdicts = LOUDNESS_TARGETS.map((target) => ({
      target,
      ...targetVerdict(target, m),
    }));
    const report = [
      `Loudness (ITU-R BS.1770-4, EBU R128)`,
      '',
      ...facts(m).map(
        (fact) => `${fact.label.padEnd(16)}${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`,
      ),
      `${'Sample peak'.padEnd(16)}${level(m.samplePeak)} dBFS`,
      `${'Length'.padEnd(16)}${clock(m.durationSec)}`,
      `${'Audio'.padEnd(16)}${codecLabel(codec)}, ${String(rate / 1000)} kHz, ${String(channels)} ch`,
      '',
      'Targets',
      ...verdicts.map(
        (v) =>
          `${(v.pass ? 'Pass' : 'Fail').padEnd(6)}${v.target.name} (${level(v.target.integrated, 0)} LUFS, true peak ${level(v.target.truePeak, 0)} dBTP): ${v.text}`,
      ),
      '',
    ].join('\n');
    const csv = opts.export === 'csv';
    return {
      blob: csv
        ? new Blob([loudnessCsv(m)], { type: 'text/csv' })
        : new Blob([report], { type: 'text/plain' }),
      ext: csv ? 'csv' : 'txt',
      durationSec: m.durationSec,
      path: 'Browser',
      notes: verdicts.map(
        (v) => `${v.target.name}, ${level(v.target.integrated, 0)} LUFS: ${v.text}`,
      ),
      details: facts(m),
      report,
      graph: {
        label: 'Short-term loudness (3 s), every 100 ms',
        unit: 'LUFS',
        startSec: 3,
        stepSec: 0.1 * Math.max(1, m.shortTerm.length / 1200),
        values: thin(m.shortTerm, 1200),
        marks: [{ label: 'Integrated', value: m.integrated }],
        durationSec: m.durationSec,
      },
    };
  },
};

export interface NormalizeOptions {
  /** A target in LUFS ("-14"), or "custom" with `custom`. */
  target?: string;
  custom?: string;
  /** dBTP. */
  ceiling?: string;
  /** limit (gain and a true-peak limiter) or gain (gain only). */
  mode?: string;
  /** keep, or a format from AUDIO_TARGETS. */
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

export function targetOf(opts: NormalizeOptions): number {
  const value = Number(opts.target === 'custom' ? opts.custom : opts.target);
  if (!Number.isFinite(value) || value > -5 || value < -40) {
    throw new MediaInputError('Set a target between −40 and −5 LUFS.');
  }
  return value;
}

export function ceilingOf(opts: NormalizeOptions): number {
  const value = Number(opts.ceiling ?? '-1');
  if (!Number.isFinite(value) || value > 0 || value < -9) {
    throw new MediaInputError('Set a true-peak ceiling between −9 and 0 dBTP.');
  }
  return value;
}

export const normalizeEngine: Engine<NormalizeOptions> = {
  ...MEDIA_META.loudness,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const target = targetOf(opts);
    const ceiling = ceilingOf(opts);
    const first = await scanFile(file, true, ctx.signal, (f) => {
      ctx.progress(f * 0.35, 'Measuring');
    });
    const before = measure(first.scan);
    let plan: NormalizePlan;
    try {
      plan = planNormalize(first.scan, { target, ceiling, limit: opts.mode !== 'gain' });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new MediaInputError('This audio is silent: there is no loudness to set.');
      }
      throw error;
    }
    const sourceCodec = first.codec;
    const keep = sourceCodec ? KEEP[sourceCodec] : undefined;
    const format: AudioFormat =
      opts.format && opts.format in AUDIO_TARGETS ? (opts.format as AudioFormat) : (keep ?? 'wav');
    const out = AUDIO_TARGETS[format];
    const codec: AudioCodec =
      format === 'wav' && sourceCodec?.startsWith('pcm') ? sourceCodec : out.codec;
    await ensureEncoder(codec);

    const input = openInput(file);
    const processed = new LoudnessScan(first.rate, first.channels);
    let encoded: { bytes: ArrayBuffer };
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new MediaInputError('This file has no audio in it.');
      const bitrate = out.lossy
        ? ((await track.getAverageBitrate().catch(() => null)) ?? 192_000)
        : null;
      encoded = await encodeAudio(
        {
          input,
          track,
          format: out.format(),
          codec,
          ...(bitrate && { quality: new Quality({ bitrate }) }),
          process: (sample) => {
            const planes = planesOf(sample);
            applyPlan(planes, Math.round(sample.timestamp * sample.sampleRate), plan);
            processed.push(planes);
            const frames = sample.numberOfFrames;
            const data = new Float32Array(frames * planes.length);
            planes.forEach((plane, c) => {
              data.set(plane, c * frames);
            });
            const next = new AudioSample({
              data,
              format: 'f32-planar',
              numberOfChannels: planes.length,
              sampleRate: sample.sampleRate,
              timestamp: sample.timestamp,
            });
            sample.close();
            return next;
          },
        },
        ctx.signal,
        (f) => {
          ctx.progress(0.35 + f * 0.5, 'Setting the loudness');
        },
      );
    } finally {
      input.dispose();
    }
    // Lossy formats are measured from the file itself: encoding can move the peaks.
    const after = out.lossy
      ? measure(
          (
            await scanFile(new Blob([encoded.bytes]), false, ctx.signal, (f) => {
              ctx.progress(0.85 + f * 0.15, 'Checking the result');
            })
          ).scan,
        )
      : measure(processed.finish());
    const notes = [
      plan.heldBack
        ? `Stopped at ${lu(after.integrated)}: more gain would push the true peak over ${level(ceiling)} dBTP. Choose Gain + limiter to reach ${lu(target)}.`
        : `${plan.gainDb >= 0 ? 'Raised' : 'Lowered'} ${Math.abs(plan.gainDb).toFixed(1)} dB to ${lu(after.integrated)}`,
      ...(plan.limited
        ? [`The limiter took up to ${plan.reductionDb.toFixed(1)} dB off the loudest peaks`]
        : []),
      ...(after.truePeak > ceiling + 0.05
        ? [
            `${codecLabel(codec)} encoding put the true peak at ${level(after.truePeak)} dBTP, over the ceiling. Save as WAV or FLAC, or lower the ceiling.`,
          ]
        : []),
      out.lossy
        ? `Re-encoded as ${codecLabel(codec)}; measured in the file you download`
        : `${codecLabel(codec.startsWith('pcm') ? 'PCM' : codec)}: lossless`,
    ];
    return {
      blob: new Blob([encoded.bytes], { type: out.mime }),
      ext: out.ext,
      durationSec: after.durationSec,
      path: 'Browser · WebCodecs',
      notes,
      details: [
        { label: 'Before', value: `${lu(before.integrated)}, ${level(before.truePeak)} dBTP` },
        { label: 'After', value: `${lu(after.integrated)}, ${level(after.truePeak)} dBTP` },
        { label: 'Gain', value: `${change(plan.gainDb)} dB` },
        {
          label: 'Limiter',
          value: plan.limited ? `Up to ${level(-plan.reductionDb)} dB` : 'Not needed',
        },
      ],
    };
  },
};
