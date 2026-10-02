/**
 * Finding silences (tools/audio.md → A11 Remove Silence): the level every
 * 10 ms, then runs below a threshold that last long enough. The threshold is
 * set, or found from the recording's own noise floor. What to cut is the
 * silence less some padding either side, or all but a short pause.
 */
import type { Span } from '../media/ranges';

/** Seconds between level readings. */
export const LEVEL_STEP = 0.01;

/** Level readings per second. */
const STEPS_PER_SECOND = Math.round(1 / LEVEL_STEP);

/**
 * Loudest channel's RMS every 10 ms, dBFS, from planar audio pushed in order.
 * Reading n covers the samples from n × 10 ms to (n + 1) × 10 ms, each edge
 * rounded to a whole sample. At 22.05 or 11.025 kHz a 10 ms window isn't a
 * whole number of samples, so windows are 220 or 221 samples long in turn
 * (110 or 111 at 11.025 kHz): a fixed rounded length would drift 0.23%, 8 s
 * over an hour.
 */
export class LevelScan {
  private readonly rate: number;
  private readonly sums: number[];
  /** Samples in the window being read, and the sample it ends before. */
  private count = 0;
  private seen = 0;
  private edge: number;
  private readonly levels: number[] = [];

  constructor(rate: number, channels: number) {
    this.rate = rate;
    this.sums = Array.from({ length: channels }, () => 0);
    this.edge = this.edgeOf(1);
  }

  /** Where reading n ends: the sample at n × 10 ms, and always past the last window's end. */
  private edgeOf(n: number): number {
    return Math.max(this.seen + 1, Math.round((n * this.rate) / STEPS_PER_SECOND));
  }

  push(planes: Float32Array[]): void {
    const frames = planes[0]?.length ?? 0;
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < this.sums.length; c += 1) {
        const v = planes[c]?.[i] ?? 0;
        this.sums[c] = (this.sums[c] ?? 0) + v * v;
      }
      this.count += 1;
      this.seen += 1;
      if (this.seen === this.edge) this.close();
    }
  }

  private close(): void {
    let loudest = 0;
    for (let c = 0; c < this.sums.length; c += 1) {
      loudest = Math.max(loudest, (this.sums[c] ?? 0) / this.count);
      this.sums[c] = 0;
    }
    this.levels.push(loudest > 0 ? 10 * Math.log10(loudest) : -Infinity);
    this.count = 0;
    this.edge = this.edgeOf(this.levels.length + 1);
  }

  finish(): Float32Array {
    if (this.count > 0) this.close();
    return Float32Array.from(this.levels);
  }
}

/**
 * The noise floor: the level the quietest tenth of the recording sits at.
 * A threshold 10 dB above it, kept between -60 and -30 dBFS, separates pauses
 * from speech in most recordings.
 */
export function autoThreshold(levels: Float32Array): number {
  const finite = Array.from(levels)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (finite.length === 0) return -50;
  const floor = finite[Math.floor(finite.length * 0.1)] ?? -60;
  return Math.min(-30, Math.max(-60, Math.round(floor + 10)));
}

/** Runs of levels under `thresholdDb` lasting at least `minSeconds`, in seconds. */
export function findSilences(
  levels: Float32Array,
  thresholdDb: number,
  minSeconds: number,
): Span[] {
  const out: Span[] = [];
  let from = -1;
  const close = (end: number) => {
    if (from >= 0 && (end - from) * LEVEL_STEP >= minSeconds - 1e-9) {
      out.push({ start: from * LEVEL_STEP, end: end * LEVEL_STEP });
    }
    from = -1;
  };
  for (let i = 0; i < levels.length; i += 1) {
    const quiet = (levels[i] ?? -Infinity) < thresholdDb;
    if (quiet && from < 0) from = i;
    if (!quiet) close(i);
  }
  close(levels.length);
  return out;
}

export interface CutOptions {
  /** remove: the silence less `padding` either side. shorten: all but `keep` seconds of it. */
  mode: 'remove' | 'shorten';
  padding: number;
  keep: number;
}

/**
 * What to cut from each silence. Remove leaves `padding` of quiet beside the
 * sound either side (a breath, the tail of a word); Shorten leaves `keep`
 * seconds, half each side. Silences at the very start and end are cut to
 * the edge, less the padding on their inner side only.
 */
export function silenceCuts(silences: Span[], duration: number, options: CutOptions): Span[] {
  const cuts: Span[] = [];
  for (const s of silences) {
    const atStart = s.start <= 1e-6;
    const atEnd = s.end >= duration - 1e-6;
    const margin = options.mode === 'remove' ? options.padding : options.keep / 2;
    const start = atStart ? 0 : s.start + margin;
    const end = atEnd ? duration : s.end - margin;
    if (end - start >= 0.02) cuts.push({ start, end: Math.min(duration, end) });
  }
  return cuts;
}

/** The cut list as CSV, for applying the same cuts to video in an editor. */
export function cutsCsv(cuts: Span[]): string {
  const time = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const rows = ['cut,start,end,length_s,start_s,end_s'];
  cuts.forEach((c, i) => {
    rows.push(
      `${String(i + 1)},${time(c.start)},${time(c.end)},${(c.end - c.start).toFixed(3)},${c.start.toFixed(3)},${c.end.toFixed(3)}`,
    );
  });
  return `${rows.join('\n')}\n`;
}
