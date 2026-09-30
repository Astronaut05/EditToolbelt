import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { toneWav } from './tone';
import { probeAudio } from './probe';
import { audioPeaks, trimAudioEngine } from './trim';

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** Every sample of a WAV's first channel. */
async function samples(blob: Blob): Promise<{ rate: number; data: Float32Array }> {
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

describe('Trim Audio', () => {
  it('trims a WAV 5.000–15.000 to 10.000 s, to the sample', async () => {
    const out = await trimAudioEngine.run(toneWav(20, 48_000, 440), { start: 5, end: 15 }, ctx());
    expect(out.ext).toBe('wav');
    const { rate, data } = await samples(out.blob);
    expect(Math.abs(data.length / rate - 10)).toBeLessThanOrEqual(0.001);
    expect(out.notes?.[1]).toBe('PCM: cut to the sample, lossless');
  });

  it('fades in and out', async () => {
    const out = await trimAudioEngine.run(
      toneWav(4, 8_000, 200),
      { start: 1, end: 3, fadeIn: '500', fadeOut: '500' },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    const peak = (from: number, to: number) =>
      Math.max(...Array.from(data.subarray(from * rate, to * rate), Math.abs));
    expect(peak(0, 0.02)).toBeLessThan(0.02);
    expect(peak(0.9, 1.1)).toBeGreaterThan(0.3);
    expect(peak(1.98, 2)).toBeLessThan(0.02);
  });

  it('removes a range and crossfades the join, so it doesn’t click', async () => {
    // A 100 Hz tone cut at a peak and joined at a trough: a hard cut jumps by 0.73.
    const out = await trimAudioEngine.run(
      toneWav(20, 48_000, 100),
      { mode: 'remove', start: 5.0025, end: 15.0075 },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(data.length).toBe(Math.round(9.995 * rate));
    const join = Math.round(5.0025 * rate);
    let step = 0;
    for (let i = join - 480; i < join + 480; i += 1) {
      step = Math.max(step, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
    }
    // The tone's own biggest step is 0.0048; the crossfade stays near it.
    expect(step).toBeLessThan(0.01);
    expect(out.notes).toEqual([
      'Removed 5.003 s – 15.008 s; 9.995 s left',
      'PCM: cut to the sample, lossless',
      'A 10 ms crossfade at the join, so it doesn’t click',
    ]);
  });

  it('keeps several ranges and joins them, to the sample', async () => {
    const out = await trimAudioEngine.run(
      toneWav(20, 48_000, 440),
      {
        ranges: [
          { start: 12, end: 14.5 },
          { start: 1, end: 3.25 },
          { start: 6, end: 6.75 },
        ],
      },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(data.length).toBe(5.5 * rate);
    expect(out.durationSec).toBe(5.5);
    expect(out.notes?.[0]).toBe('Kept 3 parts, joined: 5.500 s');
    expect(out.notes?.[2]).toBe('A 10 ms crossfade at each of the 2 joins, so they don’t click');
  });

  it('removes several ranges', async () => {
    const out = await trimAudioEngine.run(
      toneWav(10, 8_000, 200),
      {
        mode: 'remove',
        ranges: [
          { start: 0, end: 1 },
          { start: 4, end: 5 },
          { start: 9.5, end: 10 },
        ],
      },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(data.length).toBe(7.5 * rate);
    expect(out.notes?.[0]).toBe('Removed 3 parts; 7.500 s left');
    // Only the middle join: the cuts at either end join nothing.
    expect(out.notes?.[2]).toBe('A 10 ms crossfade at the join, so it doesn’t click');
  });

  it('cuts the start off without a join', async () => {
    const out = await trimAudioEngine.run(
      toneWav(4, 8_000, 200),
      { mode: 'remove', start: 0, end: 1 },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(Math.abs(data.length / rate - 3)).toBeLessThanOrEqual(0.001);
    expect(out.notes?.some((note) => note.includes('crossfade'))).toBe(false);
  });

  it('refuses to remove everything', async () => {
    await expect(
      trimAudioEngine.run(toneWav(2, 8_000, 200), { mode: 'remove', start: 0, end: 2 }, ctx()),
    ).rejects.toThrow(/whole file/);
  });

  it('refuses fades longer than the kept part', async () => {
    await expect(
      trimAudioEngine.run(
        toneWav(4, 8_000, 200),
        { start: 1, end: 2, fadeIn: '800', fadeOut: '800' },
        ctx(),
      ),
    ).rejects.toThrow(/fades are longer/);
  });

  it('draws a waveform from the peaks', async () => {
    const peaks = await audioPeaks(toneWav(2, 8_000, 200), 20);
    expect(peaks).toHaveLength(20);
    expect(Math.min(...peaks)).toBeGreaterThan(0.3);
  });
});

describe('probeAudio', () => {
  it('reads the length, rate and channels', async () => {
    const info = await probeAudio(toneWav(62, 8_000, 200));
    expect(info.durationSec).toBeCloseTo(62, 3);
    expect(info.summary).toBe('PCM 16-bit · 8 kHz · mono · 1:02');
  });
});
