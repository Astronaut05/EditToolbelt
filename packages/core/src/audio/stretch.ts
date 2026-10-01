/**
 * Time-stretching without changing pitch (tools/audio.md → A08, and V13's
 * sound): a phase vocoder with identity phase locking (Laroche & Dolson).
 * Each 4096-point frame's spectrum is laid down at a new spacing; every
 * peak's phase moves on at its measured frequency and the bins around it
 * keep their phase relative to it, which keeps tones clean. Streamed, so a
 * long file needs no more memory than a few frames. With the Resampler it
 * also shifts pitch without changing length.
 */
import { Fft } from './fft';

const SIZE = 4096;
const SYNTHESIS_HOP = SIZE / 4;
/** Sum of the squared Hann windows overlapping at a quarter-frame hop. */
const OVERLAP_GAIN = 1.5;

const wrap = (phase: number) => phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));

class ChannelState {
  previous = new Float64Array(SIZE / 2 + 1);
  synthesis = new Float64Array(SIZE / 2 + 1);
  first = true;
}

export class TimeStretch {
  /** Output length ÷ input length: 1.25 plays 80% as fast. */
  readonly ratio: number;
  readonly channels: number;
  private readonly analysisHop: number;
  private readonly fft = new Fft(SIZE);
  private readonly window = new Float64Array(SIZE);
  private readonly states: ChannelState[];
  private input: Float32Array[];
  private inputLength: number;
  /** Absolute input index of input[0]: negative while the lead-in silence is there. */
  private inputBase: number;
  private received = 0;
  private output: Float64Array[];
  /** Absolute output index of output[0]. */
  private outputBase = -SIZE / 2;
  private produced = 0;
  private frame = 0;
  private lastPosition = 0;
  private readonly re = new Float64Array(SIZE);
  private readonly im = new Float64Array(SIZE);
  private readonly magnitude = new Float64Array(SIZE / 2 + 1);
  private readonly phase = new Float64Array(SIZE / 2 + 1);

