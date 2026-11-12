import { describe, expect, it } from 'vitest';

import { originalExt } from './compress';

describe('originalExt', () => {
  it('keeps the file’s own video extension, not the re-encode’s', () => {
    expect(originalExt('holiday.mkv', 'mkv')).toBe('mkv');
    expect(originalExt('take 2.final.webm', 'webm')).toBe('webm');
    expect(originalExt('Screen Recording.MOV', 'mov')).toBe('mov');
    // An .m4v is read as MP4; it stays the name the file came with.
    expect(originalExt('clip.m4v', 'mp4')).toBe('m4v');
  });

  it('uses the format that was read when the name has no video extension', () => {
    expect(originalExt(undefined, 'mkv')).toBe('mkv');
    expect(originalExt('clip', 'webm')).toBe('webm');
    expect(originalExt('clip.bin', 'mov')).toBe('mov');
  });
});
