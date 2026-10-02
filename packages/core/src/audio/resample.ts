/**
 * Sample-rate conversion, streamed: blocks in at one rate, blocks out at
 * another, for joining or mixing audio recorded at different rates (V14
 * Add or Replace Audio, A04 Merge Audio). Each output sample is a
 * Kaiser-windowed sinc (β = 8) over the input around it, cut off at 95% of
 * the lower rate's Nyquist frequency, and scaled so a steady level stays
 * exactly the same.
 */

/** Zero crossings of the sinc each side of the centre, at the lower rate. */
const HALF = 16;
/** Table points per input sample; in between is a straight line. */
const RES = 512;
const BETA = 8;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

export class Resampler {
  readonly from: number;
  readonly to: number;
  readonly channels: number;
  /** The filter's cutoff, as a fraction of the input's Nyquist frequency. */
  private readonly cutoff: number;
  /** Input samples either side of an output sample that it reads. */
  private readonly width: number;
  /** The windowed sinc from 0 to `width` input samples, RES points per sample. */
  private readonly table: Float32Array;
  /** Input not yet used up, per channel; `base` is the absolute index of its first sample. */
  private buffers: Float32Array[];
  private length: number;
  private base: number;
  private received = 0;
  private produced = 0;

  constructor(from: number, to: number, channels: number) {
    this.from = from;
    this.to = to;
    this.channels = channels;
    this.cutoff = Math.min(1, to / from) * 0.95;
    this.width = HALF / this.cutoff;
    const points = Math.ceil(this.width * RES) + 2;
    this.table = new Float32Array(points);
    const norm = besselI0(BETA);
    for (let i = 0; i < points; i += 1) {
      const d = i / RES;
      if (d >= this.width) continue;
      const x = Math.PI * this.cutoff * d;
      const sinc = d === 0 ? 1 : Math.sin(x) / x;
      const r = d / this.width;
      this.table[i] = sinc * (besselI0(BETA * Math.sqrt(1 - r * r)) / norm);
    }
    // Silence before the start, so the first samples have a full window.
    const lead = Math.ceil(this.width) + 1;
    this.base = -lead;
    this.length = lead;
    this.buffers = Array.from({ length: channels }, () => new Float32Array(lead + 4096));
  }

  /** Output for the next block of input (one array per channel, all the same length). */
  push(planes: Float32Array[]): Float32Array[] {
    const frames = planes[0]?.length ?? 0;
    if (this.from === this.to) {
      this.received += frames;
      this.produced += frames;
      return Array.from({ length: this.channels }, (_, c) =>
        Float32Array.from(planes[c] ?? new Float32Array(frames)),
      );
    }
    this.append(planes, frames);
    this.received += frames;
    return this.drain(Infinity);
  }

  /** The rest, once the input has ended: the output is then exactly round(input × to / from) long. */
  flush(): Float32Array[] {
    if (this.from === this.to)
      return Array.from({ length: this.channels }, () => new Float32Array(0));
    const tail = Math.ceil(this.width) + 2;
    this.append([], tail);
    return this.drain(Math.round((this.received * this.to) / this.from));
  }

  private append(planes: Float32Array[], frames: number): void {
    const needed = this.length + frames;
    if (needed > (this.buffers[0]?.length ?? 0)) {
      this.buffers = this.buffers.map((old) => {
        const grown = new Float32Array(Math.max(needed, old.length * 2));
        grown.set(old.subarray(0, this.length));
        return grown;
      });
    }
    this.buffers.forEach((buffer, c) => {
      const plane = planes[c] ?? planes[0];
      if (plane) buffer.set(plane.subarray(0, frames), this.length);
      else buffer.fill(0, this.length, this.length + frames);
    });
    this.length += frames;
  }

  private drain(limit: number): Float32Array[] {
    const { from, to, width, table, base } = this;
    const available = base + this.length;
    // Every output sample whose window is all in hand, up to the limit.
    const last = Math.min(limit, Math.floor(((available - 1 - width) * to) / from) + 1);
    const count = Math.max(0, last - this.produced);
    const out = Array.from({ length: this.channels }, () => new Float32Array(count));
    const weights = new Float64Array(Math.ceil(2 * width) + 2);
    for (let n = 0; n < count; n += 1) {
      const x = ((this.produced + n) * from) / to;
      const lo = Math.ceil(x - width);
      const hi = Math.floor(x + width);
      let sum = 0;
      for (let k = lo; k <= hi; k += 1) {
        const a = Math.abs(x - k) * RES;
        const i = a | 0;
        const f = a - i;
        const w = (table[i] ?? 0) * (1 - f) + (table[i + 1] ?? 0) * f;
        weights[k - lo] = w;
        sum += w;
      }
      const taps = hi - lo + 1;
      const offset = lo - base;
      for (let c = 0; c < this.channels; c += 1) {
        const buffer = this.buffers[c];
        const target = out[c];
        if (!buffer || !target) continue;
        let acc = 0;
        for (let j = 0; j < taps; j += 1) acc += (weights[j] ?? 0) * (buffer[offset + j] ?? 0);
        target[n] = acc / sum;
      }
    }
    this.produced += count;
    // Drop what no later output sample reads.
    const keep = Math.floor((this.produced * this.from) / this.to - this.width) - 1;
    const drop = Math.min(this.length, keep - this.base);
    if (drop > 0) {
      for (const buffer of this.buffers) buffer.copyWithin(0, drop, this.length);
      this.length -= drop;
      this.base += drop;
    }
    return out;
  }
}
