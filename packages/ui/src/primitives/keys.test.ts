import { describe, expect, it } from 'vitest';

import { letterOf } from './keys';

describe('letterOf', () => {
  it('reads Latin letters from the key, in lower case', () => {
    expect(letterOf({ key: 'k', code: 'KeyK' })).toBe('k');
    expect(letterOf({ key: 'T', code: 'KeyT' })).toBe('t');
  });

  it('falls back to the key position on a non-Latin layout', () => {
    expect(letterOf({ key: 'л', code: 'KeyK' })).toBe('k');
    expect(letterOf({ key: 'е', code: 'KeyT' })).toBe('t');
  });

  it('follows the layout, not the position, when the key is a Latin letter', () => {
    // Dvorak: the key at QWERTY's K types "t".
    expect(letterOf({ key: 't', code: 'KeyK' })).toBe('t');
  });

  it('is empty for keys that are not letters', () => {
    expect(letterOf({ key: '/', code: 'Slash' })).toBe('');
    expect(letterOf({ key: 'Enter', code: 'Enter' })).toBe('');
    expect(letterOf({ key: '1', code: 'Digit1' })).toBe('');
  });
});
