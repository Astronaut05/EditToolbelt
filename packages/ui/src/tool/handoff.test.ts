import { describe, expect, it } from 'vitest';

import { accepts, handOff, takeHandoff } from './handoff';

describe('handoff', () => {
  const file = new File(['x'], 'mug-nobg.png', { type: 'image/png' });

  it('gives the file to the tool it was meant for, once', () => {
    handOff(file, 'resize-image', 1000);
    expect(takeHandoff('compress-image', 1000)).toBeNull();
    expect(takeHandoff('resize-image', 2000)).toBe(file);
    expect(takeHandoff('resize-image', 2000)).toBeNull();
  });

  it('drops a file that waited too long', () => {
    handOff(file, 'resize-image', 0);
    expect(takeHandoff('resize-image', 60_000)).toBeNull();
  });

  it('matches exact types and wildcards', () => {
    expect(accepts(['image/jpeg', 'image/png'], 'image/png')).toBe(true);
    expect(accepts(['image/*'], 'image/webp')).toBe(true);
    expect(accepts(['video/mp4'], 'image/png')).toBe(false);
    expect(accepts(undefined, 'image/png')).toBe(false);
    expect(accepts(['image/png'], '')).toBe(false);
  });
});
