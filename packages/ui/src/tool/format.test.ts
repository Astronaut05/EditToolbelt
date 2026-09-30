import { describe, expect, it } from 'vitest';

import {
  durationBucket,
  formatBytes,
  formatTimecode,
  matchesAccept,
  outputName,
  sizeBucket,
} from './format';

describe('format helpers', () => {
  it('formats sizes with one decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3_100_000)).toBe('3.1 MB');
    expect(formatBytes(4_100_000_000)).toBe('4.1 GB');
  });

  it('formats timecode', () => {
    expect(formatTimecode(72.4)).toBe('00:01:12.400');
    expect(formatTimecode(3600)).toBe('01:00:00.000');
  });

  it('names outputs after the input', () => {
    expect(outputName('holiday.jpg', 'nobg', 'png')).toBe('holiday_nobg.png');
    expect(outputName('archive.tar.gz', 'x', 'zip')).toBe('archive.tar_x.zip');
    // Converters keep the name and change the extension.
    expect(outputName('episode 1.srt', '', 'vtt')).toBe('episode 1.vtt');
    expect(outputName('.hidden', 'x', 'png')).toBe('.hidden_x.png');
  });

  it('matches accept filters', () => {
    const heic = { name: 'IMG_1.HEIC', type: '' };
    expect(matchesAccept(heic, 'image/*,.heic')).toBe(true);
    expect(matchesAccept({ name: 'a.png', type: 'image/png' }, 'image/*')).toBe(true);
    expect(matchesAccept({ name: 'a.mp4', type: 'video/mp4' }, 'image/*,.heic')).toBe(false);
    expect(matchesAccept({ name: 'a.bin', type: '' }, '')).toBe(true);
  });
});

describe('analytics buckets', () => {
  it('buckets sizes and durations', () => {
    expect(sizeBucket(500_000)).toBe('<1MB');
    expect(sizeBucket(4_800_000)).toBe('1-10MB');
    expect(sizeBucket(2_000_000_000)).toBe('>1GB');
    expect(durationBucket(1900)).toBe('1-3s');
    expect(durationBucket(120_000)).toBe('>60s');
  });
});
