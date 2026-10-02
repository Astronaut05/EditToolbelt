import { ALL_FORMATS, AudioSample, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { CleanedReader, cleanedBlock, previewSnippet, probeNoise } from './noise';

/**
 * A 16-bit mono WAV: one second of "speech" (a 200 Hz tone switching on and
 * off every 0.3 s) over a hiss whose level steps from `floors[i]` dB each second.
 */
function speechWav(floors: readonly number[], rate = 16_000): Blob {
  const frames = floors.length * rate;
  const data = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) data.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  data.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, frames * 2, true);
  let seed = 1;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647 - 0.5;
  };
  for (let i = 0; i < frames; i += 1) {
    const second = Math.floor(i / rate);
    const hiss = 10 ** ((floors[second] ?? -60) / 20) * random() * 3.4;
    const talking = Math.floor(i / (0.3 * rate)) % 2 === 0;
    const voice = talking ? 0.2 * Math.sin((2 * Math.PI * 200 * i) / rate) : 0;
    data.setInt16(44 + i * 2, Math.round((voice + hiss) * 32_000), true);
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

async function decoded(blob: Blob): Promise<{ rate: number; data: Float32Array }> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('no audio');
  const parts: Float32Array[] = [];
  for await (const sample of new AudioSampleSink(track).samples()) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    parts.push(plane);
    sample.close();
  }
  const rate = await track.getSampleRate();
  input.dispose();
  const data = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    data.set(part, at);
    at += part.length;
  }
  return { rate, data };
}

describe('probeNoise', () => {
  it('reads a WAV our servers take as it is, and starts the preview where the hiss is loudest', async () => {
    const floors = [...Array<number>(20).fill(-60), ...Array<number>(12).fill(-30), -60, -60];
    const file = speechWav(floors);
    const info = await probeNoise(file);
    expect(info).toMatchObject({
      video: false,
      serverType: { ext: 'wav', mime: 'audio/wav' },
      sampleRate: 16_000,
      channels: 1,
      canDecode: true,
      sendBytes: file.size,
    });
    expect(info.durationSec).toBeCloseTo(34, 3);
    // A second or two of the quieter part may lead in.
    expect(info.previewFrom).toBeGreaterThanOrEqual(17);
    expect(info.previewFrom + 10).toBeLessThanOrEqual(33);
    expect(info.summary).toBe('PCM-S16 · 16 kHz · mono · 0:34');
  });

  it('starts a short file’s preview at 0', async () => {
    expect((await probeNoise(speechWav([-40, -40, -40]))).previewFrom).toBe(0);
  });
});

describe('previewSnippet', () => {
  it('cuts 10 s from the start asked for, as 16-bit WAV, sample for sample', async () => {
    const file = speechWav(Array<number>(30).fill(-40));
    const { wav, from } = await previewSnippet(file, 12, new AbortController().signal);
    expect(from).toBe(12);
    expect(wav.type).toBe('audio/wav');
    const snippet = await decoded(wav);
    const whole = await decoded(file);
    expect(snippet.data.length).toBe(10 * 16_000);
    expect(snippet.data.subarray(0, 4000)).toEqual(
      whole.data.subarray(12 * 16_000, 12 * 16_000 + 4000),
    );
  });

  it('moves the start back so the snippet still lasts 10 s near the end', async () => {
    const file = speechWav(Array<number>(14).fill(-40));
    const { from } = await previewSnippet(file, 11, new AbortController().signal);
    expect(from).toBe(4);
  });
});

/** Blocks of a ramp (frame n has the value n / 1e6) on two channels, `sizes` frames each. */
async function* ramp(sizes: readonly number[]): AsyncGenerator<AudioSample> {
  let at = 0;
  for (const size of sizes) {
    const data = new Float32Array(size * 2);
    for (let i = 0; i < size; i += 1) {
      data[i] = (at + i) / 1e6;
      data[size + i] = -(at + i) / 1e6;
    }
    // As a decoder would: one block at a time, asynchronously.
    await Promise.resolve();
    yield new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: 48_000,
      timestamp: at / 48_000,
    });
    at += size;
  }
}

describe('CleanedReader', () => {
  it('serves any span across block edges, in order, then says when the sound has ended', async () => {
    const reader = new CleanedReader(ramp([1000, 700, 1300, 1000]));
    const first = await reader.read(0, 1024, 2);
    expect(first?.[0]?.[1023]).toBeCloseTo(1023 / 1e6, 9);
    const across = await reader.read(1600, 300, 2);
    expect(across?.[0]?.[0]).toBeCloseTo(1600 / 1e6, 9);
    expect(across?.[0]?.[299]).toBeCloseTo(1899 / 1e6, 9);
    expect(across?.[1]?.[299]).toBeCloseTo(-1899 / 1e6, 9);
    // A block that overlaps the last one a little.
    expect((await reader.read(1890, 20, 2))?.[0]?.[0]).toBeCloseTo(1890 / 1e6, 9);
    // The cleaned sound ends at frame 4000: the last request gets what there is.
    expect((await reader.read(3990, 20, 2))?.[0]).toHaveLength(10);
    expect(await reader.read(4000, 20, 2)).toBeNull();
  });

  it('holds only a second or so behind the reads', async () => {
    const reader = new CleanedReader(ramp(Array<number>(400).fill(1024)));
    for (let at = 0; at + 1024 <= 400 * 1024; at += 1024) await reader.read(at, 1024, 2);
    expect(await reader.read(0, 10, 2)).toBeNull();
    expect((await reader.read(400 * 1024 - 40_000, 10, 2))?.[0]?.[0]).toBeCloseTo(
      (400 * 1024 - 40_000) / 1e6,
      6,
    );
  });

  it('copies a mono block to both channels of a stereo request', async () => {
    async function* mono(): AsyncGenerator<AudioSample> {
      await Promise.resolve();
      yield new AudioSample({
        data: new Float32Array([0.1, 0.2, 0.3]),
        format: 'f32-planar',
        numberOfChannels: 1,
        sampleRate: 8000,
        timestamp: 0,
      });
    }
    const planes = await new CleanedReader(mono()).read(0, 3, 2);
    expect(Array.from(planes?.[1] ?? [])).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
  });
});

describe('cleanedBlock', () => {
  const reader = (end: number) => ({
    read: (from: number, count: number) => {
      const n = Math.min(count, end - from);
      return Promise.resolve(n > 0 ? [new Float32Array(n).fill(1)] : null);
    },
  });

  it('replaces a block frame for frame', async () => {
    const block = await cleanedBlock([new Float32Array(4)], 10, reader(100));
    expect(Array.from(block.planes[0] ?? [])).toEqual([1, 1, 1, 1]);
    expect(block.replaced).toBe(4);
  });

  it('keeps frames before 0 and past the cleaned sound’s end as they were', async () => {
    const start = await cleanedBlock([new Float32Array(4)], -2, reader(100));
    expect(Array.from(start.planes[0] ?? [])).toEqual([0, 0, 1, 1]);
    expect(start.replaced).toBe(2);
    const end = await cleanedBlock([new Float32Array(4)], 98, reader(100));
    expect(Array.from(end.planes[0] ?? [])).toEqual([1, 1, 0, 0]);
    const past = await cleanedBlock([new Float32Array(4)], 100, reader(100));
    expect(past.replaced).toBe(0);
    expect((await cleanedBlock([new Float32Array(4)], -9, reader(100))).replaced).toBe(0);
  });
});
