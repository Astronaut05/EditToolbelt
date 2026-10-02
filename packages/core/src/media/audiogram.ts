/**
 * A16 Audio to Video (tools/audio.md): the pure side of an audiogram. What
 * the sound looks like at each video frame (spectrum bars and a stretch of
 * waveform), read from the audio as it streams by, so a long file never sits
 * in memory; where the title, the picture of the sound and the captions go
 * in each shape; and how text wraps. The engine draws with these.
 */
import type { Cue } from '../subtitles/types';

export type AudiogramShape = 'portrait' | 'square' | 'landscape';

export const AUDIOGRAM_SIZES: Record<
  AudiogramShape,
  { width: number; height: number; label: string }
> = {
  portrait: { width: 1080, height: 1920, label: '9:16' },
  square: { width: 1080, height: 1080, label: '1:1' },
  landscape: { width: 1920, height: 1080, label: '16:9' },
};

export const AUDIOGRAM_FPS = 30;
/** Spectrum bars, from 50 Hz to 16 kHz on a log scale. */
export const BARS = 40;
/** Points across the waveform line. */
export const WAVE_POINTS = 180;
/** The longest audiogram: ten minutes is 18 000 frames to draw and encode. */
export const MAX_AUDIOGRAM_SECONDS = 600;

/** FFT size: about 43 ms at 48 kHz. */
const N = 2048;
/** The waveform line spans this many seconds around each frame. */
const WAVE_SPAN = 0.04;
/** Levels from −70 dBFS (empty) to −10 dBFS (full). */
const FLOOR_DB = -70;
const RANGE_DB = 60;
/** How fast a bar falls back each frame (it rises at once). */
const FALL = 0.82;

/** In-place radix-2 FFT of a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
      }
    }
  }
}

export interface AudiogramFeatures {
  frames: number;
  /** BARS levels (0-1) per frame, frame after frame. */
  bars: Float32Array;
  /** WAVE_POINTS samples (−1 to 1, the loudest moment at ±0.9) per frame. */
  wave: Float32Array;
}

/**
 * Reads mono audio as it arrives and keeps, for each video frame, its
 * spectrum bars and its stretch of waveform. Frame k shows the sound at
 * (k + ½) / fps seconds.
 */
export class AudiogramAnalyser {
  readonly bars: Float32Array;
  readonly wave: Float32Array;
  private readonly window = new Float64Array(N);
  private readonly windowSum: number;
  /** Each bar's first and last FFT bin. */
  private readonly bands: [number, number][];
  private readonly re = new Float64Array(N);
  private readonly im = new Float64Array(N);
  private data = new Float32Array(N * 4);
  /** The absolute index of data[0], and how much of data holds samples. */
  private base = 0;
  private filled = 0;
  private next = 0;
  private peak = 0;

  constructor(
    readonly rate: number,
    readonly frames: number,
    readonly fps = AUDIOGRAM_FPS,
  ) {
    this.bars = new Float32Array(frames * BARS);
    this.wave = new Float32Array(frames * WAVE_POINTS);
    let sum = 0;
    for (let i = 0; i < N; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      this.window[i] = w;
      sum += w;
    }
    this.windowSum = sum;
    const top = Math.min(16_000, rate / 2);
    const binHz = rate / N;
    this.bands = Array.from({ length: BARS }, (_, b) => {
      const lo = 50 * (top / 50) ** (b / BARS);
      const hi = 50 * (top / 50) ** ((b + 1) / BARS);
      const first = Math.max(1, Math.round(lo / binHz));
      return [first, Math.max(first, Math.round(hi / binHz) - 1)];
    });
  }

  private centre(k: number): number {
    return Math.round(((k + 0.5) * this.rate) / this.fps);
  }

  private sample(i: number): number {
    const at = i - this.base;
    return at >= 0 && at < this.filled ? (this.data[at] ?? 0) : 0;
  }

  /** The next stretch of mono audio, straight after the last. */
  push(mono: Float32Array): void {
    if (this.filled + mono.length > this.data.length) {
      const grown = new Float32Array(Math.max(this.data.length * 2, this.filled + mono.length));
      grown.set(this.data.subarray(0, this.filled));
      this.data = grown;
    }
    this.data.set(mono, this.filled);
    this.filled += mono.length;
    for (const v of mono) this.peak = Math.max(this.peak, Math.abs(v));
    this.drain(false);
  }

