import { describe, expect, it } from 'vitest';

import {
  checkCues,
  DEFAULT_RULES,
  editedCue,
  findInCues,
  fixAll,
  fixIssue,
  markRead,
  mergeCues,
  readEncoding,
  readingSpeed,
  replaceInCues,
  rereadCues,
  rewrap,
  sortCues,
  splitCue,
} from './edit';
import { decodeBytes } from './encoding';
import { parseSubtitles } from './parse';
import type { Cue } from './types';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });

describe('checkCues', () => {
  it('finds each broken rule with its numbers', () => {
    const cues = [
      cue(0, 4000, 'A line that is far too long for one subtitle line, really'),
      cue(4000, 4500, 'Fast talker says a lot here'),
      cue(4540, 14_000, 'One\nTwo\nThree'),
      cue(13_000, 15_000, ''),
    ];
    const issues = checkCues(cues);
    expect(issues.map((i) => [i.index, i.kind])).toEqual([
      [0, 'cpl'],
      [1, 'cps'],
      [1, 'short'],
      [1, 'gap'],
      [2, 'lines'],
      [2, 'long'],
      [2, 'overlap'],
      [3, 'empty'],
    ]);
    expect(issues[0]?.detail).toBe('57 characters on a line (42 at most)');
    expect(issues[1]?.detail).toBe('54.0 characters a second (17 at most)');
    expect(issues[3]?.detail).toBe('40 ms before the next cue (83 ms at least)');
    expect(issues[6]?.detail).toBe('Runs 1.00 s into the next cue');
  });

  it('counts reading speed without line breaks or tags, and lets cues touch', () => {
    expect(readingSpeed(cue(0, 1000, '<i>Hello</i>\nworld'))).toBe(10);
    expect(checkCues([cue(0, 2000, 'One'), cue(2000, 4000, 'Two')])).toEqual([]);
  });
});

describe('rewrap', () => {
  it('makes as few lines as fit, as even as they can be', () => {
    expect(rewrap('This sentence is long enough that it needs two lines here', 42)).toBe(
      'This sentence is long enough\nthat it needs two lines here',
    );
    expect(rewrap('Short\none', 42)).toBe('Short one');
  });
});

describe('fixIssue and fixAll', () => {
  it('slows a fast cue down into the free time after it, then before it', () => {
    const cues = [
      cue(0, 1000, 'Before'),
      cue(2000, 2500, 'Fast talker says a lot here'),
      cue(3000, 5000, 'After'),
    ];
    const fixed = fixAll(cues, 'cps');
    // 27 characters at 17 a second need 1.59 s: up to the next cue's start less the gap, then earlier.
    expect(fixed[1]).toEqual(cue(1328, 2917, 'Fast talker says a lot here'));
    expect(checkCues(fixed).filter((i) => i.kind === 'cps')).toEqual([]);
  });

  it('opens a gap or ends an overlap by ending the first cue earlier', () => {
    const cues = [cue(0, 2000, 'One'), cue(1500, 3500, 'Two'), cue(3520, 5000, 'Three')];
    const fixed = fixAll(fixAll(cues, 'overlap'), 'gap');
    expect(fixed.map((c) => [c.start, c.end])).toEqual([
      [0, 1417],
      [1500, 3437],
      [3520, 5000],
    ]);
    expect(checkCues(fixed)).toEqual([]);
  });

  it('starts the next cue later when the first would be too short, unless that one would be', () => {
    // The first can't end 83 ms before the next without dropping under 5/6 s: the next starts later.
    const moved = fixAll([cue(0, 850, 'One'), cue(900, 3000, 'Two')], 'gap');
    expect(moved.map((c) => [c.start, c.end])).toEqual([
      [0, 850],
      [933, 3000],
    ]);
    // Neither has room: the list stays as it was, and the issue stays marked.
    const tight = [cue(0, 850, 'One'), cue(900, 1600, 'Two')];
    expect(fixAll(tight, 'gap')).toEqual(tight);
    expect(checkCues(tight).some((i) => i.kind === 'gap')).toBe(true);
  });

  it('leaves an overlap it can’t fix without making a cue too short', () => {
    // A runs right over B: B can't start after A and still last 5/6 s.
    const cues = [cue(0, 5000, 'A long cue over the next'), cue(500, 1000, 'B')];
    const [issue] = checkCues(cues).filter((i) => i.kind === 'overlap');
    if (!issue) throw new Error('no overlap found');
    expect(fixIssue(cues, issue)).toEqual(cues);
    expect(fixAll(cues, 'overlap')).toEqual(cues);
  });

  it('rewraps long lines, trims long cues and drops empty ones', () => {
    const cues = [
      cue(0, 9000, 'This sentence is long enough that it needs two lines here'),
      cue(9500, 11_000, ' '),
    ];
    let fixed = fixAll(cues, 'cpl');
    fixed = fixAll(fixed, 'long');
    fixed = fixAll(fixed, 'empty');
    expect(fixed).toEqual([
      cue(0, 7000, 'This sentence is long enough\nthat it needs two lines here'),
    ]);
  });

  it('uses all the room there is when that isn’t enough, and the issue stays', () => {
    const cues = [
      cue(0, 1000, 'A'),
      cue(1100, 1200, 'Way too much to read here'),
      cue(1300, 2000, 'C'),
    ];
    const fixed = fixAll(cues, 'cps');
    expect(fixed[1]).toEqual(cue(1083, 1217, 'Way too much to read here'));
    expect(checkCues(fixed).some((i) => i.kind === 'cps' && i.index === 1)).toBe(true);
  });
});

