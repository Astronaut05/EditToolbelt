import { describe, expect, it } from 'vitest';

import { serverOptionsFor, soundPlan } from './remove-noise-plan';

describe('serverOptionsFor', () => {
  it('turns the page’s settings into the API’s, with safe defaults', () => {
    expect(
      serverOptionsFor({ strength: 'strong', dehum: '60', deess: 'on', format: 'mp3' }),
    ).toEqual({ strength: 'strong', dehum: '60', deess: true, format: 'mp3', preview: false });
    expect(serverOptionsFor({ strength: 'max', dehum: '55', previewFrom: '12' })).toEqual({
      strength: 'medium',
      dehum: 'off',
      deess: false,
      format: 'keep',
      preview: false,
    });
    expect(serverOptionsFor({ preview: 'on' }).preview).toBe(true);
  });
});

describe('soundPlan', () => {
  const mp3 = { video: false, serverType: { ext: 'mp3' } };
  const aiff = { video: false, serverType: null };
  const video = { video: true, serverType: null };

  it('keeps an audio file’s format, and gives audio our servers don’t read back as WAV', () => {
    expect(soundPlan(mp3, 'keep')).toEqual({ format: 'keep', backIntoVideo: false });
    expect(soundPlan(aiff, 'keep')).toEqual({ format: 'wav', backIntoVideo: false });
    expect(soundPlan(aiff, 'mp3')).toEqual({ format: 'mp3', backIntoVideo: false });
  });

  it('puts a video’s sound back as lossless FLAC, or gives the sound alone in another format', () => {
    expect(soundPlan(video, 'keep')).toEqual({ format: 'flac', backIntoVideo: true });
    expect(soundPlan(video, 'm4a')).toEqual({ format: 'm4a', backIntoVideo: false });
  });
});
