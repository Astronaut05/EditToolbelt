import type { Cue, Issue } from '@etb/core/subtitles';
import { describe, expect, it } from 'vitest';

import { createClock, cueAt, keptByJson, sameIssues, sameRow } from './cues';

describe('createClock', () => {
  it('starts at 0 and keeps the time it is set to', () => {
    const clock = createClock();
    expect(clock.get()).toBe(0);
    clock.set(12.5);
    expect(clock.get()).toBe(12.5);
  });

  it('tells its listeners of a change, with the new time already in', () => {
    const clock = createClock();
    const seen: number[] = [];
    clock.subscribe(() => seen.push(clock.get()));
    clock.set(1);
    clock.set(2);
    expect(seen).toEqual([1, 2]);
  });

  it('says nothing when the time is set to what it was', () => {
    const clock = createClock();
    let calls = 0;
    clock.subscribe(() => {
      calls += 1;
    });
    clock.set(3);
    clock.set(3);
    expect(calls).toBe(1);
  });

  it('stops telling a listener that left, and keeps telling the others', () => {
    const clock = createClock();
    const calls = { left: 0, stayed: 0 };
    const leave = clock.subscribe(() => {
      calls.left += 1;
    });
    clock.subscribe(() => {
      calls.stayed += 1;
    });
    clock.set(1);
    leave();
    clock.set(2);
    expect(calls).toEqual({ left: 1, stayed: 2 });
  });
});

describe('cueAt', () => {
  const cues: Cue[] = [
    { start: 1000, end: 3000, text: 'One' },
    { start: 3000, end: 5000, text: 'Two' },
    { start: 4500, end: 6000, text: 'Three overlaps' },
  ];

  it('finds the cue on screen: from its start, up to but not at its end', () => {
    expect(cueAt(cues, 1000)).toBe(0);
    expect(cueAt(cues, 2999)).toBe(0);
    expect(cueAt(cues, 3000)).toBe(1);
  });

  it('takes the first of two cues that overlap', () => {
    expect(cueAt(cues, 4700)).toBe(1);
    expect(cueAt(cues, 5500)).toBe(2);
  });

  it('is -1 before, between and after the cues', () => {
    expect(cueAt(cues, 0)).toBe(-1);
    expect(cueAt(cues, 6000)).toBe(-1);
    expect(cueAt([], 0)).toBe(-1);
  });
});

const long: Issue = { index: 2, kind: 'cpl', detail: '48 characters on a line (42 at most)' };
const fast: Issue = { index: 2, kind: 'cps', detail: '21.0 characters a second (17 at most)' };

describe('sameIssues', () => {
  it('compares what the issues say, not which objects they are', () => {
    expect(sameIssues([long, fast], [{ ...long }, { ...fast }])).toBe(true);
    expect(sameIssues([], [])).toBe(true);
  });

  it('sees another count, kind, detail, cue or order', () => {
    expect(sameIssues([long], [long, fast])).toBe(false);
    expect(sameIssues([long], [fast])).toBe(false);
    expect(sameIssues([long], [{ ...long, detail: '50 characters on a line (42 at most)' }])).toBe(
      false,
    );
    expect(sameIssues([long], [{ ...long, index: 3 }])).toBe(false);
    expect(sameIssues([long, fast], [fast, long])).toBe(false);
  });
});

describe('sameRow', () => {
  const cue: Cue = { start: 0, end: 2000, text: 'One' };
  const onType = () => undefined;
  const row = { index: 2, cue, selected: false, issues: [long], onType };

  it('lets a row stay when a check only made its issues again', () => {
    expect(sameRow(row, { ...row, issues: [{ ...long }] })).toBe(true);
  });

  it('renders the row again when its cue, its place, its selection or its issues changed', () => {
    expect(sameRow(row, { ...row, cue: { ...cue } })).toBe(false);
    expect(sameRow(row, { ...row, index: 3 })).toBe(false);
    expect(sameRow(row, { ...row, selected: true })).toBe(false);
    expect(sameRow(row, { ...row, issues: [] })).toBe(false);
    expect(sameRow(row, { ...row, issues: [fast] })).toBe(false);
  });

  it('renders the row again when what it calls changed', () => {
    expect(sameRow(row, { ...row, onType: () => undefined })).toBe(false);
  });
});

describe('keptByJson', () => {
  const back = (cues: Cue[]) => JSON.parse(JSON.stringify(cues)) as unknown;

  it('is true for cues that JSON gives back as they are', () => {
    const cues: Cue[] = [
      { start: 0, end: 1500.5, text: 'Line one\nline “two”' },
      { start: 2000, end: 4000, text: '' },
    ];
    expect(keptByJson(cues)).toBe(true);
    expect(back(cues)).toEqual(cues);
    expect(keptByJson([])).toBe(true);
  });

  it('is false for a time JSON can’t hold', () => {
    const endless: Cue[] = [{ start: 0, end: Infinity, text: 'One' }];
    expect(keptByJson(endless)).toBe(false);
    // What the editor would get back: no end, so no cue.
    expect(back(endless)).toEqual([{ start: 0, end: null, text: 'One' }]);
    expect(keptByJson([{ start: NaN, end: 1000, text: 'One' }])).toBe(false);
  });
});
