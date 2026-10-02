import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { videoFrameSource } from './convert-video';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

describe('videoFrameSource', () => {
  it.each([
    ['clip-vp9-opus.webm', /^vp09\./],
    ['clip-vp9-opus.mkv', /^vp09\./],
    ['clip-h264-aac.mp4', /^avc1\./],
  ])('%s: the config and the packets from a key frame up to 1 s', async (name, codec) => {
    const source = await videoFrameSource(fixture(name), 1);
    expect(source?.config.codec).toMatch(codec);
    expect([source?.config.codedWidth, source?.config.codedHeight]).toEqual([256, 144]);
    const packets = source?.packets ?? [];
    expect(packets[0]?.key).toBe(true);
    expect(packets.at(-1)?.timestamp).toBeLessThanOrEqual(1 + 1e-6);
    expect(packets.at(-1)?.timestamp).toBeGreaterThan(0.9);
    expect(packets.slice(1).every((p) => !p.key || p.timestamp <= 1)).toBe(true);
  });

  it('covers a range: from the key frame before the start to the end', async () => {
    const source = await videoFrameSource(fixture('clip-vp9-opus.webm'), 1, 2.5);
    const packets = source?.packets ?? [];
    expect(packets[0]?.key).toBe(true);
    expect(packets[0]?.timestamp).toBeLessThanOrEqual(1);
    expect(packets.at(-1)?.timestamp).toBeGreaterThan(2.4);
    expect(packets.at(-1)?.timestamp).toBeLessThanOrEqual(2.5 + 1e-6);
  });

  it('gives H.264 its avcC description', async () => {
    const source = await videoFrameSource(fixture('clip-h264-aac.mp4'), 0);
    expect(source?.config.description?.length).toBeGreaterThan(0);
    expect(source?.packets).toHaveLength(1);
  });
});
