/**
 * Joins kept spans of audio end to end as it streams in (A02, V01), with a
 * crossfade centred on every join: the last `crossfade / 2` of one span fades
 * out over the first `crossfade / 2` of the next fading in, using the audio
 * just beyond each span's edge. So a join never clicks, and the result is
 * exactly as long as the spans (video cut at the same points stays in sync).
 * Optional fades in and out at the very start and end.
 *
 * Works in frames at the source rate. Feed it the decoded audio in order;
 * it returns output as soon as nothing still to come can land on it.
 */
import type { Span } from './ranges';

export interface SpliceOptions {
  spans: readonly Span[];
  /** Frames per second of the audio fed in. */
  rate: number;
  channels: number;
  /** Seconds of source available: the crossfades don't reach past it. */
  duration: number;
  /** Total crossfade at each join, seconds (half either side). */
  crossfade?: number;
  fadeIn?: number;
  fadeOut?: number;
}

interface Piece {
  /** Source frames the span reads, crossfade margins included: [from, to). */
  from: number;
  to: number;
  /** Source frame of the span's own start, and where that lands in the output. */
  start: number;
  at: number;
  /** Frames of crossfade either side of its start and end (0 at the ends). */
  inHalf: number;
  outHalf: number;
  /** The span's own length, frames. */
  length: number;
}

export class Splicer {
  /** Output frames in all. */
  readonly length: number;
  private readonly pieces: Piece[];
  private readonly channels: number;
  private readonly rate: number;
  private readonly fadeIn: number;
  private readonly fadeOut: number;
  /** Output held back, starting at output frame `base`. */
  private buffer: Float32Array[];
  private base = 0;
  /** Output frames already handed out. */
  private done = 0;

  constructor(options: SpliceOptions) {
    const { rate, channels } = options;
    const total = Math.round(options.duration * rate);
    const half = Math.round(((options.crossfade ?? 0.01) / 2) * rate);
    const spans = options.spans.map((s) => ({
      start: Math.round(s.start * rate),
      end: Math.round(s.end * rate),
    }));
    this.pieces = [];
    let at = 0;
    spans.forEach((s) => {
      const length = s.end - s.start;
      this.pieces.push({ from: 0, to: 0, start: s.start, at, inHalf: 0, outHalf: 0, length });
      at += length;
    });
    // Each join's half-width: no longer than half of either span, nor than
    // the source there is beyond the edges.
    for (let i = 1; i < this.pieces.length; i += 1) {
      const a = this.pieces[i - 1];
      const b = this.pieces[i];
      if (!a || !b) continue;
      const h = Math.max(
        0,
        Math.min(
          half,
          Math.floor(a.length / 2),
          Math.floor(b.length / 2),
          total - (a.start + a.length),
          b.start,
        ),
      );
      a.outHalf = h;
      b.inHalf = h;
    }
    for (const p of this.pieces) {
      p.from = p.start - p.inHalf;
      p.to = p.start + p.length + p.outHalf;
    }
    this.length = at;
    this.channels = channels;
    this.rate = rate;
    this.fadeIn = Math.round((options.fadeIn ?? 0) * rate);
    this.fadeOut = Math.round((options.fadeOut ?? 0) * rate);
    this.buffer = Array.from({ length: channels }, () => new Float32Array(0));
  }

  /** The gain of piece `p` at output frame `u`: crossfades, then the fades at the ends. */
  private gain(p: Piece, u: number): number {
    let g = 1;
    if (p.inHalf > 0) g *= Math.min(1, Math.max(0, (u - (p.at - p.inHalf) + 0.5) / (2 * p.inHalf)));
    const joinOut = p.at + p.length;
    if (p.outHalf > 0) {
      g *= Math.min(1, Math.max(0, (joinOut + p.outHalf - u - 0.5) / (2 * p.outHalf)));
    }
    if (this.fadeIn > 0 && u < this.fadeIn) g *= (u + 0.5) / this.fadeIn;
    if (this.fadeOut > 0 && u >= this.length - this.fadeOut) {
      g *= (this.length - u - 0.5) / this.fadeOut;
    }
    return g;
  }

