/**
 * A03 BPM & Key Finder (tools/audio.md), in-house DSP, pure and shared with
 * the Premiere panel. Input is mono samples; the engine hands over a 22.05 kHz
 * downmix.
 * - Tempo: an onset-strength envelope (spectral flux of log magnitudes),
 *   autocorrelated; each BPM is scored by a comb over its beat period and
 *   multiples, with a mild preference around 120 BPM unless a range is given.
 *   Half and double tempo are reported as alternatives.
 * - Beats: the phase of that period that best lines up with the onsets.
 * - Key: a chromagram (spectral energy folded into 12 pitch classes)
 *   correlated with the Krumhansl-Kessler major and minor profiles.
 */

// ---------------------------------------------------------------- FFT

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function plan(n: number) {
  let p = twiddles.get(n);
  if (p) return p;
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  p = { cos, sin, rev };
  twiddles.set(n, p);
  return p;
}

/** In-place radix-2 FFT of a complex signal; `n` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i += 1) {
    const j = rev[i] ?? 0;
    if (j > i) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * step] ?? 1;
        const wi = sin[k * step] ?? 0;
        const a = start + k;
        const b = a + half;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const xr = br * wr - bi * wi;
        const xi = br * wi + bi * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/** Magnitude spectra of Hann-windowed frames, `size` apart by `hop`. Calls `each(mags, index)`. */
function frames(
  samples: Float32Array,
  size: number,
  hop: number,
  each: (mags: Float64Array, index: number) => void,
): number {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mags = new Float64Array(size / 2);
  let index = 0;
  for (let start = 0; start + size <= samples.length; start += hop, index += 1) {
    for (let i = 0; i < size; i += 1) {
      re[i] = (samples[start + i] ?? 0) * (window[i] ?? 0);
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k += 1) mags[k] = Math.hypot(re[k] ?? 0, im[k] ?? 0);
    each(mags, index);
  }
  return index;
}

// ---------------------------------------------------------------- tempo

const ONSET_SIZE = 1024;
const ONSET_HOP = 256;

export interface OnsetEnvelope {
  values: Float64Array;
  /** Envelope frames per second. */
  rate: number;
}

/** Onset strength: how much the log spectrum rose since the frame before, with the local mean taken off. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope {
  const count = Math.max(0, Math.floor((samples.length - ONSET_SIZE) / ONSET_HOP) + 1);
  const values = new Float64Array(count);
  // Up to about 8 kHz: above that is mostly hiss.
  const top = Math.min(ONSET_SIZE / 2, Math.round((8000 / sampleRate) * ONSET_SIZE));
  let previous: Float64Array | null = null;
  frames(samples, ONSET_SIZE, ONSET_HOP, (mags, index) => {
    const log = new Float64Array(top);
    for (let k = 0; k < top; k += 1) log[k] = Math.log1p(1000 * (mags[k] ?? 0));
    if (previous) {
      let flux = 0;
      for (let k = 0; k < top; k += 1) flux += Math.max(0, (log[k] ?? 0) - (previous[k] ?? 0));
      values[index] = flux;
    }
    previous = log;
  });
  const rate = sampleRate / ONSET_HOP;
  // Take off a moving average (about 0.4 s), keep what's above it.
  const radius = Math.round(rate * 0.2);
  const out = new Float64Array(count);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(count, radius); i += 1) {
    sum += values[i] ?? 0;
    n += 1;
  }
  for (let i = 0; i < count; i += 1) {
    const add = i + radius;
    if (add < count) {
      sum += values[add] ?? 0;
      n += 1;
    }
    const drop = i - radius - 1;
    if (drop >= 0) {
      sum -= values[drop] ?? 0;
      n -= 1;
    }
    out[i] = Math.max(0, (values[i] ?? 0) - sum / n);
  }
  // A little smoothing (σ = 1.5 frames, 17 ms): onsets are a frame wide, and a beat
  // period is rarely a whole number of frames.
  const smooth = gaussian(out, 1.5);
  const max = smooth.reduce((m, v) => Math.max(m, v), 0);
  if (max > 0) for (let i = 0; i < count; i += 1) smooth[i] = (smooth[i] ?? 0) / max;
  return { values: smooth, rate };
}

function gaussian(x: Float64Array, sigma: number): Float64Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    Math.exp(-0.5 * ((i - radius) / sigma) ** 2),
  );
  const total = kernel.reduce((a, b) => a + b, 0);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    let v = 0;
    for (let k = -radius; k <= radius; k += 1) v += (x[i + k] ?? 0) * (kernel[k + radius] ?? 0);
    out[i] = v / total;
  }
  return out;
}

function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let i = lag; i < x.length; i += 1) s += (x[i] ?? 0) * (x[i - lag] ?? 0);
    out[lag] = s / (x.length - lag || 1);
  }
  return out;
}

/** Linear interpolation at a fractional index. */
function at(x: Float64Array, i: number): number {
  const lo = Math.floor(i);
  const f = i - lo;
  return (x[lo] ?? 0) * (1 - f) + (x[lo + 1] ?? 0) * f;
}

