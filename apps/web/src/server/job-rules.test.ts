import { gpuRateUsd } from '@etb/config/business';
import { getTool, priceOf } from '@etb/registry';
import { describe, expect, it } from 'vitest';

import { gpuRate, outputSize, priceInput, refusal } from './job-rules';

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

describe('gpuRate', () => {
  it('writes the GPU function’s price a second on GPU jobs only', () => {
    expect(gpuRate(getTool('upscale-image'))).toBe(gpuRateUsd('T4').toFixed(8));
    expect(gpuRate(getTool('auto-subtitles'))).toBe(gpuRateUsd('L4').toFixed(8));
    expect(gpuRate(getTool('compress-video'))).toBeNull();
  });
});
