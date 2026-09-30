import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EncodedPacketSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { openInput, probeMedia } from './media';
import { muteGain, muteVideoEngine, silence } from './mute';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** Every video packet's bytes, in decode order. */
async function videoPackets(file: Blob): Promise<string[]> {
  const input = openInput(file);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video');
  const out: string[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) {
    out.push(Buffer.from(packet.data).toString('base64'));
  }
  input.dispose();
  return out;
}

describe('Mute Video', () => {
  it('removes the audio and keeps the video stream byte for byte (MP4)', async () => {
    const source = fixture('clip-h264-aac.mp4');
    const out = await muteVideoEngine.run(source, { mode: 'all' }, ctx());
    expect(out.ext).toBe('mp4');
    const info = await probeMedia(out.blob);
    expect(info.audio).toEqual([]);
    expect(info.durationSec).toBeCloseTo(30, 1);
    expect(await videoPackets(out.blob)).toEqual(await videoPackets(source));
    expect(out.notes?.[0]).toMatch(/^Audio removed \(one track\)/);
  });

  it('keeps WebM as WebM', async () => {
    const out = await muteVideoEngine.run(fixture('clip-vp9-opus.webm'), {}, ctx());
    expect(out.ext).toBe('webm');
    expect((await probeMedia(out.blob)).audio).toEqual([]);
  });
});

describe('muting a range', () => {
  it('is silent inside, untouched outside, with 10 ms ramps', () => {
    expect(muteGain(0.5, 1, 2)).toBe(1);
    expect(muteGain(1.5, 1, 2)).toBe(0);
    expect(muteGain(1.005, 1, 2)).toBeCloseTo(0.5, 5);
    expect(muteGain(1.995, 1, 2)).toBeCloseTo(0.5, 5);
    expect(muteGain(2.5, 1, 2)).toBe(1);
  });

  it('silences the samples of a buffer that overlaps the range', () => {
    const rate = 1000;
    const plane = new Float32Array(3000).fill(0.8);
    expect(silence([plane], 0, rate, 1, 2)).toBe(true);
    expect(plane[500]).toBeCloseTo(0.8, 6);
    expect(plane[1500]).toBe(0);
    expect(plane[2500]).toBeCloseTo(0.8, 6);
    // A buffer outside the range is left alone.
    expect(silence([new Float32Array(100)], 5, rate, 1, 2)).toBe(false);
  });
});