export interface TempoResult {
  bpm: number;
  /** Half and double tempo, when they are in 40-240 BPM. */
  alternatives: number[];
  /** 0-1: how clearly the best tempo stands out. */
  confidence: number;
  /** Seconds of each beat, from the first. */
  beats: number[];
}

export type TempoRange = 'auto' | 'slow' | 'mid' | 'fast';

const RANGES: Record<TempoRange, [number, number]> = {
  auto: [50, 220],
  slow: [60, 90],
  mid: [90, 140],
  fast: [140, 200],
};

export function detectTempo(
  samples: Float32Array,
  sampleRate: number,
  range: TempoRange = 'auto',
): TempoResult {
  const env = onsetEnvelope(samples, sampleRate);
  const [lo, hi] = RANGES[range];
  const maxLag = Math.ceil((60 * env.rate * 4) / 40);
  const acf = autocorrelation(env.values, Math.min(maxLag, env.values.length - 1));
  const score = (bpm: number) => {
    const lag = (60 * env.rate) / bpm;
    let s = 0;
    // The beat, and whole bars' worth of it, with a little of the half beat.
    for (const [k, w] of [
      [1, 1],
      [2, 0.5],
      [3, 0.33],
      [4, 0.25],
      [0.5, 0.25],
    ] as const) {
      if (lag * k < acf.length - 1) s += w * at(acf, lag * k);
    }
    // A broad preference around 120 BPM settles half/double when nothing else does.
    const prior = range === 'auto' ? Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.2) ** 2) : 1;
    return s * prior;
  };
  let best = lo;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let bpm = lo; bpm <= hi; bpm += 0.1) {
    const s = score(bpm);
    scores.push(s);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  // Finer around the best.
  for (let bpm = best - 0.1; bpm <= best + 0.1; bpm += 0.01) {
    const s = score(bpm);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - median) / bestScore)) : 0;
  const bpm = Math.round(best * 10) / 10;
  const alternatives = [bpm / 2, bpm * 2]
    .filter((b) => b >= 40 && b <= 240)
    .map((b) => Math.round(b * 10) / 10);
  return { bpm, alternatives, confidence, beats: beatTimes(env, bpm) };
}

/** Beat times for a steady tempo: the phase that lands on the most onset strength. */
export function beatTimes(env: OnsetEnvelope, bpm: number): number[] {
  const period = (60 * env.rate) / bpm;
  if (!Number.isFinite(period) || period <= 0) return [];
  let bestPhase = 0;
  let bestSum = -1;
  // Each predicted beat takes the strongest onset within 2 frames (23 ms), so a
  // tempo a hair off doesn't walk the phase off the onsets.
  const near = (t: number) => {
    let m = 0;
    for (let d = -2; d <= 2; d += 1) m = Math.max(m, at(env.values, t + d));
    return m;
  };
  for (let phase = 0; phase < period; phase += 0.25) {
    let sum = 0;
    for (let t = phase; t < env.values.length; t += period) sum += near(t);
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }
  const beats: number[] = [];
  // The envelope frame is centred half a window in.
  const offset = ONSET_SIZE / 2 / (env.rate * ONSET_HOP);
  for (let t = bestPhase; t < env.values.length; t += period) {
    beats.push(Math.max(0, t / env.rate + offset));
  }
  return beats;
}

