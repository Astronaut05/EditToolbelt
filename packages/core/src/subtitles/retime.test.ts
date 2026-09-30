import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSubtitles } from './parse';
import { cueTimes, rescale, retimeText, shiftBy, twoPoint } from './retime';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../fixtures/subtitles/${name}`, import.meta.url)),
    'utf8',
  );

describe('retime in place', () => {
  it('shifts SRT times and keeps everything else', () => {
    const srt = fixture('roundtrip.srt');
    const out = retimeText(srt, 'srt', shiftBy(1250));
    expect(out).toMatchObject({ cues: 5, changed: 5, clamped: 0 });
    expect(out.text).toContain('00:00:02,250 --> 00:00:04,750\nRolling in three, two, one.');
    expect(out.text).toContain('01:00:03,350 --> 01:00:05,250\n<u>Last</u> cue.');
    // Only the timing lines differ.
    const before = srt.replace(/\r\n/g, '\n').split('\n');
    const after = out.text.split('\n');
    expect(
      after.filter((line, i) => line !== before[i]).every((line) => line.includes('-->')),
    ).toBe(true);
  });

  it('shifts only from a cue onward', () => {
    const out = retimeText(fixture('roundtrip.srt'), 'srt', shiftBy(-500, 3));
    const times = cueTimes(out.text, 'srt');
    expect(times.map((t) => t.start)).toEqual([1000, 3600, 5800, 3_598_501, 3_601_600]);
    expect(out.changed).toBe(3);
  });

  it('clamps cues pushed before 0:00 and counts them', () => {
    const out = retimeText(fixture('roundtrip.srt'), 'srt', shiftBy(-2000));
    expect(out.clamped).toBe(1);
    expect(cueTimes(out.text, 'srt')[0]).toEqual({ number: 1, start: 0, end: 1500 });
  });

  it('keeps ASS styles, names and overrides, and moves only Start and End', () => {
    const ass = fixture('features.ass');
    const out = retimeText(ass, 'ass', shiftBy(1000));
    expect(out.text).toContain(
      'Dialogue: 0,0:00:02.00,0:00:05.25,Default,Anna,0,0,0,,{\\i1}Hello{\\i0}, world.\\NA new line, with commas.',
    );
    expect(out.text).toContain('Dialogue: 0,0:00:06.00,0:00:08.50,Default,,0,0,0,,Second in time');
    expect(out.text.split('[V4+ Styles]')[1]?.split('[Events]')[0]).toBe(
      ass.replace(/\r\n/g, '\n').split('[V4+ Styles]')[1]?.split('[Events]')[0],
    );
    // Still reads as the same subtitles, one second later.
    const cues = parseSubtitles(out.text, 'ass').cues;
    expect(cues.map((cue) => cue.start)).toEqual(
      parseSubtitles(ass, 'ass').cues.map((cue) => cue.start + 1000),
    );
  });

  it('keeps VTT cue ids, settings and short times', () => {
    const out = retimeText(fixture('features.vtt'), 'vtt', shiftBy(500));
    expect(out.text).toContain('intro\n00:01.500 --> 00:04.500 line:10% position:50% align:center');
    expect(out.text).toContain('00:00:05.000 --> 00:00:07.500');
    expect(out.text.startsWith('WEBVTT Kind: captions')).toBe(true);
  });

  it('moves VTT karaoke timestamps with their cue', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:03.000\nOne <00:01.500>two <00:02.000>three\n';
    expect(retimeText(vtt, 'vtt', shiftBy(1000)).text).toBe(
      'WEBVTT\n\n00:02.000 --> 00:04.000\nOne <00:02.500>two <00:03.000>three\n',
    );
  });

  it('retimes SBV', () => {
    const out = retimeText(fixture('basic.sbv'), 'sbv', shiftBy(100));
    expect(out.cues).toBeGreaterThan(0);
    expect(out.changed).toBe(out.cues);
  });
});

describe('sync modes', () => {
  it('rescales 23.976 fps timing for 25 fps', () => {
    const out = retimeText(fixture('roundtrip.srt'), 'srt', rescale(23.976, 25));
    const last = cueTimes(out.text, 'srt').at(-1);
    expect(last?.start).toBe(Math.round(3_602_100 * (23.976 / 25)));
    // And back again, within a millisecond.
    const back = cueTimes(retimeText(out.text, 'srt', rescale(25, 23.976)).text, 'srt');
    expect(Math.abs((back.at(-1)?.start ?? 0) - 3_602_100)).toBeLessThanOrEqual(1);
  });

  it('two-point sync undoes an offset and a drift to within 10 ms', () => {
    const srt = fixture('roundtrip.srt');
    const truth = cueTimes(srt, 'srt');
    // Late by 2.5 s and running 0.1 % slow.
    const drifted = retimeText(srt, 'srt', (cue) => ({
      start: cue.start * 1.001 + 2500,
      end: cue.end * 1.001 + 2500,
    })).text;
    const seen = cueTimes(drifted, 'srt');
    const first = seen[0];
    const last = seen.at(-1);
    if (!first || !last) throw new Error('no cues');
    const fixed = cueTimes(
      retimeText(
        drifted,
        'srt',
        twoPoint(
          { start: first.start, at: truth[0]?.start ?? 0 },
          { start: last.start, at: truth.at(-1)?.start ?? 0 },
        ),
      ).text,
      'srt',
    );
    fixed.forEach((cue, i) => {
      expect(Math.abs(cue.start - (truth[i]?.start ?? 0))).toBeLessThanOrEqual(10);
      expect(Math.abs(cue.end - (truth[i]?.end ?? 0))).toBeLessThanOrEqual(10);
    });
  });

  it('refuses two cues at the same time', () => {
    expect(() => twoPoint({ start: 1000, at: 0 }, { start: 1000, at: 5000 })).toThrow(/different/);
  });
});