  /** Output frames [from, to) where piece `p` plays at full gain, alone. */
  private flat(p: Piece): { from: number; to: number } {
    return {
      from: Math.max(p.at + p.inHalf, this.fadeIn),
      to: Math.min(p.at + p.length - p.outHalf, this.length - this.fadeOut),
    };
  }

  /** Makes room in the held-back output up to output frame `end`. */
  private reserve(end: number) {
    const need = end - this.base;
    const have = this.buffer[0]?.length ?? 0;
    if (need <= have) return;
    const size = Math.max(need, have * 2, 4096);
    this.buffer = this.buffer.map((old) => {
      const grown = new Float32Array(size);
      grown.set(old);
      return grown;
    });
  }

  /**
   * The stretches of source to decode, seconds, in order: each span with its
   * crossfade margins, stretches that touch or overlap merged. Feed each
   * source frame once.
   */
  get windows(): Span[] {
    const out: Span[] = [];
    for (const p of this.pieces) {
      const last = out.at(-1);
      if (last && p.from <= last.end) last.end = Math.max(last.end, p.to);
      else out.push({ start: p.from, end: p.to });
    }
    return out.map((w) => ({ start: w.start / this.rate, end: w.end / this.rate }));
  }

  /**
   * Adds decoded audio: `planes` (one per channel), its first frame at source
   * frame `first`. Returns the output now final, or null when nothing is yet.
   */
  push(
    planes: readonly Float32Array[],
    first: number,
  ): { planes: Float32Array[]; at: number } | null {
    const frames = planes[0]?.length ?? 0;
    const last = first + frames;
    for (const p of this.pieces) {
      const from = Math.max(first, p.from);
      const to = Math.min(last, p.to);
      if (to <= from) continue;
      const shift = p.at - p.start;
      this.reserve(to + shift);
      // Full gain in the middle, where only this piece plays: a straight copy.
      const flatFrom = Math.max(from, Math.min(to, this.flat(p).from - shift));
      const flatTo = Math.max(flatFrom, Math.min(to, this.flat(p).to - shift));
      for (let c = 0; c < this.channels; c += 1) {
        const src = planes[c] ?? planes[0];
        const dst = this.buffer[c];
        if (!src || !dst) continue;
        const o = shift - this.base;
        for (let f = from; f < flatFrom; f += 1) {
          dst[f + o] = (dst[f + o] ?? 0) + (src[f - first] ?? 0) * this.gain(p, f + shift);
        }
        dst.set(src.subarray(flatFrom - first, flatTo - first), flatFrom + o);
        for (let f = flatTo; f < to; f += 1) {
          dst[f + o] = (dst[f + o] ?? 0) + (src[f - first] ?? 0) * this.gain(p, f + shift);
        }
      }
    }
    // Final up to where the earliest piece still to come would land.
    let safe = this.length;
    for (const p of this.pieces) {
      if (p.to > last) safe = Math.min(safe, p.at + (Math.max(last, p.from) - p.start));
    }
    return this.emit(Math.max(this.done, safe));
  }

  /** The rest of the output, once all the audio is in (silence where none came). */
  finish(): { planes: Float32Array[]; at: number } | null {
    return this.emit(this.length);
  }

  private emit(until: number): { planes: Float32Array[]; at: number } | null {
    const end = Math.min(this.length, until);
    if (end <= this.done) return null;
    this.reserve(end);
    const at = this.done;
    const planes = this.buffer.map((b) => b.slice(at - this.base, end - this.base));
    // Drop what was handed out.
    this.buffer = this.buffer.map((b) => b.slice(end - this.base));
    this.base = end;
    this.done = end;
    return { planes, at };
  }
}