// ---------------------------------------------------------------- key

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
/** Camelot numbers by tonic pitch class (C = 0). */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export interface KeyResult {
  /** Pitch class of the tonic, C = 0. */
  tonic: number;
  mode: 'major' | 'minor';
  /** "A minor", "E♭ major". */
  name: string;
  /** "8A", "5B". */
  camelot: string;
  /** 0-1: how far ahead of the runner-up. */
  confidence: number;
  chroma: number[];
}

/** Energy in each of the 12 pitch classes (C = 0), summed over the track and normalised. */
export function chromagram(samples: Float32Array, sampleRate: number): number[] {
  const size = sampleRate > 30_000 ? 16_384 : 8192;
  const chroma = new Array<number>(12).fill(0);
  // Each FFT bin's pitch class, for 55 Hz to 2 kHz (below is rumble, above mostly overtones).
  const classes = new Int8Array(size / 2).fill(-1);
  for (let k = 1; k < size / 2; k += 1) {
    const f = (k * sampleRate) / size;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    // Bins between two semitones say little; keep those near a note.
    if (Math.abs(midi - Math.round(midi)) > 0.35) continue;
    classes[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  frames(samples, size, size / 2, (mags) => {
    for (let k = 1; k < size / 2; k += 1) {
      const pc = classes[k] ?? -1;
      if (pc < 0) continue;
      const m = mags[k] ?? 0;
      chroma[pc] = (chroma[pc] ?? 0) + m * m;
    }
  });
  const max = Math.max(...chroma);
  return max > 0 ? chroma.map((c) => c / max) : chroma;
}

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (a[i] ?? 0) - ma;
    const y = (b[i] ?? 0) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function keyFromChroma(chroma: number[]): KeyResult {
  const results: { tonic: number; mode: 'major' | 'minor'; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, profile] of [
      ['major', MAJOR],
      ['minor', MINOR],
    ] as const) {
      const rotated = Array.from({ length: 12 }, (_, pc) => profile[(pc - tonic + 12) % 12] ?? 0);
      results.push({ tonic, mode, r: correlate(chroma, rotated) });
    }
  }
  results.sort((a, b) => b.r - a.r);
  const [best, second] = results;
  if (!best) throw new Error('no key');
  const names = best.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES;
  const camelot = best.mode === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR;
  return {
    tonic: best.tonic,
    mode: best.mode,
    name: `${names[best.tonic] ?? ''} ${best.mode}`,
    camelot: `${String(camelot[best.tonic] ?? 0)}${best.mode === 'major' ? 'B' : 'A'}`,
    // The gap to the runner-up, scaled so a clear winner reads near 1.
    confidence: Math.max(0, Math.min(1, ((best.r - (second?.r ?? 0)) / 0.15) * 0.5 + best.r * 0.5)),
    chroma,
  };
}

export function detectKey(samples: Float32Array, sampleRate: number): KeyResult {
  return keyFromChroma(chromagram(samples, sampleRate));
}

/** Two keys a DJ can mix: the same, relative major/minor, or a fifth apart (Camelot neighbours). */
export function keysRelated(
  a: { tonic: number; mode: string },
  b: { tonic: number; mode: string },
): boolean {
  if (a.tonic === b.tonic && a.mode === b.mode) return true;
  const camelot = (k: { tonic: number; mode: string }) =>
    (k.mode === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR)[k.tonic] ?? 0;
  const ca = camelot(a);
  const cb = camelot(b);
  if (ca === cb) return true; // relative
  if (a.mode !== b.mode) return false;
  const d = Math.abs(ca - cb);
  return d === 1 || d === 11;
}

/** Beat times as CSV (beat, seconds) or plain text (one time a line). */
export function beatMarkers(beats: number[], format: 'csv' | 'txt'): string {
  if (format === 'txt') return `${beats.map((t) => t.toFixed(3)).join('\n')}\n`;
  return `beat,seconds\n${beats.map((t, i) => `${String(i + 1)},${t.toFixed(3)}`).join('\n')}\n`;
}