  constructor(channels: number, ratio: number) {
    if (!(ratio > 0) || !Number.isFinite(ratio))
      throw new RangeError('The stretch ratio must be above 0');
    this.ratio = ratio;
    this.channels = channels;
    this.analysisHop = SYNTHESIS_HOP / ratio;
    for (let i = 0; i < SIZE; i += 1)
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE);
    this.states = Array.from({ length: channels }, () => new ChannelState());
    // Half a frame of silence first, so the first frame is centred on the first sample.
    this.inputBase = -SIZE / 2;
    this.inputLength = SIZE / 2;
    this.input = Array.from({ length: channels }, () => new Float32Array(SIZE * 4));
    this.output = Array.from({ length: channels }, () => new Float64Array(SIZE * 4));
  }

  /** Output for the next block of input: one array per channel, all the same length. */
  push(planes: Float32Array[]): Float32Array[] {
    const frames = planes[0]?.length ?? 0;
    if (this.ratio === 1) {
      this.received += frames;
      this.produced += frames;
      return Array.from({ length: this.channels }, (_, c) =>
        Float32Array.from(planes[c] ?? new Float32Array(frames)),
      );
    }
    this.append(planes, frames);
    this.received += frames;
    this.run();
    return this.take(Infinity);
  }

  /** The rest, once the input has ended: the output is then round(input × ratio) long. */
  flush(): Float32Array[] {
    if (this.ratio === 1) return Array.from({ length: this.channels }, () => new Float32Array(0));
    const target = Math.round(this.received * this.ratio);
    this.run(true);
    return this.take(target - this.produced);
  }

  private append(planes: Float32Array[], frames: number): void {
    const needed = this.inputLength + frames;
    if (needed > (this.input[0]?.length ?? 0)) {
      this.input = this.input.map((old) => {
        const grown = new Float32Array(Math.max(needed, old.length * 2));
        grown.set(old.subarray(0, this.inputLength));
        return grown;
      });
    }
    this.input.forEach((buffer, c) => {
      const plane = planes[c] ?? planes[0];
      if (plane) buffer.set(plane.subarray(0, frames), this.inputLength);
      else buffer.fill(0, this.inputLength, this.inputLength + frames);
    });
    this.inputLength += frames;
  }

  /** Every frame whose input is all in hand (or, at the end, every frame the output needs). */
  private run(ending = false): void {
    const available = this.inputBase + this.inputLength;
    const target = Math.round(this.received * this.ratio);
    for (;;) {
      const centre = Math.round(this.frame * this.analysisHop);
      // At the end, what's past the input is silence.
      if (!ending && centre + SIZE / 2 > available) break;
      if (ending && this.frame * SYNTHESIS_HOP - SIZE / 2 >= target) break;
      this.process(centre);
      this.frame += 1;
    }
    // Drop input no later frame reads.
    const next = Math.round(this.frame * this.analysisHop) - SIZE / 2;
    const drop = Math.min(this.inputLength, next - this.inputBase);
    if (drop > 0) {
      for (const buffer of this.input) buffer.copyWithin(0, drop, this.inputLength);
      this.inputLength -= drop;
      this.inputBase += drop;
    }
  }

  private process(centre: number): void {
    const hop = this.frame === 0 ? this.analysisHop : centre - this.lastPosition;
    this.lastPosition = centre;
    const at = this.frame * SYNTHESIS_HOP - SIZE / 2;
    this.ensureOutput(at + SIZE);
    const bins = SIZE / 2;
    for (let c = 0; c < this.channels; c += 1) {
      const source = this.input[c];
      const state = this.states[c];
      const target = this.output[c];
      if (!source || !state || !target) continue;
      const start = centre - SIZE / 2 - this.inputBase;
      for (let i = 0; i < SIZE; i += 1) {
        const j = start + i;
        this.re[i] = (j < this.inputLength ? (source[j] ?? 0) : 0) * (this.window[i] ?? 0);
        this.im[i] = 0;
      }
      this.fft.transform(this.re, this.im);
      for (let b = 0; b <= bins; b += 1) {
        const r = this.re[b] ?? 0;
        const im = this.im[b] ?? 0;
        this.magnitude[b] = Math.hypot(r, im);
        this.phase[b] = Math.atan2(im, r);
      }
      const synthesis = state.synthesis;
      if (state.first) {
        synthesis.set(this.phase);
        state.first = false;
      } else {
        // Peaks move on at their own frequency; the bins around each keep their phase relative to it.
        let b = 0;
        while (b <= bins) {
          // The next peak: the loudest bin of the run up to the next fall.
          let next = b;
          while (next < bins && (this.magnitude[next + 1] ?? 0) >= (this.magnitude[next] ?? 0))
            next += 1;
          const omega = (2 * Math.PI * next) / SIZE;
          const deviation = wrap(
            (this.phase[next] ?? 0) - (state.previous[next] ?? 0) - omega * hop,
          );
          const frequency = omega + deviation / hop;
          const peakPhase = (synthesis[next] ?? 0) + frequency * SYNTHESIS_HOP;
          // Its region runs to the lowest point before the following peak.
          let end = next;
          while (end < bins && (this.magnitude[end + 1] ?? 0) <= (this.magnitude[end] ?? 0))
            end += 1;
          for (let k = b; k <= end; k += 1) {
            if (k === next) continue;
            synthesis[k] = peakPhase + (this.phase[k] ?? 0) - (this.phase[next] ?? 0);
          }
          synthesis[next] = peakPhase;
          b = end + 1;
        }
      }
      state.previous.set(this.phase);
      for (let k = 0; k <= bins; k += 1) {
        const m = this.magnitude[k] ?? 0;
        const p = synthesis[k] ?? 0;
        this.re[k] = m * Math.cos(p);
        this.im[k] = m * Math.sin(p);
        if (k > 0 && k < bins) {
          this.re[SIZE - k] = this.re[k] ?? 0;
          this.im[SIZE - k] = -(this.im[k] ?? 0);
        }
      }
      this.fft.transform(this.re, this.im, true);
      const offset = at - this.outputBase;
      const scale = 1 / (SIZE * OVERLAP_GAIN);
      for (let i = 0; i < SIZE; i += 1) {
        target[offset + i] =
          (target[offset + i] ?? 0) + (this.re[i] ?? 0) * (this.window[i] ?? 0) * scale;
      }
      // Keep the phases wrapped so they don't lose precision over a long file.
      for (let k = 0; k <= bins; k += 1) synthesis[k] = wrap(synthesis[k] ?? 0);
    }
  }

  private ensureOutput(end: number): void {
    const needed = end - this.outputBase;
    if (needed <= (this.output[0]?.length ?? 0)) return;
    this.output = this.output.map((old) => {
      const grown = new Float64Array(Math.max(needed, old.length * 2));
      grown.set(old);
      return grown;
    });
  }

  /** The finished output samples, at most `limit` of them, from the next one not yet given. */
  private take(limit: number): Float32Array[] {
    // Samples before the next frame's start have all their frames added.
    const complete = this.frame * SYNTHESIS_HOP - SIZE / 2;
    const count = Math.max(0, Math.min(limit, complete - this.produced));
    const from = this.produced - this.outputBase;
    const out = this.output.map((buffer) => Float32Array.from(buffer.subarray(from, from + count)));
    this.produced += count;
    // Drop what's been given.
    const drop = this.produced - this.outputBase;
    if (drop > SIZE * 2) {
      for (let c = 0; c < this.output.length; c += 1) {
        const buffer = this.output[c];
        if (!buffer) continue;
        buffer.copyWithin(0, drop);
        buffer.fill(0, buffer.length - drop);
      }
      this.outputBase += drop;
    }
    return out;
  }
}
