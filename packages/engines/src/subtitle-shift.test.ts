import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { planShift, readSubtitles, readTime, subtitleShiftEngine } from './subtitle-shift';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/subtitles/${name}`, import.meta.url)));

const ctx = { progress: () => undefined, signal: new AbortController().signal };

async function run(name: string, opts: Record<string, string>) {
  const out = await subtitleShiftEngine.run(new File([fixture(name)], name), opts, ctx);
  return { ...out, text: await out.blob.text() };
}

describe('reading times', () => {
  it('takes seconds, m:ss and full timecodes', () => {
    expect(readTime('1.25')).toBe(1250);
    expect(readTime('-0,5')).toBe(-500);
    expect(readTime('1:02.5')).toBe(62_500);
    expect(readTime('00:01:02,500')).toBe(62_500);
    expect(readTime('1:00:00')).toBe(3_600_000);
    expect(readTime('soon')).toBeNull();
  });
});

describe('Subtitle Sync engine', () => {
  it('shifts every cue and says so', async () => {
    const out = await run('roundtrip.srt', { mode: 'shift', shift: '1.25', from: '1' });
    expect(out.ext).toBe('srt');
    expect(out.text).toContain('00:00:02,250 --> 00:00:04,750');
    expect(out.notes).toEqual(['Every cue moved +1.250 s']);
    expect(out.details?.[0]?.value).toBe('5 of 5 cues moved');
  });

  it('shifts from a cue on, and clamps at 0:00', async () => {
    const out = await run('roundtrip.srt', { mode: 'shift', shift: '-2', from: '1' });
    expect(out.notes).toContain('1 cue would start before 0:00, so it starts at 0:00');
    const partial = await run('roundtrip.srt', { mode: 'shift', shift: '-0.5', from: '4' });
    expect(partial.notes?.[0]).toBe('Cues 4 to 5 moved −0.500 s');
  });

  it('keeps an ASS file ASS, styles and all', async () => {
    const out = await run('features.ass', { mode: 'rescale', fromFps: '25', toFps: '23.976' });
    expect(out.ext).toBe('ass');
    expect(out.text).toContain('[V4+ Styles]');
    expect(out.notes?.[0]).toMatch(/^Timing rescaled from 25 to 23.976 fps/);
  });

  it('plans two-point sync from cue numbers and typed times', () => {
    const { times } = readSubtitles(fixture('roundtrip.srt'));
    const plan = planShift(
      { mode: 'two-point', cueA: '1', atA: '00:00:03,500', cueB: '5', atB: '1:00:04.100' },
      times,
    );
    expect(plan.note).toMatch(/offset \+2\.500 s, drift/);
    expect(plan.retime({ number: 1, start: 1000, end: 3500 }).start).toBe(3500);
  });

  it('explains what is wrong with the settings', () => {
    const { times } = readSubtitles(fixture('roundtrip.srt'));
    expect(() => planShift({ mode: 'shift', shift: 'later' }, times)).toThrow(/seconds/);
    expect(() => planShift({ mode: 'shift', shift: '1', from: '9' }, times)).toThrow(/1 to 5/);
    expect(() => planShift({ mode: 'rescale', fromFps: '25', toFps: '25' }, times)).toThrow(/same/);
    expect(() =>
      planShift({ mode: 'two-point', cueA: '1', atA: 'x', cueB: '5', atB: '1:00' }, times),
    ).toThrow(/Type when/);
  });

  it('refuses files that are not subtitles', () => {
    expect(() => readSubtitles(new TextEncoder().encode('just some text'))).toThrow(
      /doesn’t look like a subtitle file/,
    );
  });
});
