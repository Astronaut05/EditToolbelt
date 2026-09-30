/**
 * Makes the Video Converter fixtures by remuxing the existing clips' first
 * 4 s (no re-encode, so no codec is needed):
 * - clip-h264-aac.mov: H.264 + AAC in QuickTime, as cameras and iPhones write;
 * - clip-vp9-opus.mkv: VP9 + Opus in Matroska.
 * Run from the repo root: node packages/engines/scripts/converter-fixtures.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Output,
  type OutputFormat,
} from 'mediabunny';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/video');

async function remux(from: string, to: string, format: OutputFormat) {
  const input = new Input({
    source: new BufferSource(readFileSync(join(DIR, from))),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  const conversion = await Conversion.init({
    input,
    output: new Output({ format, target }),
    trim: { start: 0, end: 4 },
    tags: {},
  });
  await conversion.execute();
  if (!target.buffer) throw new Error(`no output for ${to}`);
  writeFileSync(join(DIR, to), new Uint8Array(target.buffer));
  console.log(`${to}: ${String(target.buffer.byteLength)} bytes`);
}

await remux(
  'clip-h264-aac.mp4',
  'clip-h264-aac.mov',
  new MovOutputFormat({ fastStart: 'in-memory' }),
);
await remux('clip-vp9-opus.webm', 'clip-vp9-opus.mkv', new MkvOutputFormat());
