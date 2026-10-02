/**
 * U04's hashing worker: reads the file as a stream, once, and feeds every
 * chunk to MD5, SHA-1 and SHA-256 (hash-wasm, MIT), so a multi-GB file
 * never sits in memory and the page stays responsive.
 */
import { createMD5, createSHA1, createSHA256 } from 'hash-wasm';

export interface ChecksumJob {
  file: File;
}

export type ChecksumMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; md5: string; sha1: string; sha256: string }
  | { type: 'error'; message: string };

interface WorkerScope {
  postMessage(message: ChecksumMessage): void;
  onmessage: ((event: MessageEvent<ChecksumJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

/** Progress at most this often, ms. */
const TICK = 100;

async function hash(file: File): Promise<Extract<ChecksumMessage, { type: 'done' }>> {
  const [md5, sha1, sha256] = await Promise.all([createMD5(), createSHA1(), createSHA256()]);
  const reader = file.stream().getReader();
  let read = 0;
  let told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    md5.update(value);
    sha1.update(value);
    sha256.update(value);
    read += value.byteLength;
    const now = performance.now();
    if (now - told > TICK) {
      told = now;
      scope.postMessage({ type: 'progress', fraction: file.size ? read / file.size : 1 });
    }
  }
  return {
    type: 'done',
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
    sha256: sha256.digest('hex'),
  };
}

scope.onmessage = (event) => {
  hash(event.data.file).then(
    (done) => {
      scope.postMessage(done);
    },
    (error: unknown) => {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    },
  );
};
