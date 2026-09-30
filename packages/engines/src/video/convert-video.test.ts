import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EncodedPacketSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { planConversion, videoConverterEngine } from './convert-video';
import { openInput } from './media';

const fixture = (name: string) =>
  new Blob([
    readFileSync(fileURLToPath(new URL(`../../../../fixtures/video/${name}`, import.meta.url))),
  ]);
const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });
const all = { video: () => true, audio: () => true };

/** A hash of every video packet, in order. */
async function frameHashes(file: Blob): Promise<string[]> {
  const input = openInput(file);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video');
  const hashes: string[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) {
    hashes.push(createHash('sha256').update(packet.data).digest('hex'));
  }
  input.dispose();
  return hashes;
}

describe('Video Converter plan', () => {
  it('remuxes H.264 + AAC into MP4, MOV or MKV', () => {
    for (const to of ['mp4', 'mov', 'mkv'] as const) {
      expect(planConversion({ video: 'avc', audio: 'aac' }, to, {}, all)).toMatchObject({
        container: to,
        video: { copy: true },
        audio: { copy: true },
      });
    }
  });

  it('re-encodes VP9 + Opus to H.264 + AAC for an MP4', () => {
    expect(planConversion({ video: 'vp9', audio: 'opus' }, 'mp4', {}, all)).toMatchObject({
      container: 'mp4',
      video: { copy: false, codec: 'avc' },
      audio: { copy: false, codec: 'aac' },
    });
  });

  it('copies what fits and re-encodes only the rest', () => {
    // H.264 into WebM: the video is re-encoded to VP9; Opus audio is copied.
    expect(planConversion({ video: 'avc', audio: 'opus' }, 'webm', {}, all)).toMatchObject({
      video: { copy: false, codec: 'vp9' },
      audio: { copy: true },
    });
  });

  it('re-encodes when asked, in the codec asked for', () => {
    expect(
      planConversion(
        { video: 'avc', audio: 'aac' },
        'mp4',
        { mode: 'reencode', codec: 'hevc' },
        all,
      ),
    ).toMatchObject({ video: { copy: false, codec: 'hevc' }, audio: { copy: true } });
  });

  it('falls back to WebM where the browser has no H.264 encoder, and says so', () => {
    const plan = planConversion(
      { video: 'vp9', audio: 'opus' },
      'mp4',
      {},
      { video: (c) => c === 'vp9', audio: (c) => c === 'opus' },
    );
    expect(plan).toMatchObject({ container: 'webm', video: { copy: true }, audio: { copy: true } });
    expect(plan.notes[0]).toMatch(/^Saved as WebM/);
  });
});

describe('Video Converter', () => {
  it('MOV (H.264) → MP4 is a remux: every frame identical', async () => {
    const mov = fixture('clip-h264-aac.mov');
    const out = await videoConverterEngine.run(mov, { format: 'mp4' }, ctx());
    expect(out.ext).toBe('mp4');
    expect(out.path).toBe('Browser · remux');
    expect(out.notes).toContain('H.264 video copied, not re-encoded');
    const before = await frameHashes(mov);
    expect(before.length).toBeGreaterThan(100);
    expect(await frameHashes(out.blob)).toEqual(before);
  });

  it('MKV (VP9 + Opus) → WebM is a remux too', async () => {
    const out = await videoConverterEngine.run(
      fixture('clip-vp9-opus.mkv'),
      { format: 'webm' },
      ctx(),
    );
    expect(out.ext).toBe('webm');
    expect(out.path).toBe('Browser · remux');
  });

  it('says AVI needs the server path', async () => {
    const avi = new Blob([new TextEncoder().encode('RIFF\0\0\0\0AVI LIST')]);
    await expect(videoConverterEngine.run(avi, { format: 'mp4' }, ctx())).rejects.toThrow(
      /AVI and older formats need our server converter/,
    );
  });
});
