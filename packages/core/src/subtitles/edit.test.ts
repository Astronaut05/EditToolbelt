import { describe, expect, it } from 'vitest';

import {
  checkCues,
  DEFAULT_RULES,
  findInCues,
  fixAll,
  mergeCues,
  readingSpeed,
  replaceInCues,
  rewrap,
  sortCues,
  splitCue,
} from './edit';
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
