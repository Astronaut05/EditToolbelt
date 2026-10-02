import { describe, expect, it } from 'vitest';

import { joinedFiles } from './ServerNotice';

const GB = 1000 ** 3;
const clip = (name: string, size: number, durationSec?: number) => ({
  file: new File([], name),
  size,
  ...(durationSec !== undefined && { durationSec }),
});

describe('joinedFiles', () => {
  it('counts the files to join together, in order', () => {
    const queue = [clip('b.mp4', 1.5 * GB, 30), clip('a.mp4', 0.25 * GB, 4.5)];
    const joined = joinedFiles(queue, 2 * GB);
    expect(joined.files.map((f) => f.name)).toEqual(['b.mp4', 'a.mp4']);
    expect(joined.bytes).toBe(1.75 * GB);
    expect(joined.durationSec).toBe(34.5);
    // Within the browser's limit: no reason to offer the server.
    expect(joined.reason).toBeNull();
  });

  it('knows the length only once every file is read', () => {
    expect(joinedFiles([clip('a.mp4', 10, 4), clip('b.mp4', 10)], 100).durationSec).toBeUndefined();
  });

  it('offers our servers when the files are over the browser limit in all', () => {
    const joined = joinedFiles([clip('a.mp4', 1.5 * GB), clip('b.mp4', 1.5 * GB)], 2 * GB);
    expect(joined.reason).toBe(
      'These files come to 3.0 GB, over the browser limit of 2.0 GB in all. Our servers can take them.',
    );
  });
});
