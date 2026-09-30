import { describe, expect, it } from 'vitest';

import { oneOf, readQuery, withValue } from './url-state';

const DEFAULTS = { mode: 'size', width: '1920' };

describe('calculator URL state', () => {
  it('reads known keys and keeps defaults for the rest', () => {
    expect(readQuery('width=1280&utm_source=x', DEFAULTS)).toEqual({ mode: 'size', width: '1280' });
    expect(readQuery('', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('writes only values that differ from the default', () => {
    expect(withValue('', 'width', '1280', '1920')).toBe('width=1280');
    expect(withValue('width=1280&mode=fit', 'width', '1920', '1920')).toBe('mode=fit');
    expect(withValue('', 'ratio', '16:9', '2.39:1')).toBe('ratio=16%3A9');
  });

  it('falls back when the URL holds an unknown choice', () => {
    expect(oneOf('fit', ['size', 'fit'] as const, 'size')).toBe('fit');
    expect(oneOf('<script>', ['size', 'fit'] as const, 'size')).toBe('size');
  });
});
