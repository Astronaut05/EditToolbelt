/**
 * Audio read as a stream of planar blocks at one rate and channel count,
 * for laying several sources on one timeline (V14 Add or Replace Audio, A04
 * Merge Audio). Each source is decoded, resampled by @etb/core's Resampler
 * and cut to exactly the frames it should fill, so the timeline adds up.
 */
import { Resampler } from '@etb/core';
import { AudioSampleSink, type AudioSample, type InputAudioTrack } from 'mediabunny';

import { EngineAbortError } from '../dummy';

/** A stretch of a source: its seconds `from`–`to`, starting at second `at` of the stream. */
export interface SourcePart {
  from: number;
  to: number;
  at: number;
}

/**
 * A decoded block's frames `from`–`to` as planar floats, `channels` wide:
 * mono goes to both sides; past stereo, the front two.
 */
export function planesOf(
  sample: AudioSample,
  channels: number,
  from = 0,
  to = sample.numberOfFrames,
): Float32Array[] {
  const count = to - from;
  const read = (planeIndex: number) => {
    const plane = new Float32Array(count);
    sample.copyTo(plane, {
      planeIndex,
      format: 'f32-planar',
      frameOffset: from,
      frameCount: count,
    });
    return plane;
  };
  const own = Math.min(sample.numberOfChannels, channels);
  const planes = Array.from({ length: own }, (_, c) => read(c));
  while (planes.length < channels) {
    planes.push(Float32Array.from(planes[0] ?? new Float32Array(count)));
  }
  return planes;
}

/**
 * A track's `parts` at `rate`, end to end, each exactly as many frames as
 * its length at that rate (a decoder that stops short is filled with
 * silence, one that runs over is cut).
 */
export async function* framesOf(
  track: InputAudioTrack,
  parts: SourcePart[],
  rate: number,
  channels: number,
  signal: AbortSignal,
): AsyncGenerator<Float32Array[]> {
  const own = await track.getSampleRate();
  for (const part of parts) {
    const want = Math.round((part.at + part.to - part.from) * rate) - Math.round(part.at * rate);
    let given = 0;
    const resampler = new Resampler(own, rate, channels);
    const cut = (planes: Float32Array[]) => {
      const n = Math.min(planes[0]?.length ?? 0, want - given);
      given += n;
      return planes.map((plane) => plane.subarray(0, n));
    };
    for await (const decoded of new AudioSampleSink(track).samples(part.from, part.to)) {
      if (signal.aborted) {
        decoded.close();
        throw new EngineAbortError();
      }
      const sr = decoded.sampleRate;
      const from = Math.max(0, Math.round((part.from - decoded.timestamp) * sr));
      const to = Math.min(decoded.numberOfFrames, Math.round((part.to - decoded.timestamp) * sr));
      if (to > from) {
        const planes = planesOf(decoded, channels, from, to);
        decoded.close();
        yield cut(resampler.push(planes));
      } else {
        decoded.close();
      }
    }
    yield cut(resampler.flush());
    if (given < want) yield Array.from({ length: channels }, () => new Float32Array(want - given));
  }
}

/** Takes frames from a stream in any sizes; silence once it has ended. */
export class Frames {
  private block: Float32Array[] | null = null;
  private used = 0;
  private source: AsyncGenerator<Float32Array[]> | null;
  private readonly channels: number;

  constructor(source: AsyncGenerator<Float32Array[]> | null, channels: number) {
    this.source = source;
    this.channels = channels;
  }

  async take(n: number): Promise<Float32Array[]> {
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    let filled = 0;
    while (filled < n) {
      const length = this.block?.[0]?.length ?? 0;
      if (!this.block || this.used >= length) {
        if (!this.source) break;
        const next = await this.source.next();
        if (next.done) {
          this.source = null;
          break;
        }
        this.block = next.value;
        this.used = 0;
        continue;
      }
      const k = Math.min(n - filled, length - this.used);
      for (let c = 0; c < this.channels; c += 1) {
        out[c]?.set(
          (this.block[c] ?? new Float32Array(length)).subarray(this.used, this.used + k),
          filled,
        );
      }
      filled += k;
      this.used += k;
    }
    return out;
  }
}
