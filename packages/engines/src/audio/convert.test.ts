import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { toneWav } from './tone';
import { audioConverterEngine } from './convert';

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** Sample rate, duration and the tone's frequency from zero crossings. */
async function analyse(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('no audio');
  const rate = await track.getSampleRate();
  const channels = await track.getNumberOfChannels();
  const duration = await input.computeDuration();
  let crossings = 0;
  let previous = 0;
  let frames = 0;
  for await (const sample of new AudioSampleSink(track).samples()) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    for (const v of plane) {
      if (previous < 0 && v >= 0) crossings += 1;
      previous = v;
    }
    frames += sample.numberOfFrames;
    sample.close();
  }
  input.dispose();
  return { rate, channels, duration, frames, hz: crossings / (frames / rate) };
}

describe('Audio Converter', () => {
  it('WAV 44.1 → 48 kHz keeps the length and the pitch', async () => {
    const source = toneWav(3, 44_100, 440);
    const out = await audioConverterEngine.run(
      source,
      { format: 'wav', sampleRate: '48000' },
      ctx(),
    );
    expect(out.ext).toBe('wav');
    const info = await analyse(out.blob);
    expect(info.rate).toBe(48_000);
    expect(Math.abs(info.duration - 3)).toBeLessThan(0.001);
    expect(Math.abs(info.hz - 440)).toBeLessThan(1);
    expect(out.notes).toContain('Sample rate changed from 44.1 kHz to 48 kHz');
  });

  it('writes 24-bit WAV and mixes to stereo', async () => {
    const out = await audioConverterEngine.run(
      toneWav(1, 48_000, 1000),
      { format: 'wav', bitDepth: '24', channels: '2' },
      ctx(),
    );
    const bytes = new DataView(await out.blob.arrayBuffer());
    expect(bytes.getUint16(22, true)).toBe(2); // channels
    expect(bytes.getUint16(34, true)).toBe(24); // bits per sample
    expect(out.notes?.[0]).toBe('Encoded as PCM 24-bit, 48 kHz, stereo');
  });

  it('copies a WAV that is already what was asked for', async () => {
    const out = await audioConverterEngine.run(toneWav(1, 48_000, 440), { format: 'wav' }, ctx());
    expect(out.path).toBe('Browser · stream copy');
  });
});
