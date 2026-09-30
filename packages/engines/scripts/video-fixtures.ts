/**
 * Makes the Video Info fixtures from fixtures/video/clip-h264-aac.mp4 by
 * remuxing its first 4 s of video (no re-encode, so no codec is needed):
 * - clip-vfr.mp4: frames on an irregular clock, like a phone recording;
 * - clip-hlg.mp4: the same frames tagged BT.2020 + HLG, like an HDR phone video.
 * Run from the repo root: node packages/engines/scripts/video-fixtures.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/video');
const SECONDS = 4;

async function remux(
  name: string,
  retime: (index: number, timestamp: number) => number,
  colorSpace?: VideoColorSpaceInit,
) {
  const input = new Input({
    source: new BufferSource(readFileSync(join(DIR, 'clip-h264-aac.mp4'))),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const config = await track.getDecoderConfig();
  if (!config) throw new Error('no decoder config');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(source);
  await output.start();
  const packets: EncodedPacket[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) {
    if (packet.timestamp >= SECONDS) break;
    packets.push(packet);
  }
  // Frames are retimed in presentation order (the clip has B-frames, so decode
  // order differs); each one lasts until the next frame on screen.
  const shown = [...packets].sort((a, b) => a.timestamp - b.timestamp);
  const newTime = new Map(shown.map((packet, i) => [packet, retime(i, packet.timestamp)]));
  const next = new Map(shown.map((packet, i) => [packet, shown[i + 1]]));
  for (const [i, packet] of packets.entries()) {
    const timestamp = newTime.get(packet) ?? 0;
    const after = next.get(packet);
    const duration = (after ? (newTime.get(after) ?? timestamp) : timestamp + 1 / 30) - timestamp;
    await source.add(
      new EncodedPacket(packet.data, packet.type, timestamp, duration),
      i === 0 ? { decoderConfig: { ...config, ...(colorSpace && { colorSpace }) } } : undefined,
    );
  }
  await output.finalize();
  input.dispose();
  if (!target.buffer) throw new Error('nothing written');
  writeFileSync(join(DIR, name), new Uint8Array(target.buffer));
  console.log(`${name}: ${String(target.buffer.byteLength)} bytes`);
}

await remux('clip-vfr.mp4', (i) => {
  // About 30 fps, each gap 70 % to 130 % of a frame, off any lattice, as phones record.
  let t = 0;
  for (let k = 0; k < i; k += 1) {
    const jitter = (Math.sin(k * 12.9898) * 43758.5453) % 1;
    t += (1 / 30) * (1 + 0.6 * (Math.abs(jitter) - 0.5));
  }
  return Math.round(t * 90_000) / 90_000;
});
// TypeScript's DOM types stop at SDR; browsers and Mediabunny take the HDR names.
await remux('clip-hlg.mp4', (_, timestamp) => timestamp, {
  primaries: 'bt2020',
  transfer: 'hlg',
  matrix: 'bt2020-ncl',
  fullRange: false,
} as unknown as VideoColorSpaceInit);
