/**
 * U04's hashing, run by the checksum workers (./checksum.worker.ts). SHA-256
 * alone takes about as long as MD5 and SHA-1 together, so two workers split
 * them and run side by side. The file is still read once, a piece at a time:
 * the worker that reads it hashes each piece, then hands it to the other
 * worker. hash-wasm (MIT) does the hashing.
 */
import type { checksum } from '@etb/core';
import { createMD5, createSHA1, createSHA256, type IHasher } from 'hash-wasm';

type HashAlgo = checksum.HashAlgo;

export interface ChecksumJob {
  /** What this worker hashes. */
  algos: readonly HashAlgo[];
  /** The file, for the worker that reads it. Without one, the pieces arrive on `ports[0]`. */
  file?: Blob;
  /** The reader's port to each other worker, or the one port a worker's pieces arrive on. */
  ports: readonly MessagePort[];
}

export type ChecksumMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; hashes: Partial<Record<HashAlgo, string>> }
  | { type: 'error'; message: string };

/** How far the reader may get ahead of the slowest worker, bytes: the most held as pieces in transit. */
export const AHEAD = 16 * 1024 * 1024;

/** Progress at most this often, ms. */
const TICK = 100;

/** A hasher for one of the three names; anything else a message carries is refused. */
function create(algo: HashAlgo): Promise<IHasher> {
  switch (algo) {
    case 'md5':
      return createMD5();
    case 'sha1':
      return createSHA1();
    case 'sha256':
      return createSHA256();
    default:
      throw new Error(`No such hash: ${String(algo)}`);
  }
}

/** One hasher per algorithm for the worker's life: compiled once, reset for each file. */
const hashers = new Map<HashAlgo, Promise<IHasher>>();

async function hashersFor(algos: readonly HashAlgo[]): Promise<IHasher[]> {
  const ready = await Promise.all(
    algos.map((algo) => {
      let hasher = hashers.get(algo);
      if (!hasher) {
        hasher = create(algo);
        hashers.set(algo, hasher);
      }
      return hasher;
    }),
  );
  for (const hasher of ready) hasher.init();
  return ready;
}

/** Reads the file once: each piece goes into this worker's hashers, then on to the other workers. */
async function read(
  file: Blob,
  own: readonly IHasher[],
  ports: readonly MessagePort[],
  post: (message: ChecksumMessage) => void,
  ahead: number,
): Promise<void> {
  // Bytes each other worker has hashed, as it reports them.
  const hashed = ports.map(() => 0);
  let wake: (() => void) | undefined;
  for (const [i, port] of ports.entries()) {
    port.onmessage = (event: MessageEvent<number>) => {
      hashed[i] = event.data;
      wake?.();
    };
  }
  const reader = file.stream().getReader();
  let read = 0;
  let told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    while (read - Math.min(...hashed) > ahead) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    for (const hasher of own) hasher.update(value);
    read += value.byteLength;
    // Hashed here first, so the last worker is handed the piece itself rather than a copy.
    const whole = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;
    for (const [i, port] of ports.entries()) {
      port.postMessage(value, whole && i === ports.length - 1 ? [value.buffer] : []);
    }
    const now = performance.now();
    if (now - told > TICK) {
      told = now;
      post({ type: 'progress', fraction: file.size ? Math.min(read, ...hashed) / file.size : 1 });
    }
  }
  for (const port of ports) port.postMessage(null);
}

/** Hashes the pieces the reader sends, until it sends `null`; says how far it got after each. */
function follow(port: MessagePort, own: readonly IHasher[]): Promise<void> {
  return new Promise((resolve) => {
    let hashed = 0;
    port.onmessage = (event: MessageEvent<Uint8Array | null>) => {
      const piece = event.data;
      if (!piece) {
        port.close();
        resolve();
        return;
      }
      for (const hasher of own) hasher.update(piece);
      hashed += piece.byteLength;
      port.postMessage(hashed);
    };
  });
}

/** One worker's part of hashing one file. Ends with a `done` or `error` message. */
export async function runChecksumJob(
  job: ChecksumJob,
  post: (message: ChecksumMessage) => void,
  ahead = AHEAD,
): Promise<void> {
  try {
    const own = await hashersFor(job.algos);
    const [source] = job.ports;
    if (job.file) await read(job.file, own, job.ports, post, ahead);
    else if (source) await follow(source, own);
    else throw new Error('nothing to hash');
    const hashes: Partial<Record<HashAlgo, string>> = {};
    for (const [i, algo] of job.algos.entries()) hashes[algo] = own[i]?.digest('hex');
    post({ type: 'done', hashes });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'unknown error' });
  }
}
