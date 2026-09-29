import { describe, expect, it } from 'vitest';

import { dummyEngine } from './dummy';

describe('dummy engine', () => {
  it('reports progress and returns the input', async () => {
    const seen: number[] = [];
    const input = new File(['abc'], 'photo.png', { type: 'image/png' });
    const out = await dummyEngine.run(
      input,
      { durationMs: 250 },
      {
        progress: (p) => seen.push(p),
        signal: new AbortController().signal,
      },
    );
    expect(out.blob).toBe(input);
    expect(out.ext).toBe('png');
    expect(seen.at(-1)).toBe(1);
  });

  it('stops on abort', async () => {
    const controller = new AbortController();
    const run = dummyEngine.run(
      new Blob(['x']),
      { durationMs: 5000 },
      {
        progress: () => undefined,
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(run).rejects.toThrow('Cancelled');
  });

  it('fails when asked to', async () => {
    const run = dummyEngine.run(
      new Blob(['x']),
      { durationMs: 100, failWith: 'Broken file' },
      {
        progress: () => undefined,
        signal: new AbortController().signal,
      },
    );
    await expect(run).rejects.toThrow('Broken file');
  });
});
