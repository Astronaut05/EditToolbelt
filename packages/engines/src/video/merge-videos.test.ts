import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EncodedPacketSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { openInput } from './media';
import {
  mergeVideosEngine,
  placeCopiedSound,
  standardFps,
  trackEnds,
  type PacketTiming,
} from './merge-videos';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** The sound's packets in a file: start and length, seconds. */
async function soundPackets(file: Blob): Promise<PacketTiming[]> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    const out: PacketTiming[] = [];
    if (!track) return out;
    for await (const p of new EncodedPacketSink(track).packets()) {
      out.push({ timestamp: p.timestamp, duration: p.duration });
    }
    return out;
  } finally {
    input.dispose();
  }
}

/**
 * A clip's sound packets as Mediabunny reads an MP4 or MOV with AAC: the
 * encoder's priming packet before 0 (the edit list hides it), then 1024
 * samples a packet at 48 kHz, running a little past the picture's end. This
 * is fixtures/video/clip-h264-aac.mov: 4 s of picture, sound to 4.0107 s.
 */
function aacPackets(seconds: number): PacketTiming[] {
  const step = 1024 / 48_000;
  const packets: PacketTiming[] = [{ timestamp: -step, duration: step }];
  for (let t = 0; t < seconds; t += step) packets.push({ timestamp: t, duration: step });
  return packets;
}

/** Places every clip's packets as the fast join does; the picture is `duration` long each time. */
function join(clips: { duration: number; packets: PacketTiming[] }[], cut = false) {
  const placed: { clip: number; at: PacketTiming }[] = [];
  let offset = 0;
  let previous = -Infinity;
  for (const [i, clip] of clips.entries()) {
    for (const packet of clip.packets) {
      const place = placeCopiedSound(
        packet,
        { offset, duration: clip.duration, first: i === 0 },
        previous,
        cut,
      );
      if (place === 'end') break;
      if (place === 'skip') continue;
      placed.push({ clip: i, at: place });
      previous = place.timestamp;
    }
    offset += clip.duration;
  }
  return { placed, end: offset };
}

describe('placeCopiedSound', () => {
  it('keeps sound and picture together over six joined clips: under 40 ms apart at the end', () => {
    const clip = { duration: 4, packets: aacPackets(4.01) };
    const { placed, end } = join(Array.from({ length: 6 }, () => clip));
    const last = placed.at(-1)?.at ?? { timestamp: 0, duration: 0 };
    expect(end).toBe(24);
    expect(Math.abs(last.timestamp + last.duration - end)).toBeLessThan(0.04);
    // Each clip's sound starts exactly with its picture, so nothing builds up join by join.
    for (let i = 1; i < 6; i += 1) {
      const first = placed.find((p) => p.clip === i)?.at.timestamp ?? NaN;
      expect(Math.abs(first - 4 * i)).toBeLessThan(1e-9);
    }
    // Times only go forward, and no clip's sound runs into the next clip's.
    placed.slice(1).forEach((p, i) => {
      expect(p.at.timestamp).toBeGreaterThan(placed[i]?.at.timestamp ?? Infinity);
    });
    for (const p of placed) {
      if (p.clip < 5)
        expect(p.at.timestamp + p.at.duration).toBeLessThanOrEqual(4 * (p.clip + 1) + 1e-9);
    }
  });

  it('keeps the first clip’s priming, and leaves it out of every later clip', () => {
    const step = 1024 / 48_000;
    const clip = { offset: 4, duration: 4, first: false };
    expect(
      placeCopiedSound(
        { timestamp: -step, duration: step },
        { ...clip, offset: 0, first: true },
        -Infinity,
      ),
    ).toEqual({
      timestamp: -step,
      duration: step,
    });
    expect(placeCopiedSound({ timestamp: -step, duration: step }, clip, 3.9)).toBe('skip');
    // A packet that starts just before 0 but holds sound after it is kept.
    expect(placeCopiedSound({ timestamp: -0.001, duration: step }, clip, 3.9)).toEqual({
      timestamp: 3.999,
      duration: step,
    });
  });

  it('leaves out a packet that would run past the picture, and stops after the end', () => {
    const clip = { offset: 0, duration: 4, first: true };
    expect(placeCopiedSound({ timestamp: 3.99, duration: 0.0213 }, clip, 3.97)).toBe('skip');
    // Within Matroska's 1 ms it's kept, as are packets of unknown length (0).
    expect(placeCopiedSound({ timestamp: 3.98, duration: 0.0205 }, clip, 3.96)).toEqual({
      timestamp: 3.98,
      duration: 0.0205,
    });
    expect(placeCopiedSound({ timestamp: 3.99, duration: 0 }, clip, 3.98)).toEqual({
      timestamp: 3.99,
      duration: 0,
    });
    expect(placeCopiedSound({ timestamp: 4, duration: 0.02 }, clip, 3.99)).toBe('end');
  });

  it('cuts PCM short at the picture’s end instead, so no sound is lost', () => {
    // A camera's PCM in chunks of 1 s; the pictures are 2.5 s long.
    const chunks = [0, 1, 2].map((t) => ({ timestamp: t, duration: 1 }));
    const { placed } = join(
      [
        { duration: 2.5, packets: chunks },
        { duration: 2.5, packets: chunks },
      ],
      true,
    );
    expect(placed.map((p) => [p.at.timestamp, p.at.duration])).toEqual([
      [0, 1],
      [1, 1],
      [2, 0.5],
      [2.5, 1],
      [3.5, 1],
      [4.5, 0.5],
    ]);
  });

  it('never places a packet before the one before it', () => {
    const clip = { offset: 8, duration: 4, first: false };
    expect(placeCopiedSound({ timestamp: 0.01, duration: 0.02 }, clip, 8.05)).toEqual({
      timestamp: 8.05,
      duration: 0.02,
    });
  });
});

