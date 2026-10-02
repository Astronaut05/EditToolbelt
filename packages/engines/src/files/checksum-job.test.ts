import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { runChecksumJob, type ChecksumMessage } from './checksum-job';

/** The engine's split, run in one thread: the reader hashes MD5 and SHA-1 and sends the pieces on for SHA-256. */
async function hashAll(bytes: Uint8Array<ArrayBuffer>, ahead?: number) {
  const { port1, port2 } = new MessageChannel();
  const messages: ChecksumMessage[] = [];
  const post = (message: ChecksumMessage) => {
    messages.push(message);
  };
  await Promise.all([
    runChecksumJob(
      { algos: ['md5', 'sha1'], file: new Blob([bytes]), ports: [port1] },
      post,
      ahead,
    ),
    runChecksumJob({ algos: ['sha256'], ports: [port2] }, post, ahead),
  ]);
  port1.close();
  const hashes: Record<string, string | undefined> = {};
  for (const message of messages) {
    if (message.type === 'error') throw new Error(message.message);
    if (message.type === 'done') Object.assign(hashes, message.hashes);
  }
  const progress = messages.flatMap((m) => (m.type === 'progress' ? [m.fraction] : []));
  return { hashes, progress };
}

const node = (bytes: Uint8Array) => ({
  md5: createHash('md5').update(bytes).digest('hex'),
  sha1: createHash('sha1').update(bytes).digest('hex'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/** Bytes that differ all the way through, so a dropped or repeated piece shows. */
function varied(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i + 4 <= length; i += 4) view.setUint32(i, Math.imul(i, 2654435761) >>> 0, true);
  return bytes;
}

describe('runChecksumJob', () => {
  it('gives the known answers for "abc" (RFC 1321, FIPS 180)', async () => {
    const { hashes } = await hashAll(new TextEncoder().encode('abc'));
    expect(hashes).toEqual({
      md5: '900150983cd24fb0d6963f7d28e17f72',
      sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('hashes an empty file', async () => {
    const { hashes } = await hashAll(new Uint8Array(0));
    expect(hashes).toEqual(node(new Uint8Array(0)));
  });

  it('matches Node over many pieces, with the reader held back by the slower worker', async () => {
    const bytes = varied(5 * 1024 * 1024 + 3);
    // No lead: the reader waits for SHA-256 before every piece after the first.
    const { hashes, progress } = await hashAll(bytes, 0);
    expect(hashes).toEqual(node(bytes));
    // Progress counts what both have hashed: it only goes up, and never past the end.
    for (const [i, fraction] of progress.entries()) {
      expect(fraction).toBeLessThanOrEqual(1);
      expect(fraction).toBeGreaterThanOrEqual(progress[i - 1] ?? 0);
    }
  });

  it('starts afresh for the next file on the same hashers', async () => {
    const first = varied(300_000);
    const second = first.map((byte) => byte ^ 0xff);
    expect((await hashAll(first)).hashes).toEqual(node(first));
    expect((await hashAll(second)).hashes).toEqual(node(second));
  });

  it('says so when it has nothing to hash', async () => {
    const messages: ChecksumMessage[] = [];
    await runChecksumJob({ algos: ['md5'], ports: [] }, (message) => messages.push(message));
    expect(messages).toEqual([{ type: 'error', message: 'nothing to hash' }]);
  });
});
