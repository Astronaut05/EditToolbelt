import { AudioSample } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { planesOf } from './stream';

/** An interleaved f32 block, like a decoder gives: channel c, frame i holds c * 1000 + i. */
function block(frames: number, channels: number): AudioSample {
  const data = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) data[i * channels + c] = c * 1000 + i;
  }
  return new AudioSample({
    data,
    format: 'f32',
    numberOfChannels: channels,
    sampleRate: 48_000,
    timestamp: 0,
  });
}

describe('planesOf', () => {
  it('gives frames from–to of each channel, from partway into the block', () => {
    const sample = block(960, 2);
    const planes = planesOf(sample, 2, 624, 960);
    expect(planes).toHaveLength(2);
    expect(planes[0]).toHaveLength(336);
    expect(planes[0]?.[0]).toBe(624);
    expect(planes[0]?.[335]).toBe(959);
    expect(planes[1]?.[0]).toBe(1624);
    sample.close();
  });

  it('gives the whole block by default', () => {
    const sample = block(960, 2);
    const [left] = planesOf(sample, 2);
    expect(left).toHaveLength(960);
    expect(left?.[959]).toBe(959);
    sample.close();
  });

  it('puts mono on both sides and keeps the front two of more', () => {
    const mono = block(100, 1);
    const both = planesOf(mono, 2, 10, 20);
    expect(both.map((p) => p[0])).toEqual([10, 10]);
    mono.close();
    const surround = block(100, 6);
    const front = planesOf(surround, 2, 0, 5);
    expect(front.map((p) => p[4])).toEqual([4, 1004]);
    surround.close();
  });
});
