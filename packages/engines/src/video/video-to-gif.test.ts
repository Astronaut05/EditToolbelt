import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { openInput } from './media';
import { fillFrames, gifTimes } from './video-to-gif';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

/**
 * The 2 s VP9 clip with its video starting `late` seconds in, as screen
 * recordings and MediaRecorder WebM do. Packets are copied: no decoder needed.
 */
async function lateStart(late: number): Promise<Blob> {
  const input = openInput(fixture('clip-vp9-odd.webm'));
  try {
    const track = await input.getPrimaryVideoTrack();
    const config = await track?.getDecoderConfig();
    if (!track || !config) throw new Error('no video track');
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const source = new EncodedVideoPacketSource('vp9');
    output.addVideoTrack(source);
    await output.start();
    let meta: { decoderConfig: VideoDecoderConfig } | undefined = { decoderConfig: config };
    for await (const packet of new EncodedPacketSink(track).packets()) {
      await source.add(packet.clone({ timestamp: packet.timestamp + late }), meta);
      meta = undefined;
    }
    await output.finalize();
    if (!target.buffer) throw new Error('nothing written');
    return new Blob([target.buffer]);
  } finally {
    input.dispose();
  }
}

describe('gifTimes', () => {
  it('takes a frame every speed ÷ fps seconds from the start', () => {
    expect(gifTimes(2, 4, 4, 1)).toEqual([2, 2.25, 2.5, 2.75]);
    expect(gifTimes(0, 3, 4, 2)).toEqual([0, 0.5, 1]);
  });

  it('asks for no time before the first frame, and keeps the count', () => {
    expect(gifTimes(0, 5, 4, 1, 0.6)).toEqual([0.6, 0.6, 0.6, 0.75, 1]);
    // A track that starts before 0 changes nothing.
    expect(gifTimes(1, 3, 4, 1, -0.5)).toEqual([1, 1.25, 1.5]);
  });

  it.each(['clip-h264-aac.mp4', 'clip-vp9-opus.webm', 'clip-vfr-odd.mkv'])(
    '%s starts at 0: its times stay as asked',
    async (name) => {
      const input = openInput(fixture(name));
      try {
        const track = await input.getPrimaryVideoTrack();
        const first = await track?.getFirstTimestamp();
        expect(gifTimes(0, 6, 12, 1, first)).toEqual(gifTimes(0, 6, 12, 1));
      } finally {
        input.dispose();
      }
    },
  );

  it('finds a frame at every time of a video that starts late', async () => {
    const input = openInput(await lateStart(0.5));
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      const packets = new EncodedPacketSink(track);
      const first = await track.getFirstTimestamp();
      expect(first).toBeCloseTo(0.5, 2);
      // Nothing is on screen before the first frame: a decoder gives null there.
      expect(await packets.getPacket(0, { metadataOnly: true })).toBeNull();
      const times = gifTimes(0, 12, 12, 1, first);
      expect(times).toHaveLength(12);
      for (const time of times) {
        expect(await packets.getPacket(time, { metadataOnly: true })).not.toBeNull();
      }
    } finally {
      input.dispose();
    }
  });
});

describe('fillFrames', () => {
  const frame = (n: number) => new Uint8Array([n]).buffer;
  const shown = (frames: ArrayBuffer[]) => frames.map((f) => new Uint8Array(f)[0]);

  it('gives a time with no frame the one before it, or the first', () => {
    const filled = fillFrames([null, null, frame(1), frame(2), null, frame(3), null]);
    expect(shown(filled)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    // Each one is its own buffer: they are handed over to the worker one by one.
    expect(new Set(filled).size).toBe(7);
  });

  it('leaves a full list as it is, and has nothing to fill an empty one with', () => {
    const frames = [frame(1), frame(2)];
    expect(fillFrames(frames)).toEqual(frames);
    expect(fillFrames([null, null])).toEqual([]);
  });
});