describe('mergeVideosEngine', () => {
  it('joins five H.264 + AAC clips without a re-encode, the sound with its picture at every join', async () => {
    const clip = fixture('clip-h264-aac.mov');
    const out = await mergeVideosEngine.run(clip, { files: Array(5).fill(clip) as Blob[] }, ctx());
    expect(out.path).toBe('Browser · stream copy');
    const ends = await trackEnds(out.blob);
    expect(ends.video).toBeCloseTo(20, 6);
    expect(Math.abs((ends.audio ?? 0) - ends.video)).toBeLessThan(0.04);
    // Each clip's sound starts at its picture's start (4 s apart), priming left out.
    const step = 1024 / 48_000;
    const starts = (await soundPackets(out.blob)).map((p) => p.timestamp);
    for (let i = 1; i < 5; i += 1) {
      expect(starts.some((t) => Math.abs(t - 4 * i) < 1e-6)).toBe(true);
      expect(starts.some((t) => Math.abs(t - (4 * i - step)) < 1e-6)).toBe(false);
    }
  });

  it('refuses clips that come to more than 2 GB together, before reading any', async () => {
    // Only their sizes are looked at first.
    const clip = { size: 1.2 * 1024 ** 3 } as Blob;
    await expect(
      mergeVideosEngine.run(
        clip,
        { files: [clip, clip] },
        { signal: new AbortController().signal, progress: () => undefined },
      ),
    ).rejects.toThrow(
      'These clips come to 2.4 GB together, over the browser limit of 2 GB. Merge fewer at a time.',
    );
  });
});

describe('standardFps', () => {
  it('rounds a measured rate to the nearest standard one', () => {
    expect(standardFps(29.98)).toBe(29.97);
    expect(standardFps(30.02)).toBe(30);
    expect(standardFps(23.98)).toBe(23.976);
    expect(standardFps(24.4)).toBe(24);
    expect(standardFps(25.3)).toBe(25);
    expect(standardFps(59.95)).toBe(59.94);
    expect(standardFps(48)).toBe(50);
    expect(standardFps(120)).toBe(60);
    expect(standardFps(10)).toBe(23.976);
  });
});
