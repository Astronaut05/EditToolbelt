import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { subtitleEngine } from './subtitles';

const fixture = (name: string) =>
  new File(
    [readFileSync(fileURLToPath(new URL(`../../../fixtures/subtitles/${name}`, import.meta.url)))],
    name,
  );

const ctx = (signal = new AbortController().signal) => ({ signal, progress: () => undefined });

describe('subtitleEngine', () => {
  it('converts a file and reports what changed', async () => {
    const out = await subtitleEngine.run(fixture('features.ass'), { to: 'srt' }, ctx());
    expect(out.ext).toBe('srt');
    expect(out.blob.type).toBe('application/x-subrip;charset=utf-8');
    expect(await out.blob.text()).toContain(
      '1\n00:00:01,000 --> 00:00:04,250\n<i>Hello</i>, world.',
    );
    expect(out.notes).toEqual([
      '1 style override removed',
      '1 comment line skipped',
      '1 vector drawing skipped',
    ]);
    expect(out.details).toEqual([
      { label: 'Cues', value: '4 cues' },
      { label: 'Formats', value: 'ASS → SRT' },
    ]);
  });

  it('writes a BOM when asked and falls back to safe defaults', async () => {
    const out = await subtitleEngine.run(
      fixture('roundtrip.srt'),
      { to: 'nonsense', bom: 'yes' },
      ctx(),
    );
    expect(out.ext).toBe('srt');
    expect([...new Uint8Array(await out.blob.arrayBuffer()).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });

  it('fails with a readable message, and stops when cancelled', async () => {
    await expect(
      subtitleEngine.run(new File(['just words'], 'notes.txt'), { to: 'srt' }, ctx()),
    ).rejects.toThrow(/doesn’t look like/);
    const abort = new AbortController();
    abort.abort();
    await expect(
      subtitleEngine.run(fixture('roundtrip.srt'), { to: 'vtt' }, ctx(abort.signal)),
    ).rejects.toThrow('Cancelled');
  });
});
