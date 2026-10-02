import { describe, expect, it } from 'vitest';

import {
  changeCase,
  DEFAULT_RULES,
  formatDate,
  nameProblems,
  planRenames,
  RenameError,
  splitName,
  type RenameFile,
  type RenameRules,
} from './rename';

const at = (iso: string) => new Date(iso);
const file = (name: string, extra: Partial<RenameFile> = {}): RenameFile => ({
  name,
  modified: at('2026-01-02T03:04:05'),
  ...extra,
});
const rules = (change: Partial<RenameRules>): RenameRules => ({ ...DEFAULT_RULES, ...change });
const TODAY = at('2026-10-01T12:00:00');
const names = (files: RenameFile[], change: Partial<RenameRules>) =>
  planRenames(files, rules(change), TODAY).map((plan) => plan.to);

describe('splitName', () => {
  it('splits at the last dot, but not a leading one', () => {
    expect(splitName('clip.final.MP4')).toEqual(['clip.final', 'MP4']);
    expect(splitName('.env')).toEqual(['.env', '']);
    expect(splitName('README')).toEqual(['README', '']);
    expect(splitName('trailing.')).toEqual(['trailing.', '']);
  });
});

describe('planRenames', () => {
  it('runs the rule chain on 100 names', () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      file(i % 2 === 0 ? `IMG_${String(4000 + i)}.JPG` : `IMG_${String(4000 + i)} (copy).jpeg`),
    );
    const out = planRenames(
      files,
      rules({
        find: 'IMG_',
        replaceWith: '',
        remove: ['brackets'],
        prefix: 'Trip ',
        case: 'kebab',
        counter: true,
        counterStart: 1,
        counterPad: 3,
        counterWhere: 'end',
        separator: '_',
        extension: 'jpg',
        extensionCase: 'lower',
      }),
      TODAY,
    );
    expect(out).toHaveLength(100);
    // Case comes before the prefix, so "Trip " is added as typed.
    for (const [i, plan] of out.entries()) {
      expect(plan.to).toBe(`Trip ${String(4000 + i)}_${String(i + 1).padStart(3, '0')}.jpg`);
      expect(plan.problems).toEqual([]);
    }
  });

  it('flags names that clash, ignoring case', () => {
    const out = planRenames(
      [file('a.jpg'), file('A.JPG'), file('b.jpg')],
      rules({ extensionCase: 'lower' }),
      TODAY,
    );
    expect(out.map((p) => p.problems)).toEqual([['duplicate'], ['duplicate'], []]);
  });

  it('uses the date the photo was taken, or says it is missing', () => {
    const out = planRenames(
      [file('a.jpg', { taken: at('2025-07-14T09:30:15') }), file('b.jpg')],
      rules({ date: 'taken', dateFormat: 'YYYY-MM-DD_HH-mm-ss', dateWhere: 'replace' }),
      TODAY,
    );
    expect(out.map((p) => p.to)).toEqual(['2025-07-14_09-30-15.jpg', '2026-01-02_03-04-05.jpg']);
    expect(out[1]?.problems).toEqual(['no-date']);
  });

  it('counts in the order asked for', () => {
    const files = [
      file('c.jpg', { taken: at('2025-01-03T00:00:00') }),
      file('a10.jpg', { taken: at('2025-01-01T00:00:00') }),
      file('a9.jpg', { taken: at('2025-01-02T00:00:00') }),
    ];
    const by = (sortBy: RenameRules['sortBy']) =>
      planRenames(
        files,
        rules({ counter: true, counterWhere: 'start', counterPad: 1, sortBy }),
        TODAY,
      ).map((p) => p.to);
    expect(by('added')).toEqual(['1_c.jpg', '2_a10.jpg', '3_a9.jpg']);
    // Numbers in names sort as numbers: a9 before a10.
    expect(by('name')).toEqual(['1_a9.jpg', '2_a10.jpg', '3_c.jpg']);
    expect(by('taken')).toEqual(['1_a10.jpg', '2_a9.jpg', '3_c.jpg']);
  });

  it('steps, pads and adds today', () => {
    expect(
      names([file('x.png'), file('y.png')], {
        counter: true,
        counterStart: 10,
        counterStep: 5,
        counterPad: 4,
        date: 'today',
        dateFormat: 'YYYYMMDD',
        dateWhere: 'start',
        separator: '-',
      }),
    ).toEqual(['20261001-x-0010.png', '20261001-y-0015.png']);
  });

  it('finds with a pattern, with or without case', () => {
    expect(names([file('Take_01_FINAL.wav')], { find: 'final', replaceWith: 'v2' })).toEqual([
      'Take_01_v2.wav',
    ]);
    expect(
      names([file('Take_01_FINAL.wav')], { find: 'final', replaceWith: 'v2', matchCase: true }),
    ).toEqual(['Take_01_FINAL.wav']);
    expect(
      names([file('Take_01_FINAL.wav')], {
        find: '^Take_(\\d+)_.*$',
        replaceWith: 'shot-$1',
        regex: true,
      }),
    ).toEqual(['shot-01.wav']);
    expect(() => names([file('a.wav')], { find: '(', regex: true })).toThrow(RenameError);
    // Without regex, the pattern's characters are taken as they are.
    expect(names([file('a.b(1).wav')], { find: '(1)', replaceWith: '' })).toEqual(['a.b.wav']);
  });

  it('removes spaces, digits, other characters and brackets', () => {
    expect(names([file('My Clip 2 (old) [cut] #1!.mov')], { remove: ['brackets'] })).toEqual([
      'My Clip 2 #1!.mov',
    ]);
    expect(names([file('My Clip 2 #1!.mov')], { remove: ['special', 'spaces'] })).toEqual([
      'MyClip21.mov',
    ]);
    expect(names([file('My Clip 2.mov')], { remove: ['digits'] })).toEqual(['My Clip .mov']);
  });

  it('flags names a disk will not take', () => {
    expect(names([file('a.jpg')], { find: 'a', replaceWith: '' })).toEqual(['.jpg']);
    expect(
      planRenames([file('a.jpg')], rules({ find: 'a', replaceWith: '' }), TODAY)[0]?.problems,
    ).toEqual(['empty']);
    expect(nameProblems('a:b.jpg')).toEqual(['characters']);
    expect(nameProblems('CON.txt')).toEqual(['reserved']);
    expect(nameProblems('name.')).toEqual(['ends']);
    expect(nameProblems(`${'é'.repeat(130)}.jpg`)).toEqual(['long']);
  });
});

describe('changeCase and formatDate', () => {
  it('changes case', () => {
    expect(changeCase('myGreat clip_FINAL', 'kebab')).toBe('my-great-clip-final');
    expect(changeCase('myGreat clip_FINAL', 'snake')).toBe('my_great_clip_final');
    expect(changeCase('the big (old) take', 'title')).toBe('The Big (Old) Take');
    expect(changeCase('THE BIG TAKE', 'sentence')).toBe('The big take');
  });

  it('formats dates in local time', () => {
    const d = at('2026-03-04T05:06:07');
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-03-04');
    expect(formatDate(d, 'YYYYMMDD_HHmmss')).toBe('20260304_050607');
    expect(formatDate(d, 'DD-MM-YYYY')).toBe('04-03-2026');
  });
});
