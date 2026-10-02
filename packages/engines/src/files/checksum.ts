/**
 * U04 File Checksum (tools/utility.md): MD5, SHA-1 and SHA-256 of a file,
 * streamed in two workers (./checksum-job.ts) so multi-GB media works and
 * the slowest hash sets the pace, not all three in turn. The result's
 * download is the file's line for `sha256sum -c`; the page checks pasted
 * hashes against the three values without hashing again.
 */
import type { checksum } from '@etb/core';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import type { ChecksumJob, ChecksumMessage } from './checksum-job';

type HashAlgo = checksum.HashAlgo;

export interface FileChecksumOptions {
  [key: string]: unknown;
}

/**
 * What each worker hashes. SHA-256 alone takes about as long as MD5 and SHA-1
 * together (hash-wasm in Chrome: about 180 MB a second each way). The first
 * worker reads the file and sends the pieces on.
 */
const GROUPS: readonly (readonly HashAlgo[])[] = [['md5', 'sha1'], ['sha256']];

/** Idle workers are let go after this long, ms. */
const IDLE_MS = 10_000;

interface Member {
  worker: Worker;
  algos: readonly HashAlgo[];
}

/** Workers kept between files, so a batch doesn't start them and compile their WebAssembly for every file. */
let idle: Member[] | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

const spawn = () =>
  new Worker(new URL('./checksum.worker.ts', import.meta.url), { type: 'module' });

function takeTeam(): Member[] {
  const kept = idle;
  idle = undefined;
  clearTimeout(idleTimer);
  return kept ?? GROUPS.map((algos) => ({ worker: spawn(), algos }));
}

function giveBack(team: Member[]) {
  if (idle) {
    for (const { worker } of team) worker.terminate();
    return;
  }
  idle = team;
  idleTimer = setTimeout(() => {
    if (idle !== team) return;
    idle = undefined;
    for (const { worker } of team) worker.terminate();
  }, IDLE_MS);
}

function hashFile(file: File, signal: AbortSignal, progress: (fraction: number) => void) {
  return new Promise<Partial<Record<HashAlgo, string>>>((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const team = takeTeam();
    const release = () => {
      signal.removeEventListener('abort', onAbort);
      for (const { worker } of team) {
        worker.onmessage = null;
        worker.onerror = null;
      }
    };
    const stop = (error: Error) => {
      release();
      for (const { worker } of team) worker.terminate();
      reject(error);
    };
    const onAbort = () => {
      stop(new EngineAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const hashes: Partial<Record<HashAlgo, string>> = {};
    let left = team.length;
    for (const { worker } of team) {
      worker.onmessage = (event: MessageEvent<ChecksumMessage>) => {
        const message = event.data;
        if (message.type === 'progress') {
          progress(message.fraction);
        } else if (message.type === 'error') {
          stop(new Error(`The file couldn’t be read: ${message.message}`));
        } else {
          Object.assign(hashes, message.hashes);
          left -= 1;
          if (left > 0) return;
          release();
          giveBack(team);
          resolve(hashes);
        }
      };
      worker.onerror = (event) => {
        stop(new Error(event.message || 'The checksum stopped'));
      };
    }
    // The first worker reads the file: it gets one end of a channel to each of the others.
    const ends: MessagePort[] = [];
    for (const { worker, algos } of team.slice(1)) {
      const { port1, port2 } = new MessageChannel();
      ends.push(port1);
      worker.postMessage({ algos, ports: [port2] } satisfies ChecksumJob, [port2]);
    }
    const [reader] = team;
    reader?.worker.postMessage(
      { algos: reader.algos, file, ports: ends } satisfies ChecksumJob,
      ends,
    );
  });
}

export const fileChecksumEngine: Engine<FileChecksumOptions> = {
  capabilities: () => ({
    supported: typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined',
    reason: 'This browser can’t run the checksum. Try a current Chrome, Edge, Firefox or Safari.',
  }),
  // About 150 MB a second for all three: SHA-256’s pace, with MD5 and SHA-1 alongside.
  estimate: (input) => ({ seconds: Math.max(0.3, input.size / 150_000_000) }),
  async run(input, _opts, ctx): Promise<EngineOutput> {
    const file = input instanceof File ? input : new File([input], 'file');
    const hashes = await hashFile(file, ctx.signal, (fraction) => {
      ctx.progress(fraction, 'Hashing');
    });
    const name = input instanceof File ? input.name : 'file';
    return {
      blob: new Blob([`${hashes.sha256 ?? ''}  ${name}\n`], { type: 'text/plain' }),
      ext: 'sha256',
      name: `${name}.sha256`,
      path: 'WASM',
      details: [
        { label: 'MD5', value: hashes.md5 ?? '' },
        { label: 'SHA-1', value: hashes.sha1 ?? '' },
        { label: 'SHA-256', value: hashes.sha256 ?? '' },
      ],
    };
  },
};
