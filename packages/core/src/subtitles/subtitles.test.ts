import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { convertBytes, convertText } from './convert';
import { decodeBytes, detectEncoding, encodeUtf8 } from './encoding';
import { detectFormat, parseAss, parseSbv, parseSrt, parseVtt } from './parse';
import { formatAssTime, formatSrtTime, parseTime } from './time';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/subtitles/${name}`, import.meta.url)));
const text = (name: string) => fixture(name).toString('utf8');

function converted(input: string, to: Parameters<typeof convertText>[1]['to'], fileName?: string) {
  const result = convertText(input, { to, fileName });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('time', () => {
  it('reads tolerant timestamps', () => {
    expect(parseTime('01:02:03,456')).toBe(3_723_456);
    expect(parseTime('01:02:03.456')).toBe(3_723_456);
    expect(parseTime('02:03.456')).toBe(123_456);
    expect(parseTime('0:00:01.5')).toBe(1_500);
    expect(parseTime('0:00:01.05')).toBe(1_050);
    expect(parseTime('00:61:00,000')).toBeNull();
    expect(parseTime('nope')).toBeNull();
  });

  it('writes strict ones', () => {
    expect(formatSrtTime(3_723_456)).toBe('01:02:03,456');
    expect(formatAssTime(3_723_456)).toBe('1:02:03.46');
    expect(formatAssTime(999)).toBe('0:00:01.00');
  });
});

describe('detection', () => {
  it('knows each format by its content', () => {
    expect(detectFormat(text('roundtrip.srt'))).toBe('srt');
    expect(detectFormat(text('features.vtt'))).toBe('vtt');
    expect(detectFormat(text('features.ass'))).toBe('ass');
    expect(detectFormat(text('basic.sbv'))).toBe('sbv');
    expect(detectFormat(text('messy.srt'))).toBe('srt');
    expect(detectFormat('hello', 'notes.txt')).toBeNull();
  });
});

describe('parsing fixtures (tools/subtitles-and-time.md → T01 tests)', () => {
  it('SRT: cue count, times and tags', () => {
    const { cues } = parseSrt(text('roundtrip.srt'));
    expect(cues).toHaveLength(5);
    expect(cues[1]).toEqual({
      start: 3_600,
      end: 6_250,
      text: '<i>This line is in italics</i>\nand this one is not.',
    });
    expect(cues[3]?.start).toBe(3_599_001);
  });

  it('SRT: survives a BOM, CRLF, missing blank lines and odd times', () => {
    const { cues, dropped } = parseSrt(text('messy.srt'));
    expect(cues.map((cue) => [cue.start, cue.end])).toEqual([
      [1_500, 3_250],
      [4_000, 5_000],
      [6_000, 7_000],
      [8_000, 8_000],
    ]);
    expect(cues[0]?.text).toBe('Dot and comma times');
    expect(cues[1]?.text).toBe('No blank line before this cue');
    expect(dropped).toEqual({ srtFont: 1, srtPosition: 1, emptyCues: 1 });
  });

  it('WebVTT: settings, voices, classes and timestamps are removed and counted', () => {
    const { cues, dropped } = parseVtt(text('features.vtt'));
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start: 1_000, end: 4_000, text: 'Places, everyone.' });
    expect(cues[1]?.text).toBe('Yellow words and <i>loud italics</i>.');
    expect(cues[2]?.text).toBe('Karaoke one two\nFish & chips <3');
    expect(dropped).toEqual({
      vttSettings: 1,
      vttVoices: 1,
      vttClasses: 1,
      vttTimestamps: 2,
      vttBlocks: 1,
    });
  });

  it('ASS: order by time, line breaks, italics by tag and by style, drawings skipped', () => {
    const { cues, dropped } = parseAss(text('features.ass'));
    expect(cues.map((cue) => cue.start)).toEqual([1_000, 5_000, 8_000, 10_500]);
    expect(cues[0]?.text).toBe('<i>Hello</i>, world.\nA new line, with commas.');
    expect(cues[0]?.end).toBe(4_250);
    expect(cues[2]?.text).toBe('<i>I think this is italic by style.</i>');
    expect(cues[3]?.text).toBe('Top of the frame, <b>bold</b>.');
    expect(dropped).toEqual({ assComments: 1, assOverrides: 1, assDrawings: 1 });
  });

  it('ASS without styling keeps plain text and counts every override block', () => {
    const { cues, dropped } = parseAss(text('features.ass'), false);
    expect(cues[0]?.text).toBe('Hello, world.\nA new line, with commas.');
    // {\i1} {\i0} {\pos…\fad…} {\b1} {\b0}
    expect(dropped.assOverrides).toBe(5);
  });

  it('SBV', () => {
    const { cues } = parseSbv(text('basic.sbv'));
    expect(cues).toHaveLength(3);
    expect(cues[2]).toEqual({ start: 3_600_000, end: 3_601_500, text: 'One hour in.' });
  });
});

describe('converting', () => {
  it('SRT → VTT → SRT is identical', () => {
    const srt = text('roundtrip.srt');
    const vtt = converted(srt, 'vtt').text;
    expect(vtt.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n')).toBe(true);
    expect(vtt).toContain('Timecode 01:02:03;04 &amp; a <b>bold</b> word.');
    expect(converted(vtt, 'srt').text).toBe(srt);
  });

  it('every readable format converts to every writable one and back to the same cues', () => {
    for (const name of ['roundtrip.srt', 'features.vtt', 'basic.sbv']) {
      const source = parseText(text(name));
      for (const to of ['srt', 'vtt', 'sbv'] as const) {
        const there = converted(text(name), to);
        const back = parseText(there.text);
        expect(
          back.map((cue) => [cue.start, cue.end]),
          `${name} → ${to}`,
        ).toEqual(source.map((cue) => [cue.start, cue.end]));
      }
    }
  });

  it('ASS → SRT reports what was dropped', () => {
    const result = converted(text('features.ass'), 'srt');
    expect(result.cues).toBe(4);
    expect(result.notes).toEqual([
      '1 style override removed',
      '1 comment line skipped',
      '1 vector drawing skipped',
    ]);
    expect(result.text).toContain('<i>Hello</i>, world.\nA new line, with commas.');
  });

  it('SRT → ASS writes a default style and rounds to centiseconds', () => {
    const result = converted(text('roundtrip.srt'), 'ass');
    expect(result.text).toContain('[V4+ Styles]');
    expect(result.text).toContain(
      'Dialogue: 0,0:00:03.60,0:00:06.25,Default,,0,0,0,,{\\i1}This line is in italics{\\i0}\\Nand this one is not.',
    );
    expect(result.notes).toEqual([
      '2 cues rounded to hundredths of a second, the finest ASS stores',
    ]);
    // And back: same text, times within 10 ms.
    const back = parseAss(result.text).cues;
    expect(back[1]?.text).toBe('<i>This line is in italics</i>\nand this one is not.');
  });

  it('formats without styling say so', () => {
    const result = converted(text('roundtrip.srt'), 'sbv');
    expect(result.notes).toEqual(['3 cues lost italic, bold or underline: SBV has no styling']);
    const txt = converted(text('roundtrip.srt'), 'txt');
    expect(txt.text.split('\n\n')[0]).toBe('Rolling in three, two, one.');
  });

  it('explains files it cannot read', () => {
    expect(convertText('just some words', { to: 'srt' })).toMatchObject({ ok: false });
    expect(convertText('WEBVTT\n\nNOTE nothing here\n', { to: 'srt' })).toMatchObject({
      ok: false,
    });
  });
});

describe('encodings', () => {
  const srt = text('roundtrip.srt');

  /** Encodes text in a single-byte code page, using TextDecoder's own table backwards. */
  function legacy(value: string, encoding: 'windows-1251' | 'windows-1252'): Uint8Array {
    const table = new Map<string, number>();
    const decoder = new TextDecoder(encoding);
    for (let byte = 0; byte < 256; byte += 1)
      table.set(decoder.decode(new Uint8Array([byte])), byte);
    return Uint8Array.from(Array.from(value, (char) => table.get(char) ?? 0x3f));
  }

  it('detects UTF-8 with and without a BOM, and UTF-16 with and without one', () => {
    expect(detectEncoding(encodeUtf8(srt))).toBe('utf-8');
    expect(detectEncoding(encodeUtf8(srt, true))).toBe('utf-8');
    const le = Buffer.from(`\uFEFF${srt}`, 'utf16le');
    expect(detectEncoding(le)).toBe('utf-16le');
    expect(detectEncoding(Buffer.from(srt, 'utf16le'))).toBe('utf-16le');
    expect(decodeBytes(le).text).toBe(srt);
  });

  it('tells Windows-1251 from Windows-1252', () => {
    const russian = '1\n00:00:01,000 --> 00:00:02,000\nПривет, как дела? Всё хорошо.\n';
    const french = '1\n00:00:01,000 --> 00:00:02,000\nÇa va très bien, merci. Déjà vu.\n';
    expect(decodeBytes(legacy(russian, 'windows-1251'))).toEqual({
      text: russian,
      encoding: 'windows-1251',
    });
    expect(decodeBytes(legacy(french, 'windows-1252'))).toEqual({
      text: french,
      encoding: 'windows-1252',
    });
  });

  it('converts bytes to UTF-8 and says what it read', () => {
    const russian = '1\n00:00:01,000 --> 00:00:02,000\nПривет, как дела?\n';
    const result = convertBytes(legacy(russian, 'windows-1251'), { to: 'vtt', bom: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.notes[0]).toBe('Read as Windows-1251 (Cyrillic), written as UTF-8');
    expect([...result.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(result.bytes)).toContain('Привет, как дела?');
  });
});

function parseText(input: string) {
  const format = detectFormat(input);
  if (format === 'srt') return parseSrt(input).cues;
  if (format === 'vtt') return parseVtt(input).cues;
  if (format === 'sbv') return parseSbv(input).cues;
  throw new Error(`unexpected ${String(format)}`);
}
