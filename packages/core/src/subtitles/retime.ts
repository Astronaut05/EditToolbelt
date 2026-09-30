/**
 * T02 Subtitle Sync & Shift (tools/subtitles-and-time.md): new times for
 * every cue, written back into the file in place. Only the timestamps change,
 * so ASS styles, VTT settings, cue numbers and comments stay exactly as they
 * were, and the file keeps its format.
 */
import { normalizeText } from './parse';
import { formatAssTime, formatSbvTime, formatSrtTime, formatVttTime, parseTime } from './time';
import type { SubtitleFormat } from './types';

/** One cue's timing as found in the file, numbered in file order from 1. */
export interface CueTime {
  number: number;
  start: number;
  end: number;
}

/** New times for a cue; the cue is kept in the file either way. */
export type Retimer = (cue: CueTime) => { start: number; end: number };

export interface RetimeResult {
  text: string;
  cues: number;
  changed: number;
  /** Cues that would have started before 0:00, now clamped to it. */
  clamped: number;
}

const ARROW = /^(\s*)(\S+)(\s+-->\s+)(\S+)(.*)$/;
const SBV = /^(\s*)(\d+:\d{1,2}:\d{1,2}\.\d{1,3}),(\d+:\d{1,2}:\d{1,2}\.\d{1,3})(\s*)$/;
/** VTT karaoke timestamps inside cue text: <00:01:02.500>. */
const VTT_INLINE = /<((?:\d+:)?\d{1,2}:\d{1,2}\.\d{3})>/g;

/** VTT times keep their hour-less form ("02:03.456") while under an hour. */
function vttTime(ms: number, original: string): string {
  const full = formatVttTime(ms);
  return original.split(':').length === 2 && ms < 3_600_000 ? full.slice(3) : full;
}

function formatter(
  format: Exclude<SubtitleFormat, 'txt'>,
): (ms: number, original: string) => string {
  switch (format) {
    case 'srt':
      return (ms) => formatSrtTime(ms);
    case 'vtt':
      return vttTime;
    case 'sbv':
      return (ms) => formatSbvTime(ms);
    case 'ass':
    case 'ssa':
      return (ms) => formatAssTime(ms);
  }
}

/** Every cue's timing, in file order. */
export function cueTimes(text: string, format: Exclude<SubtitleFormat, 'txt'>): CueTime[] {
  const times: CueTime[] = [];
  retimeText(text, format, (cue) => {
    times.push(cue);
    return cue;
  });
  return times;
}

/** Rewrites the times of every cue with `retime`, leaving everything else as it was. */
export function retimeText(
  text: string,
  format: Exclude<SubtitleFormat, 'txt'>,
  retime: Retimer,
): RetimeResult {
  const lines = normalizeText(text).split('\n');
  const write = formatter(format);
  let cues = 0;
  let changed = 0;
  let clamped = 0;
  // ASS: where Start and End sit in each event line, from the [Events] Format line.
  let section = '';
  let startField = 1;
  let endField = 2;
  // VTT: the shift of the cue being read, for its inline timestamps.
  let pendingShift: ((ms: number) => number) | null = null;

  const apply = (start: number, end: number) => {
    cues += 1;
    const next = retime({ number: cues, start, end });
    let s = Math.round(next.start);
    let e = Math.round(next.end);
    if (s < 0) {
      // It still ends where the shift puts it, so the rest stays in sync.
      clamped += 1;
      e = Math.max(0, e);
      s = 0;
    }
    e = Math.max(s, e);
    if (s !== start || e !== end) changed += 1;
    return { start: s, end: e, shift: (ms: number) => ms + (s - start) };
  };

  const out = lines.map((line) => {
    if (format === 'ass' || format === 'ssa') {
      const header = /^\s*\[(.+)\]\s*$/.exec(line);
      if (header) {
        section = (header[1] ?? '').toLowerCase();
        return line;
      }
      if (section !== 'events') return line;
      const field = /^(\s*)([A-Za-z]+)(\s*:\s?)(.*)$/.exec(line);
      if (!field) return line;
      const [, lead = '', key = '', colon = '', value = ''] = field;
      if (key.toLowerCase() === 'format') {
        const names = value.split(',').map((name) => name.trim().toLowerCase());
        startField = names.indexOf('start');
        endField = names.indexOf('end');
        return line;
      }
      if (!/^(dialogue|comment)$/i.test(key) || startField < 0 || endField < 0) return line;
      // Text is the last field and may hold commas: split only as far as needed.
      const values = value.split(',');
      const start = parseTime(values[startField] ?? '');
      const end = parseTime(values[endField] ?? '');
      if (start === null || end === null) return line;
      const next = apply(start, end);
      values[startField] = write(next.start, values[startField] ?? '');
      values[endField] = write(next.end, values[endField] ?? '');
      return `${lead}${key}${colon}${values.join(',')}`;
    }
    if (format === 'sbv') {
      const match = SBV.exec(line);
      if (!match) return line;
      const [, lead = '', a = '', b = '', tail = ''] = match;
      const start = parseTime(a);
      const end = parseTime(b);
      if (start === null || end === null) return line;
      const next = apply(start, end);
      return `${lead}${write(next.start, a)},${write(next.end, b)}${tail}`;
    }
    const match = ARROW.exec(line);
    if (match) {
      const [, lead = '', a = '', arrow = '', b = '', tail = ''] = match;
      const start = parseTime(a);
      const end = parseTime(b);
      if (start === null || end === null) return line;
      const next = apply(start, end);
      pendingShift = next.shift;
      return `${lead}${write(next.start, a)}${arrow}${write(next.end, b)}${tail}`;
    }
    // WebVTT karaoke timestamps move with their cue.
    if (format === 'vtt' && pendingShift && line.includes('<')) {
      const shift = pendingShift;
      return line.replace(VTT_INLINE, (whole, time: string) => {
        const ms = parseTime(time);
        return ms === null ? whole : `<${vttTime(Math.max(0, shift(ms)), time)}>`;
      });
    }
    if (line.trim() === '') pendingShift = null;
    return line;
  });
  return { text: out.join('\n'), cues, changed, clamped };
}

/** Every cue moved by `ms` (negative is earlier), or only those numbered `from` and after. */
export function shiftBy(ms: number, from = 1): Retimer {
  return (cue) =>
    cue.number >= from
      ? { start: cue.start + ms, end: cue.end + ms }
      : { start: cue.start, end: cue.end };
}

/**
 * Timing made for one frame rate, played at another: subtitles for a 23.976 fps
 * film on a 25 fps PAL release run 4.1 % fast, so times scale by 23.976 / 25.
 */
export function rescale(fromFps: number, toFps: number): Retimer {
  const factor = fromFps / toFps;
  return (cue) => ({ start: cue.start * factor, end: cue.end * factor });
}

/**
 * Two-point sync: cue `a` should start at `aAt` and cue `b` at `bAt`. A line
 * through both points fixes an offset and a drift at once.
 */
export function twoPoint(
  a: { start: number; at: number },
  b: { start: number; at: number },
): Retimer {
  const span = b.start - a.start;
  if (span === 0) throw new Error('Pick two cues that start at different times.');
  const scale = (b.at - a.at) / span;
  const map = (t: number) => a.at + (t - a.start) * scale;
  return (cue) => ({ start: map(cue.start), end: map(cue.end) });
}