describe('split, merge and sort', () => {
  it('splits a two-line cue between its lines, a minimum gap apart', () => {
    const cues = [cue(1000, 5000, 'First line\nsecond line')];
    expect(splitCue(cues, 0, 3000)).toEqual([
      cue(1000, 3000 - DEFAULT_RULES.minGap, 'First line'),
      cue(3000, 5000, 'second line'),
    ]);
  });

  it('splits one line by its words in proportion to the time', () => {
    expect(splitCue([cue(0, 4000, 'one two three four')], 0, 1000).map((c) => c.text)).toEqual([
      'one',
      'two three four',
    ]);
    // Outside the cue: nothing to split.
    expect(splitCue([cue(0, 4000, 'x y')], 0, 5000)).toHaveLength(1);
  });

  it('won’t split a cue of one word into an empty cue', () => {
    for (const text of ['Hello', '<i>Hello</i>', 'Hello\n', '  Hello  ']) {
      const cues = [cue(0, 4000, text)];
      expect(splitCue(cues, 0, 2000), JSON.stringify(text)).toEqual(cues);
    }
    // Two lines, one of them empty, split by words.
    expect(splitCue([cue(0, 4000, 'One two\n')], 0, 2000).map((c) => c.text)).toEqual([
      'One',
      'two',
    ]);
  });

  it('merges a cue with the next, and sorts by start', () => {
    expect(
      mergeCues([cue(0, 1000, 'One'), cue(1100, 2000, 'Two'), cue(3000, 4000, 'Three')], 0),
    ).toEqual([cue(0, 2000, 'One\nTwo'), cue(3000, 4000, 'Three')]);
    expect(sortCues([cue(500, 900, 'b'), cue(0, 400, 'a')]).map((c) => c.text)).toEqual(['a', 'b']);
  });
});

