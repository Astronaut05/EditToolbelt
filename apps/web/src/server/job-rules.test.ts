import { gpuRateUsd } from '@etb/config/business';
import { getTool, priceOf } from '@etb/registry';
import { describe, expect, it } from 'vitest';

import { maskFits, MAX_PRORES_BYTES } from '../lib/gpu-limits';
import {
  extrasRefusal,
  frameCount,
  gpuRate,
  MAX_NOISE_WORK_BYTES,
  noiseWorkBytes,
  outputSize,
  priceInput,
  proresBytes,
  refusal,
} from './job-rules';

const photo = { video: { width: 1000, height: 750 }, duration_ms: 0 };

describe('Upscale Image prices and caps the result, not the input', () => {
  it('prices per output megapixel (docs/05 → CreditRule)', () => {
    const rule = getTool('upscale-image').cost;
    // tools/photo.md → P08: 1000 × 750 at 4× is 4000 × 3000, 12 MP: 3 credits at 1 per 4 MP.
    expect(outputSize('upscale-image', photo, { scale: '4' })).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(priceOf(rule, priceInput('upscale-image', photo, { scale: '4' }))).toBe(3);
    // 2×: 3 MP, under the minimum of 2.
    expect(priceOf(rule, priceInput('upscale-image', photo, { scale: '2' }))).toBe(2);
  });

  it('refuses a result over 64 MP before anything is charged', () => {
    const big = { video: { width: 3000, height: 2000 } };
    expect(refusal('upscale-image', big, { scale: '2' })).toBeNull();
    const refused = refusal('upscale-image', big, { scale: '4' });
    expect(refused).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(refused?.detail).toContain('12000 × 8000 px, 96 MP');
    expect(refusal('upscale-image', { video: null }, {})).toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });
});

describe('the other tools', () => {
  it('price by length, and keep the input size', () => {
    const clip = { duration_ms: 90_000, video: { width: 1920, height: 1080 } };
    expect(priceInput('vfr-to-cfr', clip, {})).toEqual({ durationMs: 90_000, megapixels: 2.0736 });
    expect(priceOf(getTool('transcribe-audio').cost, { durationMs: 90_000 })).toBe(3);
  });

  it('refuse a file with nothing to do: no sound to transcribe, a video already constant', () => {
    const silent = { duration_ms: 5000, audio: null };
    for (const id of ['transcribe-audio', 'auto-subtitles']) {
      expect(refusal(id, silent, {})).toMatchObject({ status: 422, code: 'NOTHING_TO_DO' });
      expect(refusal(id, { ...silent, audio: { codec: 'aac' } }, {})).toBeNull();
    }
    expect(refusal('vfr-to-cfr', { video: { vfr: false, fps: 30 } }, {})?.detail).toContain(
      '(30.00 fps)',
    );
    expect(refusal('vfr-to-cfr', { video: { vfr: true } }, {})).toBeNull();
    expect(refusal('compress-video', silent, {})).toBeNull();
  });
});

describe('Noise Reduction', () => {
  const sound = (ms: number, rate: number, channels: number) => ({
    duration_ms: ms,
    audio: { codec: 'flac', sample_rate: rate, channels },
  });

  it('takes 4 hours of mono and about 3 h 6 min of stereo at 48 kHz', () => {
    expect(refusal('remove-noise', sound(4 * 3_600_000, 48_000, 1), {})).toBeNull();
    expect(refusal('remove-noise', sound(186 * 60_000, 48_000, 2), {})).toBeNull();
    expect(refusal('remove-noise', sound(187 * 60_000, 48_000, 2), {})).toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
      detail: expect.stringContaining('up to 3 h 6 min at once; this file is 3 h 7 min') as string,
    });
  });

  it('counts the two raw copies on the worker’s disk, not the upload', () => {
    // An hour of 8 channels at 192 kHz is a few MB as FLAC of silence, 44 GB raw.
    const tiny = sound(3_600_000, 192_000, 8);
    expect(noiseWorkBytes(tiny)).toBeCloseTo(3600 * 192_000 * 8 * 4 * 2);
    expect(noiseWorkBytes(tiny)).toBeGreaterThan(5 * MAX_NOISE_WORK_BYTES);
    expect(refusal('remove-noise', tiny, {})?.detail).toContain('At 192 kHz with 8 channels');
  });

  it('refuses no sound and more than 8 channels before anything is charged', () => {
    expect(refusal('remove-noise', { duration_ms: 5000, audio: null }, {})).toMatchObject({
      code: 'NOTHING_TO_DO',
      title: 'Nothing to clean',
    });
    expect(refusal('remove-noise', sound(5000, 48_000, 12), {})).toMatchObject({
      status: 422,
      title: 'Too many channels',
    });
    expect(refusal('remove-noise', sound(5000, 48_000, 8), {})).toBeNull();
  });
});

