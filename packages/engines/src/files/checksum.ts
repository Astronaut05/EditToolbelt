/**
 * U04 File Checksum (tools/utility.md): MD5, SHA-1 and SHA-256 of a file,
 * streamed in ./checksum.worker.ts so multi-GB media works. The result's
 * download is the file's line for `sha256sum -c`; the page checks pasted
 * hashes against the three values without hashing again.
 */
import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import type { ChecksumJob, ChecksumMessage } from './checksum.worker';

export interface FileChecksumOptions {
  [key: string]: unknown;
}

function hashFile(input: File | Blob, signal: AbortSignal, progress: (fraction: number) => void) {
  return new Promise<Extract<ChecksumMessage, { type: 'done' }>>((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const worker = new Worker(new URL('./checksum.worker.ts', import.meta.url), { type: 'module' });
    const onAbort = () => {
      worker.terminate();
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<ChecksumMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progress(message.fraction);
        return;
      }
      finish();
      if (message.type === 'done') resolve(message);
      else reject(new Error(`The file couldn’t be read: ${message.message}`));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The checksum stopped'));
    };
    const file = input instanceof File ? input : new File([input], 'file');
    const job: ChecksumJob = { file };
    worker.postMessage(job);
  });
}

export const fileChecksumEngine: Engine<FileChecksumOptions> = {
  capabilities: () => ({
    supported: typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined',
    reason: 'This browser can’t run the checksum. Try a current Chrome, Edge, Firefox or Safari.',
  }),
  // About 150 MB a second for all three at once.
  estimate: (input) => ({ seconds: Math.max(0.3, input.size / 150_000_000) }),
  async run(input, _opts, ctx): Promise<EngineOutput> {
    const hashes = await hashFile(input, ctx.signal, (fraction) => {
      ctx.progress(fraction, 'Hashing');
    });
    const name = input instanceof File ? input.name : 'file';
    return {
      blob: new Blob([`${hashes.sha256}  ${name}\n`], { type: 'text/plain' }),
      ext: 'sha256',
      name: `${name}.sha256`,
      path: 'WASM',
      details: [
        { label: 'MD5', value: hashes.md5 },
        { label: 'SHA-1', value: hashes.sha1 },
        { label: 'SHA-256', value: hashes.sha256 },
      ],
    };
  },
};
