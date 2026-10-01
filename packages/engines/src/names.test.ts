import { describe, expect, it } from 'vitest';

import { safeStem } from './names';

describe('safeStem', () => {
  it('drops the extension and turns anything else into single dashes', () => {
    expect(safeStem('IMG 001 (copy).JPG', 'image')).toBe('IMG-001-copy');
    expect(safeStem('Été à Paris.heic', 'image')).toBe('Été-à-Paris');
    expect(safeStem('take_2-final', 'clip')).toBe('take_2-final');
  });

  it('falls back when nothing is left', () => {
    expect(safeStem('', 'image')).toBe('image');
    expect(safeStem('.png', 'image')).toBe('image');
    expect(safeStem('###.wav', 'audio')).toBe('audio');
  });

  it('keeps at most 60 characters', () => {
    expect(safeStem(`${'a'.repeat(100)}.mov`, 'clip')).toBe('a'.repeat(60));
  });

  it('takes no longer on a name of many dashes', () => {
    const started = performance.now();
    expect(safeStem(`${'-'.repeat(200_000)}x${'-'.repeat(200_000)}.png`, 'image')).toBe('x');
    expect(performance.now() - started).toBeLessThan(200);
  });
});
