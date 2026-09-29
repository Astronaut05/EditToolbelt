/**
 * A stand-in engine for building and testing the ToolShell before any real
 * engine exists (docs/12 → M1). It reports progress on a timer, honours the
 * abort signal, and returns the input unchanged.
 */
import type { Engine, EngineOutput } from './types';

export interface DummyOptions {
  /** Total run time in ms (default 1500). */
  durationMs?: number;
  /** Fail with this message instead of finishing, to exercise error states. */
  failWith?: string;
  stages?: string[];
}

export class EngineAbortError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

export const dummyEngine: Engine<DummyOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: (input, opts) => ({
    seconds: (opts.durationMs ?? 1500) / 1000,
    outputBytes: input.size,
  }),
  run(input, opts, ctx) {
    const duration = opts.durationMs ?? 1500;
    const stages = opts.stages ?? ['Working'];
    const started = Date.now();
    return new Promise<EngineOutput>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new EngineAbortError());
        return;
      }
      const timer = setInterval(() => {
        const fraction = Math.min(1, (Date.now() - started) / duration);
        const stage = stages[Math.min(stages.length - 1, Math.floor(fraction * stages.length))];
        ctx.progress(fraction, stage);
        if (fraction < 1) return;
        clearInterval(timer);
        if (opts.failWith) reject(new Error(opts.failWith));
        else
          resolve({
            blob: input,
            ext: input instanceof File ? (input.name.split('.').pop() ?? 'bin') : 'bin',
            path: 'Dummy',
          });
      }, 100);
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearInterval(timer);
          reject(new EngineAbortError());
        },
        { once: true },
      );
    });
  },
};
