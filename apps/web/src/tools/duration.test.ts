import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './duration';

describe('durations', () => {
  it('reads the ways people type them', () => {
    expect(parseDuration('1:30:00')).toBe(5400);
    expect(parseDuration('90:00')).toBe(5400);
    expect(parseDuration('95')).toBe(95);
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('2m 5s')).toBe(125);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('a:b')).toBeNull();
  });

  it('prints them back', () => {
    expect(formatDuration(5400)).toBe('1:30:00');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(95.5)).toBe('1:35.5');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(5.5)).toBe('0:05.5');
  });

  it('rounds before splitting, so a drop-frame hour never reads 59:60', () => {
    expect(formatDuration(3599.9964)).toBe('1:00:00');
    expect(formatDuration(59.97)).toBe('1:00');
  });
});
