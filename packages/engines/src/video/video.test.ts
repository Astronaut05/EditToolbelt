import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AudioSample, Mp4OutputFormat } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { planCompress, sizeForShortSide } from './compress';
import { continuousAudio, extractAudioEngine } from './extract-audio';
import { adtsHeader, readAacConfig } from './adts';
import { convert, openInput, probeMedia } from './media';
import { checkRange, keyframeBefore, trimEngine } from './trim';

// Copy-only paths run in Node: no decoder or encoder is needed to move packets.

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

describe('probe', () => {
  it('reads the MP4 fixture', async () => {
    const info = await probeMedia(fixture('clip-h264-aac.mp4'));
    expect(info.durationSec).toBeCloseTo(30, 1);
    expect(info.video).toMatchObject({ codec: 'avc', width: 256, height: 144, fps: 30 });
    expect(info.video?.variableFrameRate).toBe(false);
    expect(info.audio).toEqual([
      expect.objectContaining({ codec: 'aac', channels: 2, sampleRate: 48000 }),
    ]);
  });

  it('refuses what is not a video', async () => {
    await expect(probeMedia(new Blob(['not a video at all']))).rejects.toThrow(
      /isn’t a video this tool can read/,
    );
  });
});

describe('trim, fast', () => {
  it('starts at the keyframe before the In point', async () => {
    const input = openInput(fixture('clip-h264-aac.mp4'));
    // Keyframes every 2 s.
    expect(await keyframeBefore(input, 10.5)).toBeCloseTo(10, 3);
    expect(await keyframeBefore(input, 12)).toBeCloseTo(12, 3);
    input.dispose();
  });

  it('copies 10.5–20.5 s from the keyframe at 10 s, with a note saying so', async () => {
    const out = await trimEngine.run(
      fixture('clip-h264-aac.mp4'),
      { start: 10.5, end: 20.5 },
      ctx(),
    );
    expect(out.ext).toBe('mp4');
    expect(out.durationSec).toBeCloseTo(10.5, 3);
    expect(out.notes?.[0]).toMatch(/keyframe at 10\.0 s, 0\.50 s before your In point/);
    const info = await probeMedia(out.blob);
    expect(info.durationSec).toBeGreaterThan(10.45);
    expect(info.durationSec).toBeLessThan(10.56);
    expect(info.video?.codec).toBe('avc');
    expect(info.audio[0]?.codec).toBe('aac');
  });

  it('keeps WebM as WebM', async () => {
    const out = await trimEngine.run(fixture('clip-vp9-opus.webm'), { start: 4, end: 8 }, ctx());
    expect(out.ext).toBe('webm');
    const info = await probeMedia(out.blob);
    expect(info.durationSec).toBeCloseTo(4, 1);
  });

  it('refuses an empty range', () => {
    expect(() => checkRange(5, 5, 30)).toThrow(/empty/);
    expect(checkRange(-1, 99, 30)).toEqual([0, 30]);
  });
});

describe('extract audio, copy', () => {
  it('copies AAC from an MP4 into M4A without re-encoding', async () => {
    const out = await extractAudioEngine.run(
      fixture('clip-h264-aac.mp4'),
      { format: 'm4a' },
      ctx(),
    );
    expect(out.ext).toBe('m4a');
    expect(out.notes?.[0]).toBe('Copied without re-encoding: the AAC audio is unchanged');
    const info = await probeMedia(out.blob);
    expect(info.video).toBeNull();
    expect(info.audio[0]?.codec).toBe('aac');
    // tools/video.md → V06: duration within 10 ms.
    expect(Math.abs(info.durationSec - 30)).toBeLessThan(0.03);
  });

  it('copies AAC into a raw .aac file, and Opus into OGG', async () => {
    const aac = await extractAudioEngine.run(
      fixture('clip-h264-aac.mp4'),
      { format: 'aac' },
      ctx(),
    );
    expect(aac.ext).toBe('aac');
    expect((await probeMedia(aac.blob)).audio[0]?.codec).toBe('aac');
    const ogg = await extractAudioEngine.run(
      fixture('clip-vp9-opus.webm'),
      { format: 'ogg' },
      ctx(),
    );
    expect(ogg.ext).toBe('ogg');
    expect(ogg.notes?.[0]).toMatch(/Copied without re-encoding: the Opus audio/);
  });

  it('says when there is no audio to extract', async () => {
    const input = openInput(fixture('clip-h264-aac.mp4'));
    const silent = await convert(
      {
        input,
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        audio: { discard: true },
      },
      new AbortController().signal,
      () => undefined,
    );
    await expect(
      extractAudioEngine.run(new Blob([silent.bytes]), { format: 'mp3' }, ctx()),
    ).rejects.toThrow('This video has no audio track, so there is nothing to extract.');
  });
});