describe('gpuRate', () => {
  it('writes the GPU function’s price a second on GPU jobs only', () => {
    expect(gpuRate(getTool('upscale-image'))).toBe(gpuRateUsd('T4').toFixed(8));
    expect(gpuRate(getTool('auto-subtitles'))).toBe(gpuRateUsd('L4').toFixed(8));
    expect(gpuRate(getTool('compress-video'))).toBeNull();
    expect(gpuRate(getTool('object-eraser'))).toBe(gpuRateUsd('T4').toFixed(8));
    expect(gpuRate(getTool('upscale-video'))).toBe(gpuRateUsd('L4').toFixed(8));
  });
});

const clip = (width: number, height: number, seconds: number, fps = 30, rotation = 0) => ({
  duration_ms: seconds * 1000,
  video: { width, height, fps, rotation },
  audio: { codec: 'aac' },
});

describe('Upscale Video', () => {
  it('prices by the minute and measures a phone clip upright', () => {
    expect(
      priceOf(getTool('upscale-video').cost, priceInput('upscale-video', clip(1280, 720, 90), {})),
    ).toBe(15);
    expect(outputSize('upscale-video', clip(1920, 1080, 5, 30, 270), { scale: '2' })).toEqual({
      width: 2160,
      height: 3840,
    });
  });

  it('makes up to 4K, either way round', () => {
    expect(refusal('upscale-video', clip(1920, 1080, 10), { scale: '2' })).toBeNull();
    expect(refusal('upscale-video', clip(960, 540, 10), { scale: '4' })).toBeNull();
    const refused = refusal('upscale-video', clip(1280, 720, 10), { scale: '4' });
    expect(refused).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(refused?.detail).toContain('5120 × 2880 px');
    expect(refusal('upscale-video', { duration_ms: 5000, video: null }, {})).toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('takes 18,000 frames: 10 minutes at 30 fps, 5 at 60', () => {
    expect(frameCount(clip(640, 360, 600))).toBe(18_000);
    expect(refusal('upscale-video', clip(640, 360, 600), { scale: '2' })).toBeNull();
    const fast = refusal('upscale-video', clip(640, 360, 360, 59.94), { scale: '2' });
    expect(fast).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE', title: 'Too long' });
    expect(fast?.detail).toBe(
      'This clip is 21,578 frames (6.0 min at 59.94 fps); Upscale Video takes up to 18,000, which is 5.0 min at this frame rate. Trim it first.',
    );
  });
});

describe('Video Background Remover', () => {
  it('refuses ProRes 4444 past one upload, but not WebM or green', () => {
    const twoMinutes = clip(1920, 1080, 120);
    expect(proresBytes(twoMinutes)).toBeGreaterThan(MAX_PRORES_BYTES);
    const refused = refusal('video-background-remover', twoMinutes, { output: 'prores' });
    expect(refused).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(refused?.detail).toContain('about 6.1 GB');
    expect(refused?.detail).toContain('about 1.5 min of this video');
    expect(refusal('video-background-remover', twoMinutes, { output: 'webm' })).toBeNull();
    expect(refusal('video-background-remover', twoMinutes, { output: 'green' })).toBeNull();
    expect(
      refusal('video-background-remover', clip(1920, 1080, 60), { output: 'prores' }),
    ).toBeNull();
  });

  it('takes up to 4K in', () => {
    expect(refusal('video-background-remover', clip(4096, 2160, 5), {})).toMatchObject({
      title: 'Too many pixels',
    });
  });
});

describe('Object Eraser', () => {
  const image = { video: { width: 4000, height: 3000 } };

  it('takes a mask of the image’s shape, at its size or scaled', () => {
    expect(maskFits(4000, 3000, 4000, 3000)).toBe(true);
    expect(maskFits(4619, 3464, 8000, 6000)).toBe(true);
    expect(maskFits(3000, 4000, 4000, 3000)).toBe(false);
    expect(
      extrasRefusal('object-eraser', image, [{ video: { width: 2000, height: 1500 } }]),
    ).toBeNull();
    // A JPEG's probe is its stored size; the page draws the mask on the photo upright.
    expect(
      extrasRefusal('object-eraser', image, [{ video: { width: 1500, height: 2000 } }]),
    ).toBeNull();
  });

  it('refuses a mask of another shape, or none, before anything is charged', () => {
    expect(
      extrasRefusal('object-eraser', image, [{ video: { width: 1000, height: 1000 } }]),
    ).toMatchObject({ status: 422, title: 'The mask doesn’t fit' });
    expect(extrasRefusal('object-eraser', image, [{ video: null }])).toMatchObject({
      title: 'Not a mask',
    });
    expect(extrasRefusal('burn-subtitles', image, [])).toBeNull();
  });

  it('is a flat 3 credits, whatever the size', () => {
    expect(priceOf(getTool('object-eraser').cost, priceInput('object-eraser', image, {}))).toBe(3);
    expect(refusal('object-eraser', { video: null }, {})).toMatchObject({ title: 'Not an image' });
  });
});
