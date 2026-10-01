/**
 * Loudness to ITU-R BS.1770-4 and EBU R128 (tools/audio.md → A05, A06), our
 * own implementation, checked against the EBU's conformance signals (Tech
 * 3341 and 3342) and pyloudnorm. Shared with the panel.
 *
 * A scan reads the audio once, in blocks of any size: K-weighted energy per
 * 100 ms (for momentary, short-term, integrated loudness and the loudness
 * range), the true peak (4× oversampled below 96 kHz, 2× below 192 kHz), and
 * optionally, per millisecond, the energy and true peak that the normaliser
 * plans its gain and limiter from.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The K-weighting filter for a sample rate: the head's high shelf (+4 dB
 * above about 1.5 kHz), then the RLB high-pass (about 38 Hz). Designed from
 * the analogue prototypes, so 44.1 and 96 kHz get their own coefficients;
 * at 48 kHz they match BS.1770's table.
 */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / rate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + k / q + k * k;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highPass];
}

/**
 * Each channel's weight in the sum (BS.1770 → G): 1 for left, right and
 * centre, 1.41 (+1.5 dB) for the surrounds, 0 for the LFE. Channel order is
 * WAV's: L R C LFE Ls Rs for 5.1; five channels are L R C Ls Rs.
 */
export function channelWeights(channels: number): number[] {
  if (channels === 5) return [1, 1, 1, 1.41, 1.41];
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (channels === 8) return [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

/** True-peak oversampling for a rate: 4× below 96 kHz, 2× below 192 kHz. */
export function oversampling(rate: number): number {
  return rate < 96_000 ? 4 : rate < 192_000 ? 2 : 1;
}

/** Taps either side of the point the interpolator reads. */
const HALF = 8;

/** Frames the true-peak scan checks at once before skipping a quiet stretch. */
const SKIP_BLOCK = 64;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/**
 * The interpolator for the in-between points: for each of the factor - 1
 * phases, 2 × HALF taps of a Kaiser-windowed sinc (β = 8), scaled to unit
 * gain, one row after another. Flat within 0.01 dB up to a quarter of the
 * sample rate. `l1` is the most any row can amplify a signal.
 */
export function interpolator(factor: number): { taps: Float64Array; rows: number; l1: number } {
  const span = HALF * 2;
  const rows = factor - 1;
  const taps = new Float64Array(rows * span);
  const beta = 8;
  let l1 = 1;
  for (let p = 1; p < factor; p += 1) {
    const frac = p / factor;
    const off = (p - 1) * span;
    let sum = 0;
    for (let i = 0; i < span; i += 1) {
      // Tap i reads x[n - HALF + 1 + i]; the point sits at n + frac.
      const t = i - HALF + 1 - frac;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = t / HALF;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / besselI0(beta);
      taps[off + i] = sinc * w;
      sum += sinc * w;
    }
    let size = 0;
    for (let i = 0; i < span; i += 1) {
      const v = (taps[off + i] ?? 0) / sum;
      taps[off + i] = v;
      size += Math.abs(v);
    }
    l1 = Math.max(l1, size);
  }
  return { taps, rows, l1 };
}

export interface ScanResult {
  rate: number;
  channels: number;
  frames: number;
  /** Weighted K-filtered energy of each whole 100 ms block (sum, not mean), and its length in frames. */
  energy100: Float64Array;
  frames100: Int32Array;
  /** Linear: the highest true peak and sample peak over all channels. */
  truePeak: number;
  samplePeak: number;
  /** Sum of squares of every sample, every channel, unweighted: for RMS. */
  squares: number;
  /** With `perMs`: per block of `msFrames` frames, the weighted K energy (sum) and the true peak. */
  ms?: { frames: number; energy: Float32Array; peak: Float32Array };
}

/**
 * Reads audio once and keeps what loudness needs. Push planar channels (one
 * Float32Array each, the same length) in order; `finish` reads the rest.
 */
export class LoudnessScan {
  private readonly weights: number[];
  private readonly filters: [Biquad, Biquad];
  /** Per channel: the shelf's last inputs and outputs, then the high-pass's last outputs. */
  private readonly state: Float64Array[];
  private readonly taps: Float64Array;
  private readonly rows: number;
  private readonly l1: number;
  /** Per channel: samples from frame `historyStart` on, kept for the interpolator. */
  private history: Float64Array[];
  private historyStart = 0;
  private readonly energy100: number[] = [];
  private readonly frames100: number[] = [];
  private acc100 = 0;
  private count100 = 0;
  private next100: number;
  private readonly msFrames: number;
  private readonly msEnergy: number[] = [];
  private readonly msPeak: number[] = [];
  private accMs = 0;
  private countMs = 0;
  private openMs = 0;
  private openPeak = 0;
  private frames = 0;
  private truePeak = 0;
  private samplePeak = 0;
  private squares = 0;
  /** The interpolator has read up to here; it runs HALF frames behind the input. */
  private peakFrame = 0;

  constructor(
    private readonly rate: number,
    private readonly channels: number,
    private readonly options: { perMs?: boolean } = {},
  ) {
    this.weights = channelWeights(channels);
    this.filters = kWeighting(rate);
    this.state = Array.from({ length: channels }, () => new Float64Array(6));
    const { taps, rows, l1 } = interpolator(oversampling(rate));
    this.taps = taps;
    this.rows = rows;
    this.l1 = l1;
    // Silence before the start, so the first points have samples to read.
    this.history = Array.from({ length: channels }, () => new Float64Array(HALF - 1));
    this.historyStart = -(HALF - 1);
    this.next100 = Math.floor(rate / 10);
    this.msFrames = Math.max(1, Math.round(rate / 1000));
  }

  push(planes: Float32Array[]): void {
    const frames = planes[0]?.length ?? 0;
    if (frames === 0) return;
    const [s, h] = this.filters;
    // K-weighted energy, frame by frame, summed over the channels with their weights.
    const weighted = new Float64Array(frames);
    for (let c = 0; c < this.channels; c += 1) {
      const plane = planes[c];
      const st = this.state[c];
      if (!plane || !st) continue;
      const w = this.weights[c] ?? 1;
      let x1 = st[0] ?? 0;
      let x2 = st[1] ?? 0;
      let y1 = st[2] ?? 0;
      let y2 = st[3] ?? 0;
      let v1 = st[4] ?? 0;
      let v2 = st[5] ?? 0;
      for (let i = 0; i < frames; i += 1) {
        const x = plane[i] ?? 0;
        const ax = Math.abs(x);
        if (ax > this.samplePeak) this.samplePeak = ax;
        this.squares += x * x;
        const y = s.b0 * x + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
        // The high-pass reads the shelf's output, so its past inputs are the shelf's past outputs.
        const v = h.b0 * y + h.b1 * y1 + h.b2 * y2 - h.a1 * v1 - h.a2 * v2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        v2 = v1;
        v1 = v;
        if (w !== 0) weighted[i] = (weighted[i] ?? 0) + w * v * v;
      }
      st.set([x1, x2, y1, y2, v1, v2]);
    }
    for (let i = 0; i < frames; i += 1) {
      const e = weighted[i] ?? 0;
      this.acc100 += e;
      this.count100 += 1;
      if (this.frames + i + 1 >= this.next100) {
        this.energy100.push(this.acc100);
        this.frames100.push(this.count100);
        this.acc100 = 0;
        this.count100 = 0;
        this.next100 = Math.floor(((this.energy100.length + 1) * this.rate) / 10);
      }
      if (this.options.perMs) {
        this.accMs += e;
        this.countMs += 1;
        if (this.countMs === this.msFrames) {
          this.msEnergy.push(this.accMs);
          this.accMs = 0;
          this.countMs = 0;
        }
      }
    }
    for (let c = 0; c < this.channels; c += 1) {
      const hist = this.history[c] ?? new Float64Array(0);
      const plane = planes[c] ?? new Float32Array(0);
      const all = new Float64Array(hist.length + frames);
      all.set(hist, 0);
      all.set(plane.subarray(0, frames), hist.length);
      this.history[c] = all;
    }
    this.frames += frames;
    this.peaks(this.frames - HALF);
  }

  /**
   * The true peak: every sample, and the points between samples the
   * interpolator makes, up to frame `upTo`. A point needs HALF samples after
   * it, so this runs behind the input; the end is padded with silence.
   */
  private peaks(upTo: number): void {
    if (upTo <= this.peakFrame) return;
    const count = upTo - this.peakFrame;
    const framePeak = new Float64Array(count);
    const span = HALF * 2;
    const taps = this.taps;
    const rows = this.rows;
    // Without per-ms peaks, only the highest matters: a stretch whose samples, times the
    // most the interpolator can amplify, stay under the peak so far can't raise it.
    const skip = this.options.perMs ? 0 : this.truePeak / this.l1;
    for (let c = 0; c < this.channels; c += 1) {
      const all = this.history[c] ?? new Float64Array(0);
      const base = this.peakFrame - this.historyStart;
      for (let k = 0; k < count; k += 1) {
        const at = base + k;
        if (skip > 0 && k % SKIP_BLOCK === 0) {
          const end = Math.min(count, k + SKIP_BLOCK);
          let most = 0;
          for (let i = at - HALF + 1; i < base + end + HALF; i += 1) {
            const v = Math.abs(all[i] ?? 0);
            if (v > most) most = v;
          }
          if (most <= skip) {
            k = end - 1;
            continue;
          }
        }
        const x = all[at] ?? 0;
        let peak = x < 0 ? -x : x;
        const from = at - HALF + 1;
        for (let r = 0; r < rows; r += 1) {
          const off = r * span;
          let sum = 0;
          for (let i = 0; i < span; i += 1) sum += (taps[off + i] ?? 0) * (all[from + i] ?? 0);
          if (sum < 0) sum = -sum;
          if (sum > peak) peak = sum;
        }
        if (peak > (framePeak[k] ?? 0)) framePeak[k] = peak;
      }
    }
    for (let k = 0; k < count; k += 1) {
      const peak = framePeak[k] ?? 0;
      if (peak > this.truePeak) this.truePeak = peak;
      if (this.options.perMs) {
        const ms = Math.floor((this.peakFrame + k) / this.msFrames);
        while (ms > this.openMs) {
          this.msPeak.push(this.openPeak);
          this.openPeak = 0;
          this.openMs += 1;
        }
        if (peak > this.openPeak) this.openPeak = peak;
      }
    }
    this.peakFrame = upTo;
    // Keep the samples the next points read: from HALF - 1 before the next one.
    const keepFrom = upTo - HALF + 1;
    if (keepFrom > this.historyStart) {
      this.history = this.history.map((all) => all.slice(keepFrom - this.historyStart));
      this.historyStart = keepFrom;
    }
  }

  finish(): ScanResult {
    // The last points read silence after the end.
    this.history = this.history.map((all) => {
      const padded = new Float64Array(all.length + HALF);
      padded.set(all, 0);
      return padded;
    });
    this.peaks(this.frames);
    const result: ScanResult = {
      rate: this.rate,
      channels: this.channels,
      frames: this.frames,
      energy100: Float64Array.from(this.energy100),
      frames100: Int32Array.from(this.frames100),
      truePeak: this.truePeak,
      samplePeak: this.samplePeak,
      squares: this.squares,
    };
    if (this.options.perMs) {
      if (this.countMs > 0) this.msEnergy.push(this.accMs);
      const blocks = this.msEnergy.length;
      const peak = new Float32Array(blocks);
      peak.set(this.msPeak.slice(0, blocks));
      if (this.msPeak.length < blocks) peak[this.msPeak.length] = this.openPeak;
      result.ms = { frames: this.msFrames, energy: Float32Array.from(this.msEnergy), peak };
    }
    return result;
  }
}

/** LUFS from a mean of weighted energies; -Infinity for silence. */
export const lufs = (meanEnergy: number): number =>
  meanEnergy > 0 ? -0.691 + 10 * Math.log10(meanEnergy) : -Infinity;

export const dbOf = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

/**
 * Loudness of each window of `blocks` 100 ms blocks, one per 100 ms step,
 * the first ending at block `blocks - 1` (momentary: 4, short-term: 30).
 * Returns mean energies, so gating can average them.
 */
export function windows(scan: ScanResult, blocks: number): Float64Array {
  const n = scan.energy100.length - blocks + 1;
  if (n <= 0) return new Float64Array(0);
  const out = new Float64Array(n);
  let energy = 0;
  let frames = 0;
  for (let i = 0; i < scan.energy100.length; i += 1) {
    energy += scan.energy100[i] ?? 0;
    frames += scan.frames100[i] ?? 0;
    if (i >= blocks) {
      energy -= scan.energy100[i - blocks] ?? 0;
      frames -= scan.frames100[i - blocks] ?? 0;
    }
    if (i >= blocks - 1) out[i - blocks + 1] = frames > 0 ? Math.max(0, energy) / frames : 0;
  }
  return out;
}

/** Integrated loudness (BS.1770-4): 400 ms blocks every 100 ms, gated at -70 LUFS and 10 LU below. */
export function integrated(blocks400: Float64Array): number {
  const absolute: number[] = [];
  for (const z of blocks400) if (lufs(z) >= -70) absolute.push(z);
  if (absolute.length === 0) return -Infinity;
  const relative = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((z) => lufs(z) > relative);
  if (gated.length === 0) return -Infinity;
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** A percentile of sorted values, interpolating between neighbours. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

/**
 * Loudness range (EBU Tech 3342): the short-term loudness every 100 ms,
 * gated at -70 LUFS and 20 LU below their mean, from the 10th to the 95th
 * percentile.
 */
export function loudnessRange(shortTerm: Float64Array): number {
  const absolute: number[] = [];
  for (const z of shortTerm) if (lufs(z) >= -70) absolute.push(z);
  if (absolute.length === 0) return 0;
  const relative = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 20;
  const gated = absolute
    .map(lufs)
    .filter((l) => l > relative)
    .sort((a, b) => a - b);
  if (gated.length === 0) return 0;
  return percentile(gated, 0.95) - percentile(gated, 0.1);
}

export interface Loudness {
  /** LUFS; -Infinity for silence. */
  integrated: number;
  momentaryMax: number;
  /** -Infinity when the audio is under 3 s. */
  shortTermMax: number;
  /** LU. */
  range: number;
  /** dBTP and dBFS. */
  truePeak: number;
  samplePeak: number;
  /** Unweighted, over every channel: dBFS. */
  rms: number;
  durationSec: number;
  /** Every 100 ms: momentary (400 ms) and short-term (3 s) loudness, LUFS, from 0.4 and 3 s on. */
  momentary: Float32Array;
  shortTerm: Float32Array;
}

export function measure(scan: ScanResult): Loudness {
  const momentary = windows(scan, 4);
  const shortTerm = windows(scan, 30);
  const max = (values: Float64Array) => {
    let best = 0;
    for (const v of values) if (v > best) best = v;
    return lufs(best);
  };
  return {
    integrated: integrated(momentary),
    momentaryMax: max(momentary),
    shortTermMax: max(shortTerm),
    range: loudnessRange(shortTerm),
    truePeak: dbOf(scan.truePeak),
    samplePeak: dbOf(scan.samplePeak),
    rms: dbOf(Math.sqrt(scan.squares / Math.max(1, scan.frames * scan.channels))),
    durationSec: scan.frames / scan.rate,
    momentary: Float32Array.from(momentary, lufs),
    shortTerm: Float32Array.from(shortTerm, lufs),
  };
}

export interface NormalizePlan {
  /** The static gain, dB. */
  gainDb: number;
  /** The limiter acts somewhere. */
  limited: boolean;
  /**
   * With the limiter: the gain (linear, static gain included) at the start
   * of each block of `msFrames` frames, and one more at the end; frames in
   * between are interpolated.
   */
  knots?: Float32Array;
  msFrames: number;
  /** The most the limiter takes off, dB (0 without it). */
  reductionDb: number;
  /** What the output should measure: integrated LUFS and true peak dBTP. */
  predicted: { integrated: number; truePeak: number };
  /** Gain only and over the ceiling: the gain was held back, and the target missed. */
  heldBack: boolean;
}

/** Look-ahead and release of the limiter, in blocks of about 1 ms. */
const ATTACK = 5;
/** Each knot also suits this many blocks either side: room for a timeline a frame or two off. */
const SLACK = 2;
const RELEASE = 80;
/** The limiter aims this far under the ceiling, dB: the interpolated gain moves peaks a little. */
const MARGIN = 0.1;

/**
 * The limiter's gain at each block boundary, 1 where nothing needs taking
 * off. Each block's peak, times `gain`, stays at or under `ceiling` (both
 * linear): the gain reaches its low point over the ATTACK blocks before a
 * peak (a minimum ahead, then an average over as many, so it never rises
 * above what any block needs) and recovers over about RELEASE blocks after.
 */
export function limiterKnots(peaks: Float32Array, gain: number, ceiling: number): Float32Array {
  const blocks = peaks.length;
  const need = (b: number) => {
    const p = (peaks[b] ?? 0) * gain;
    return p > ceiling ? ceiling / p : 1;
  };
  // A knot sits between two blocks and must suit both, and SLACK more either side.
  const knots = new Float64Array(blocks + 1);
  for (let k = 0; k <= blocks; k += 1) {
    let low = 1;
    for (let b = Math.max(0, k - 1 - SLACK); b < Math.min(blocks, k + 1 + SLACK); b += 1) {
      low = Math.min(low, need(b));
    }
    knots[k] = low;
  }
  // The lowest need from here to ATTACK - 1 knots ahead.
  const ahead = new Float64Array(blocks + 1);
  for (let k = 0; k <= blocks; k += 1) {
    let low = 1;
    for (let j = k; j < Math.min(blocks + 1, k + ATTACK); j += 1)
      low = Math.min(low, knots[j] ?? 1);
    ahead[k] = low;
  }
  // Averaged over the ATTACK knots up to here: a ramp down that's already low enough at the peak.
  const out = new Float32Array(blocks + 1);
  const recover = 1 - Math.exp(-1 / RELEASE);
  let previous = 1;
  for (let k = 0; k <= blocks; k += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, k - ATTACK + 1); j <= k; j += 1) {
      sum += ahead[j] ?? 1;
      count += 1;
    }
    const smooth = sum / count;
    // Then back up slowly: never faster than the release, never above what's needed.
    const value = Math.min(smooth, previous + (1 - previous) * recover);
    out[k] = value;
    previous = value;
  }
  return out;
}

/**
 * Integrated loudness after a gain that varies per block (`knots`, linear,
 * between block boundaries): from the per-ms energies, regrouped into
 * 100 ms blocks. Close to measuring the output, without decoding again.
 */
export function predictIntegrated(
  ms: NonNullable<ScanResult['ms']>,
  knots: Float32Array | null,
  gain: number,
): number {
  // A hundred blocks of about 1 ms make each 100 ms block.
  const per100 = 100;
  const blocks100: number[] = [];
  let acc = 0;
  for (let b = 0; b < ms.energy.length; b += 1) {
    const a = knots ? (knots[b] ?? 1) : 1;
    const z = knots ? (knots[b + 1] ?? a) : 1;
    // The mean of the gain squared across a block where it moves in a straight line.
    const g2 = gain * gain * ((a * a + a * z + z * z) / 3);
    acc += (ms.energy[b] ?? 0) * g2;
    if ((b + 1) % per100 === 0) {
      blocks100.push(acc);
      acc = 0;
    }
  }
  const frames100 = ms.frames * per100;
  const z400: number[] = [];
  for (let i = 3; i < blocks100.length; i += 1) {
    const sum =
      (blocks100[i] ?? 0) +
      (blocks100[i - 1] ?? 0) +
      (blocks100[i - 2] ?? 0) +
      (blocks100[i - 3] ?? 0);
    z400.push(sum / (frames100 * 4));
  }
  return integrated(Float64Array.from(z400));
}

/**
 * How to bring audio to `target` LUFS with its true peak at or under
 * `ceiling` dBTP. A gain alone when it fits. Otherwise, with `limit`, a
 * true-peak limiter takes the peaks down, and the gain is raised until the
 * limited result reaches the target; without it, the gain stops where the
 * peaks reach the ceiling.
 */
export function planNormalize(
  scan: ScanResult,
  options: { target: number; ceiling: number; limit: boolean },
): NormalizePlan {
  const ms = scan.ms;
  if (!ms) throw new Error('The scan needs per-ms blocks to plan with');
  const measured = integrated(windows(scan, 4));
  if (!Number.isFinite(measured)) throw new RangeError('Silent: there is no loudness to set');
  const peakDb = dbOf(scan.truePeak);
  let gainDb = options.target - measured;
  const base = { msFrames: ms.frames, reductionDb: 0 };
  if (peakDb + gainDb <= options.ceiling) {
    return {
      ...base,
      gainDb,
      limited: false,
      predicted: { integrated: measured + gainDb, truePeak: peakDb + gainDb },
      heldBack: false,
    };
  }
  if (!options.limit) {
    gainDb = options.ceiling - peakDb;
    return {
      ...base,
      gainDb,
      limited: false,
      predicted: { integrated: measured + gainDb, truePeak: options.ceiling },
      heldBack: true,
    };
  }
  const ceiling = 10 ** ((options.ceiling - MARGIN) / 20);
  let knots: Float32Array = new Float32Array(0);
  let predicted = measured;
  for (let round = 0; round < 12; round += 1) {
    const gain = 10 ** (gainDb / 20);
    knots = limiterKnots(ms.peak, gain, ceiling);
    predicted = predictIntegrated(ms, knots, gain);
    const miss = options.target - predicted;
    if (Math.abs(miss) < 0.01) break;
    gainDb += miss;
  }
  const gain = 10 ** (gainDb / 20);
  let lowest = 1;
  let peak = 0;
  for (let b = 0; b < ms.peak.length; b += 1) {
    lowest = Math.min(lowest, knots[b] ?? 1);
    peak = Math.max(peak, (ms.peak[b] ?? 0) * gain * Math.max(knots[b] ?? 1, knots[b + 1] ?? 1));
  }
  const scaled = Float32Array.from(knots, (k) => k * gain);
  return {
    gainDb,
    limited: true,
    knots: scaled,
    msFrames: ms.frames,
    reductionDb: -dbOf(lowest),
    predicted: { integrated: predicted, truePeak: Math.min(dbOf(peak), options.ceiling) },
    heldBack: false,
  };
}

/**
 * Applies a plan to planar audio in place: `start` is the first frame's
 * index in the whole file.
 */
export function applyPlan(planes: Float32Array[], start: number, plan: NormalizePlan): void {
  const frames = planes[0]?.length ?? 0;
  if (!plan.knots) {
    const gain = 10 ** (plan.gainDb / 20);
    for (const plane of planes)
      for (let i = 0; i < frames; i += 1) plane[i] = (plane[i] ?? 0) * gain;
    return;
  }
  const knots = plan.knots;
  const last = knots.length - 1;
  const gains = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const at = (start + i) / plan.msFrames;
    const b = Math.min(last, Math.floor(at));
    const a = knots[b] ?? 1;
    const z = knots[Math.min(last, b + 1)] ?? a;
    gains[i] = a + (z - a) * (at - b);
  }
  for (const plane of planes)
    for (let i = 0; i < frames; i += 1) plane[i] = (plane[i] ?? 0) * (gains[i] ?? 1);
}
