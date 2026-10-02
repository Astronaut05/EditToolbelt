import { describe, expect, it } from 'vitest';

import { lineLength, isAudioFile } from '../tools/speech-presets';
import { estimateCredits, uploadType } from './server-run';

describe('estimateCredits', () => {
  const perMinute = { kind: 'perMinute', credits: 2, minCredits: 2 } as const;
  const perMp = { kind: 'perMegapixel', credits: 0.25, minCredits: 2 } as const;

  it('prices per minute from the length, and waits for it', () => {
    expect(estimateCredits(perMinute, 150, undefined, {})).toBe(5);
    expect(estimateCredits(perMinute, undefined, undefined, {})).toBeNull();
  });

  it('prices Upscale Image on the result’s megapixels, from the picture and the scale', () => {
    const upscale = (width: number, height: number, options: Record<string, string>) =>
      (width * height * (options.scale === '2' ? 4 : 16)) / 1e6;
    const picture = { width: 1000, height: 750 };
    expect(estimateCredits(perMp, 0, picture, { scale: '4' }, upscale)).toBe(3);
    expect(estimateCredits(perMp, 0, picture, { scale: '2' }, upscale)).toBe(2);
    // Without the picture's size the price isn't known yet.
    expect(estimateCredits(perMp, 0, undefined, { scale: '4' }, upscale)).toBeNull();
  });
});

describe('the speech tools in the browser', () => {
  it('type files by extension for the API', () => {
    expect(uploadType(new File([], 'talk.m4a'))).toBe('audio/mp4');
    expect(uploadType(new File([], 'photo.JPG'))).toBe('image/jpeg');
    expect(uploadType(new File([], 'x.bin', { type: 'audio/ogg' }))).toBe('audio/ogg');
  });

  it('send audio as it is, and a video’s sound only', () => {
    expect(isAudioFile(new File([], 'a.mp3'))).toBe(true);
    expect(isAudioFile(new File([], 'a', { type: 'audio/wav' }))).toBe(true);
    expect(isAudioFile(new File([], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
  });

  it('keeps line length between 16 and 80 characters', () => {
    expect(lineLength('42')).toBe(42);
    expect(lineLength('37.6')).toBe(38);
    expect(lineLength('5')).toBe(42);
    expect(lineLength('abc')).toBe(42);
  });
});
