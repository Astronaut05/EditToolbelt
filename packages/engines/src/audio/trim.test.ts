import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { toneWav } from './tone';
import { probeAudio } from './probe';
import { audioPeaks, fadeGain, trimAudioEngine } from './trim';

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

  it('removes a range and joins the two sides', async () => {
    const out = await trimAudioEngine.run(
      toneWav(20, 48_000, 440),
      { mode: 'remove', start: 5, end: 15 },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(Math.abs(data.length / rate - 10)).toBeLessThanOrEqual(0.001);
    // Silent right at the join, full level 10 ms either side of it.
    const at = (t: number) => Math.abs(data[Math.round(t * rate)] ?? 1);
    expect(at(5)).toBeLessThan(0.01);
    const peak = (from: number, to: number) =>
      Math.max(...Array.from(data.subarray(from * rate, to * rate), Math.abs));
    expect(peak(4.98, 4.99)).toBeGreaterThan(0.3);
    expect(peak(5.01, 5.02)).toBeGreaterThan(0.3);
    expect(out.notes?.[0]).toBe('Removed 5.000 s – 15.000 s; 10.000 s left');
  });

  it('cuts the start off without a join', async () => {
    const out = await trimAudioEngine.run(
      toneWav(4, 8_000, 200),
      { mode: 'remove', start: 0, end: 1 },
      ctx(),
    );
    const { rate, data } = await samples(out.blob);
    expect(Math.abs(data.length / rate - 3)).toBeLessThanOrEqual(0.001);
    expect(out.notes).not.toContain('A 5 ms fade either side of the join, so it doesn’t click');
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

  it('ramps the gain', () => {
    expect(fadeGain(0, 10, 1, 1)).toBe(0);
    expect(fadeGain(0.5, 10, 1, 1)).toBe(0.5);
    expect(fadeGain(5, 10, 1, 1)).toBe(1);
    expect(fadeGain(9.75, 10, 1, 1)).toBeCloseTo(0.25, 6);
    expect(fadeGain(5, 10, 0, 0)).toBe(1);
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