  /** The features, once all the audio is in (anything missing counts as silence). */
  finish(): AudiogramFeatures {
    this.drain(true);
    const gain = this.peak > 1e-6 ? 0.9 / this.peak : 0;
    for (let i = 0; i < this.wave.length; i += 1) this.wave[i] = (this.wave[i] ?? 0) * gain;
    return { frames: this.frames, bars: this.bars, wave: this.wave };
  }

  private drain(final: boolean): void {
    const span = Math.max(2, Math.round(this.rate * WAVE_SPAN));
    while (this.next < this.frames) {
      const c = this.centre(this.next);
      const end = Math.max(c + N / 2, c + span / 2);
      if (!final && this.base + this.filled < end) return;
      this.frame(this.next, c, span);
      this.next += 1;
      // Samples before the next frame's window aren't needed again.
      const keep = this.centre(this.next) - Math.max(N / 2, span / 2);
      const drop = Math.min(this.filled, keep - this.base);
      if (drop > 0) {
        this.data.copyWithin(0, drop, this.filled);
        this.filled -= drop;
        this.base += drop;
      }
    }
  }

  private frame(k: number, c: number, span: number): void {
    const lo = c - N / 2;
    for (let i = 0; i < N; i += 1) {
      this.re[i] = this.sample(lo + i) * (this.window[i] ?? 0);
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    const scale = 2 / this.windowSum;
    this.bands.forEach(([first, last], b) => {
      let mag = 0;
      for (let bin = first; bin <= last; bin += 1) {
        mag = Math.max(mag, Math.hypot(this.re[bin] ?? 0, this.im[bin] ?? 0) * scale);
      }
      const db = 20 * Math.log10(mag + 1e-12);
      const level = Math.min(1, Math.max(0, (db - FLOOR_DB) / RANGE_DB));
      const before = k > 0 ? (this.bars[(k - 1) * BARS + b] ?? 0) : 0;
      this.bars[k * BARS + b] = Math.max(level, before * FALL);
    });
    const from = c - span / 2;
    for (let p = 0; p < WAVE_POINTS; p += 1) {
      const at = from + (p * span) / (WAVE_POINTS - 1);
      const i = Math.floor(at);
      const t = at - i;
      this.wave[k * WAVE_POINTS + p] = this.sample(i) * (1 - t) + this.sample(i + 1) * t;
    }
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AudiogramLayout {
  title: Box & { size: number };
  visual: Box;
  captions: Box & { size: number };
}

/** Where things go: the title on top, the sound in the middle, the captions below. */
export function audiogramLayout(width: number, height: number): AudiogramLayout {
  const unit = Math.min(width, height);
  const margin = Math.round(unit * 0.075);
  const portrait = height > width * 1.3;
  const [t0, t1, v0, v1, c0, c1] = portrait
    ? [0.09, 0.25, 0.31, 0.61, 0.66, 0.88]
    : width > height * 1.3
      ? [0.07, 0.25, 0.28, 0.68, 0.72, 0.94]
      : [0.07, 0.27, 0.31, 0.67, 0.71, 0.93];
  const band = (from: number, to: number): Box => ({
    x: margin,
    y: Math.round(height * from),
    width: width - 2 * margin,
    height: Math.round(height * (to - from)),
  });
  return {
    title: { ...band(t0, t1), size: Math.round(unit * 0.06) },
    visual: band(v0, v1),
    captions: { ...band(c0, c1), size: Math.round(unit * 0.05) },
  };
}

/**
 * Text broken into lines no wider than `maxWidth` (by `measure`), its own
 * line breaks kept; a word too long for a line is broken where it must be.
 * Past `maxLines` the last line ends in "…".
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
  maxLines = Infinity,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const tried = line ? `${line} ${word}` : word;
      if (measure(tried) <= maxWidth) {
        line = tried;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the line: as many characters as fit, then the rest.
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? '';
  // Whole words off the end until the "…" fits, then characters if it still doesn't.
  while (last && measure(`${last}…`) > maxWidth) {
    const space = last.lastIndexOf(' ');
    last = space > 0 ? last.slice(0, space) : last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** The caption showing at `t` seconds (cue times in ms), or null. */
export function cueAt(cues: readonly Cue[], t: number): string | null {
  const ms = t * 1000;
  for (const cue of cues) {
    // Only the words: the <i>, <b> and <u> a cue may carry are dropped.
    if (cue.start <= ms && ms < cue.end) return cue.text.replace(/<\/?[biu]>/g, '');
  }
  return null;
}
