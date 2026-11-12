import { AudioSample } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { Frames, planesOf } from './stream';

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

/** A source of 100-frame blocks that records whether it was ended from outside. */
function source(blocks: number) {
  const seen = { returned: false, pulled: 0 };
  async function* make(): AsyncGenerator<Float32Array[]> {
    try {
      for (let i = 0; i < blocks; i += 1) {
        await Promise.resolve();
        seen.pulled += 1;
        yield [new Float32Array(100).fill(1)];
      }
    } finally {
      seen.returned = true;
    }
  }
  return { seen, frames: new Frames(make(), 1) };
}

describe('Frames.close', () => {
  it('ends a source that take() left partway, so its decoder stops', async () => {
    const { seen, frames } = source(50);
    await frames.take(150);
    expect(seen.pulled).toBe(2);
    expect(seen.returned).toBe(false);
    await frames.close();
    expect(seen.returned).toBe(true);
    // Nothing more is pulled: what follows is silence.
    expect([...((await frames.take(10))[0] ?? [])]).toEqual(Array.from({ length: 10 }, () => 0));
    expect(seen.pulled).toBe(2);
  });

  it('is safe twice, after the source ended, and with no source', async () => {
    const { seen, frames } = source(1);
    await frames.take(500);
    expect(seen.returned).toBe(true);
    await frames.close();
    await frames.close();
    await new Frames(null, 2).close();
  });

  it('swallows an error the source throws while ending', async () => {
    async function* failing(): AsyncGenerator<Float32Array[]> {
      try {
        await Promise.resolve();
        yield [new Float32Array(4)];
        yield [new Float32Array(4)];
      } finally {
        // eslint-disable-next-line no-unsafe-finally -- the case under test: a decoder that fails as it closes
        throw new Error('decoder failed while closing');
      }
    }
    const frames = new Frames(failing(), 1);
    await frames.take(2);
    await expect(frames.close()).resolves.toBeUndefined();
  });
});