describe('ADTS', () => {
  it('reads an AAC-LC config and writes a header per frame', () => {
    // AAC-LC, 48 kHz (index 3), stereo.
    const config = readAacConfig(Uint8Array.from([0x11, 0x90]));
    expect(config).toEqual({ objectType: 2, frequencyIndex: 3, channelConfig: 2 });
    if (!config) return;
    const header = adtsHeader(config, 100);
    expect(Array.from(header.slice(0, 2))).toEqual([0xff, 0xf1]);
    // 13-bit frame length includes the 7-byte header.
    const length =
      (((header[3] ?? 0) & 3) << 11) | ((header[4] ?? 0) << 3) | ((header[5] ?? 0) >> 5);
    expect(length).toBe(107);
    expect(readAacConfig(Uint8Array.from([0xf8, 0x00]))).toBeNull();
  });
});

describe('compress plan', () => {
  const hd = { durationSec: 120, width: 1920, height: 1080, fps: 30, audioBps: 128_000 };

  it('works out the bitrate for a target and steps the size down when it gets thin', () => {
    const plan = planCompress(hd, { mode: 'target', target: '25' }, 'avc');
    // (25 MB × 0.97 × 8 ÷ 120 s) − 128 kbps
    expect(plan.videoBps).toBeCloseTo(1_488_667, -2);
    expect([plan.width, plan.height]).toEqual([1280, 720]);
    expect(plan.notes[0]).toMatch(/Scaled down to 1280 × 720 px, so 25 MB still looks clean/);
    // H.265 needs fewer bits, so it keeps 1080p a step longer.
    expect(planCompress(hd, { mode: 'target', target: '50' }, 'hevc').height).toBe(1080);
  });

  it('keeps portrait videos portrait and sizes even', () => {
    const phone = { ...hd, width: 1080, height: 1920 };
    const plan = planCompress(phone, { mode: 'target', target: '10' }, 'avc');
    expect(plan.width).toBeLessThan(plan.height);
    expect((plan.width % 2) + (plan.height % 2)).toBe(0);
    expect(sizeForShortSide(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
  });

  it('refuses a target the audio alone overflows', () => {
    expect(() =>
      planCompress({ ...hd, durationSec: 600 }, { mode: 'target', target: '8' }, 'avc'),
    ).toThrow(/the sound alone takes 9\.6 MB/);
  });

  it('maps quality levels and fixed resolutions', () => {
    const plan = planCompress(
      hd,
      { mode: 'quality', quality: 'small', resolution: '720', fps: '24' },
      'avc',
    );
    expect(plan).toMatchObject({ level: 'low', width: 1280, height: 720, fps: 24 });
    // Never upscales, never raises the frame rate.
    expect(
      planCompress(hd, { mode: 'quality', resolution: '2160', fps: '60' }, 'avc'),
    ).toMatchObject({
      width: 1920,
      height: 1080,
      fps: undefined,
    });
  });
});

describe('continuous audio', () => {
  const block = (timestamp: number, frames: number) =>
    new AudioSample({
      data: new Float32Array(frames).map((_, i) => i / frames),
      format: 'f32-planar',
      numberOfChannels: 1,
      sampleRate: 1000,
      timestamp,
    });

  it('trims blocks that overlap the one before, and drops those inside it', () => {
    const keep = continuousAudio();
    expect(keep(block(0, 1000))?.numberOfFrames).toBe(1000);
    // Starts 200 ms before the first one ended: the first 200 frames go.
    const second = keep(block(0.8, 1000));
    expect(second?.numberOfFrames).toBe(800);
    expect(second?.timestamp).toBeCloseTo(1, 6);
    expect(keep(block(1.2, 300))).toBeNull();
    expect(keep(block(1.8, 100))?.numberOfFrames).toBe(100);
  });
});