describe('find and replace', () => {
  const cues = [
    cue(0, 1000, 'The cat sat.'),
    cue(1000, 2000, 'Concatenate the CAT'),
    cue(2000, 3000, 'Dog'),
  ];

  it('finds every match, with case and whole-word options', () => {
    expect(findInCues(cues, 'cat')).toHaveLength(3);
    expect(findInCues(cues, 'cat', { matchCase: true })).toEqual([
      { index: 0, from: 4, to: 7 },
      { index: 1, from: 3, to: 6 },
    ]);
    expect(findInCues(cues, 'cat', { wholeWord: true }).map((m) => m.index)).toEqual([0, 1]);
    expect(findInCues(cues, '')).toEqual([]);
  });

  it('replaces literally, counting the replacements', () => {
    const { cues: out, count } = replaceInCues(cues, 'cat', '$1 dog', { wholeWord: true });
    expect(count).toBe(2);
    expect(out.map((c) => c.text)).toEqual(['The $1 dog sat.', 'Concatenate the $1 dog', 'Dog']);
    // Regex characters in the query are just characters.
    expect(replaceInCues([cue(0, 1, 'a.b axb')], '.', '!').cues[0]?.text).toBe('a!b axb');
  });
});

describe('reading the text again in another encoding', () => {
  /** An SRT of `lines` written in `encoding`'s bytes. */
  const srt = (lines: string[], encoding: 'windows-1251' | 'utf-8') => {
    const text = lines
      .map(
        (line, i) =>
          `${String(i + 1)}\n00:00:0${String(i)},000 --> 00:00:0${String(i)},900\n${line}\n`,
      )
      .join('\n');
    if (encoding === 'utf-8') return new TextEncoder().encode(text);
    // Cyrillic in Windows-1251: а-я are 0xE0-0xFF, А-Я 0xC0-0xDF.
    return Uint8Array.from(text, (c) => {
      const code = c.charCodeAt(0);
      if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
      return code;
    });
  };
  /** The file read as a page reads it, in a given encoding, each cue marked with it. */
  const read = (bytes: Uint8Array, encoding: 'windows-1251' | 'windows-1252' | 'utf-8') => {
    const { text } = decodeBytes(bytes, encoding);
    return markRead(parseSubtitles(text, 'srt').cues, encoding);
  };

  it('turns a Cyrillic file read as Western back into Cyrillic, and back again', () => {
    const bytes = srt(['Привет, мир', 'Как дела?'], 'windows-1251');
    const wrong = read(bytes, 'windows-1252');
    expect(wrong[0]?.text).toBe('Ïðèâåò, ìèð');
    expect(readEncoding(wrong)).toBe('windows-1252');
    const right = rereadCues(wrong, 'windows-1251');
    expect(right?.map((c) => c.text)).toEqual(['Привет, мир', 'Как дела?']);
    expect(right?.map((c) => [c.start, c.end])).toEqual(wrong.map((c) => [c.start, c.end]));
    expect(readEncoding(right ?? [])).toBe('windows-1251');
    // And back: nothing is lost either way.
    expect(rereadCues(right ?? [], 'windows-1252')?.map((c) => c.text)).toEqual(
      wrong.map((c) => c.text),
    );
  });

  it('reads UTF-8 shown as Western as UTF-8 again', () => {
    const wrong = read(srt(['Café crème'], 'utf-8'), 'windows-1252');
    expect(wrong[0]?.text).toBe('CafÃ© crÃ¨me');
    expect(rereadCues(wrong, 'utf-8')?.[0]?.text).toBe('Café crème');
  });

  it('refuses UTF-8 for text that isn’t, rather than lose it', () => {
    const cues = read(srt(['Привет'], 'windows-1251'), 'windows-1251');
    expect(rereadCues(cues, 'utf-8')).toBeNull();
  });

  it('leaves cues typed or edited since as they are', () => {
    const cues = read(srt(['Ïðèâåò', 'Ïîêà'], 'windows-1251'), 'windows-1252');
    const typed = [editedCue({ ...cues[0], text: 'Hello' } as Cue), ...cues.slice(1)];
    expect(rereadCues(typed, 'windows-1251')?.map((c) => c.text)).toEqual(['Hello', 'Пока']);
    // A cue with no mark: nothing to read again.
    expect(readEncoding([cue(0, 1000, 'Typed')])).toBeNull();
    // UTF-16 files aren't offered: their timing lines wouldn't read the same.
    expect(readEncoding(markRead([cue(0, 1000, 'Text')], 'utf-16le'))).toBeNull();
  });
});
