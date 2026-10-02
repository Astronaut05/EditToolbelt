import { describe, expect, it } from 'vitest';

import { cuesFromJson, readSubtitleFile, subtitleEditEngine } from './subtitles';

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined });

describe('cuesFromJson', () => {
  it('reads the editor’s cues and keeps only well-formed ones', () => {
    const json = JSON.stringify([
      { start: 0, end: 1000, text: 'One' },
      { start: '0', end: 1000, text: 'Times as text' },
      { start: 0, end: 1000 },
      null,
      'cue',
      { start: 2000, end: 3000, text: 'Two', read: 'utf-8' },
    ]);
    expect(cuesFromJson(json)).toEqual([
      { start: 0, end: 1000, text: 'One' },
      { start: 2000, end: 3000, text: 'Two', read: 'utf-8' },
    ]);
  });

  it('gives none for no option, broken JSON or something that isn’t a list', () => {
    expect(cuesFromJson(undefined)).toEqual([]);
    expect(cuesFromJson('')).toEqual([]);
    expect(cuesFromJson('[{"start": 0,')).toEqual([]);
    expect(cuesFromJson('{"start": 0, "end": 1, "text": "x"}')).toEqual([]);
  });
});

describe('the Subtitle Editor’s file', () => {
  it('is read with its encoding found, each cue marked with it for "Read as"', async () => {
    // "Café" in Windows-1252: not UTF-8, so the code page.
    const bytes = Uint8Array.from('1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9 au lait\n', (c) =>
      c.charCodeAt(0),
    );
    const read = await readSubtitleFile(new File([bytes], 'menu.srt'));
    expect(read.format).toBe('srt');
    expect(read.encoding).toBe('windows-1252');
    expect(read.cues).toEqual([
      { start: 1000, end: 2000, text: 'Café au lait', read: 'windows-1252' },
    ]);
  });

  it('is saved from the cues in the options, UTF-8, with the mark left out', async () => {
    const out = await subtitleEditEngine.run(
      new File([''], 'menu.srt'),
      {
        cues: JSON.stringify([{ start: 1000, end: 2000, text: 'Café', read: 'windows-1252' }]),
        format: 'srt',
        bom: 'yes',
      },
      ctx(),
    );
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('1\n00:00:01,000 --> 00:00:02,000\nCafé\n');
    await expect(
      subtitleEditEngine.run(new File([''], 'a.srt'), { cues: '[]' }, ctx()),
    ).rejects.toThrow(/no cues/);
  });
});
