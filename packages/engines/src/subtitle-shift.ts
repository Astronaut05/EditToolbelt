/**
 * `text` engine for T02 Subtitle Sync & Shift: reads the file (any encoding),
 * finds its format, rewrites the cue times in place and returns UTF-8 in the
 * same format. Shift, frame-rate rescale or two-point sync.
 */
import { subtitles } from '@etb/core';

import { EngineAbortError } from './dummy';
import type { Engine, EngineOutput } from './types';

export interface SubtitleShiftOptions {
  mode?: string;
  /** Shift: seconds, negative is earlier. */
  shift?: string;
  /** Shift: the first cue to move, numbered from 1 in file order. */
  from?: string;
  fromFps?: string;
  toFps?: string;
  /** Two-point sync: two cues and the times they should start at. */
  cueA?: string;
  atA?: string;
  cueB?: string;
  atB?: string;
}

export class SubtitleShiftError extends Error {}

const MIME: Record<string, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
  sbv: 'text/plain',
};

/** A file's text, format and cue times: for the probe and the run. */
export function readSubtitles(bytes: Uint8Array, fileName?: string) {
  const { text, encoding } = subtitles.decodeBytes(bytes);
  const format = subtitles.detectFormat(text, fileName);
  if (!format || format === 'txt') {
    throw new SubtitleShiftError(
      'This doesn’t look like a subtitle file. Sync takes SRT, WebVTT, ASS, SSA and SBV.',
    );
  }
  const times = subtitles.cueTimes(text, format);
  if (times.length === 0) throw new SubtitleShiftError('No cues were found in this file.');
  return { text, encoding, format, times };
}

/** "1:02.5", "00:01:02,500", "62.5" or "-1.5" → ms; null if it isn't a time. */
export function readTime(value: string | undefined): number | null {
  const text = (value ?? '').trim();
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return Math.round(Number(text.replace(',', '.')) * 1000);
  // Minutes and seconds only ("1:02.5") read as m:ss.
  const parts = text.split(':');
  return subtitles.parseTime(parts.length === 2 ? `0:${text}` : text);
}

/** Signed seconds for notes: "+1.250 s", "−0.500 s". */
export function signedSeconds(ms: number): string {
  const s = (Math.abs(ms) / 1000).toFixed(3);
  return `${ms < 0 ? '−' : '+'}${s} s`;
}

function cueNumber(value: string | undefined, count: number, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > count) {
    throw new SubtitleShiftError(`${label} must be a cue number from 1 to ${String(count)}.`);
  }
  return n;
}

function fps(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SubtitleShiftError('Pick both frame rates.');
  return n;
}

/** The retimer for the options, with a note saying what it does. */
export function planShift(
  opts: SubtitleShiftOptions,
  times: readonly subtitles.CueTime[],
): { retime: subtitles.Retimer; note: string } {
  const count = times.length;
  if (opts.mode === 'rescale') {
    const from = fps(opts.fromFps);
    const to = fps(opts.toFps);
    if (from === to) throw new SubtitleShiftError('The two frame rates are the same.');
    const change = ((from / to - 1) * 100).toFixed(2);
    return {
      retime: subtitles.rescale(from, to),
      note: `Timing rescaled from ${String(from)} to ${String(to)} fps: every time × ${(from / to).toFixed(5)} (${Number(change) > 0 ? '+' : ''}${change} %)`,
    };
  }
  if (opts.mode === 'two-point') {
    const a = times[cueNumber(opts.cueA, count, 'The first cue') - 1];
    const b = times[cueNumber(opts.cueB, count, 'The second cue') - 1];
    const atA = readTime(opts.atA);
    const atB = readTime(opts.atB);
    if (!a || !b) throw new SubtitleShiftError('Pick two cues.');
    if (atA === null || atB === null) {
      throw new SubtitleShiftError('Type when each cue should start, like 00:01:02.500.');
    }
    if (a.start === b.start)
      throw new SubtitleShiftError('Pick two cues that start at different times.');
    const scale = (atB - atA) / (b.start - a.start);
    if (scale <= 0) throw new SubtitleShiftError('The second cue has to start after the first.');
    const drift = ((scale - 1) * 100).toFixed(3);
    return {
      retime: subtitles.twoPoint({ start: a.start, at: atA }, { start: b.start, at: atB }),
      note: `Synced to cue ${String(a.number)} at ${subtitles.formatSrtTime(atA)} and cue ${String(b.number)} at ${subtitles.formatSrtTime(atB)}: offset ${signedSeconds(atA - a.start)}, drift ${Number(drift) > 0 ? '+' : ''}${drift} %`,
    };
  }
  const shift = readTime(opts.shift);
  if (shift === null) throw new SubtitleShiftError('Type how far to move the cues, in seconds.');
  const from = opts.from ? cueNumber(opts.from, count, 'The first cue to move') : 1;
  return {
    retime: subtitles.shiftBy(shift, from),
    note:
      from > 1
        ? `Cues ${String(from)} to ${String(count)} moved ${signedSeconds(shift)}`
        : `Every cue moved ${signedSeconds(shift)}`,
  };
}

export const subtitleShiftEngine: Engine<SubtitleShiftOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: (input) => ({ seconds: 0.1, outputBytes: input.size }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    ctx.progress(0.2, 'Reading');
    const bytes = new Uint8Array(await input.arrayBuffer());
    if (ctx.signal.aborted) throw new EngineAbortError();
    const file = readSubtitles(bytes, input instanceof File ? input.name : undefined);
    const plan = planShift(opts, file.times);
    const result = subtitles.retimeText(file.text, file.format, plan.retime);
    const notes = [plan.note];
    if (result.clamped > 0) {
      notes.push(
        `${String(result.clamped)} ${result.clamped === 1 ? 'cue' : 'cues'} would start before 0:00, so ${result.clamped === 1 ? 'it starts' : 'they start'} at 0:00`,
      );
    }
    if (file.encoding !== 'utf-8') {
      notes.push(`Read as ${subtitles.ENCODING_LABELS[file.encoding]}, written as UTF-8`);
    }
    const ext = file.format === 'ssa' ? 'ssa' : file.format;
    ctx.progress(1, 'Done');
    return {
      blob: new Blob([subtitles.encodeUtf8(`${result.text.replace(/\n*$/, '')}\n`)], {
        type: `${MIME[file.format] ?? 'text/plain'};charset=utf-8`,
      }),
      ext,
      path: 'Browser',
      notes,
      details: [
        {
          label: 'Cues',
          value: `${result.changed.toLocaleString('en-US')} of ${result.cues.toLocaleString('en-US')} cues moved`,
        },
        { label: 'Format', value: file.format.toUpperCase() },
      ],
    };
  },
};
