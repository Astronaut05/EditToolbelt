import { describe, expect, it } from 'vitest';

import { LEVEL_STEP } from '../audio/silence';
import {
  CAPTION_STYLES,
  CaptionReplyError,
  captionPrompt,
  finishCues,
  fitStyle,
  offsetCues,
  parseSeconds,
  planClips,
  readCaptionReply,
  repairClipTimes,
  speechMask,
  tailWords,
  uzbekApostrophes,
  type TimedWord,
  type WordCue,
} from './captions';
import { writeSrt } from './write';

const instagram = CAPTION_STYLES.instagram;

/** Words spoken back to back from `from`, each `each` seconds long. */
function words(text: string, from = 0, each = 0.3): TimedWord[] {
  return text
    .split(' ')
    .map((w, i) => ({ text: w, start: from + i * each, end: from + (i + 1) * each }));
}

/** Levels every 10 ms: −20 dBFS while someone speaks, −70 between. */
function levels(seconds: number, speech: [number, number][]): Float32Array {
  const out = new Float32Array(Math.round(seconds / LEVEL_STEP));
  for (let i = 0; i < out.length; i += 1) {
    const t = i * LEVEL_STEP;
    out[i] = speech.some(([a, b]) => t >= a && t < b) ? -20 : -70;
  }
  return out;
}

describe('parseSeconds', () => {
  it('reads the ways a model writes a time', () => {
    expect(parseSeconds(12.34)).toBe(12.34);
    expect(parseSeconds('12.34')).toBe(12.34);
    expect(parseSeconds('12.34s')).toBe(12.34);
    expect(parseSeconds('00:12.340')).toBeCloseTo(12.34);
    expect(parseSeconds('1:02:03,5')).toBeCloseTo(3723.5);
    expect(parseSeconds('soon')).toBeNaN();
    expect(parseSeconds(null)).toBeNaN();
  });
});

describe('readCaptionReply', () => {
  it('reads the schema’s shape', () => {
    const cues = readCaptionReply(
      JSON.stringify({
        cues: [
          {
            words: [
              { w: 'Salom', s: 0.1, e: 0.5 },
              { w: 'dunyo!', s: 0.5, e: 0.9 },
            ],
          },
        ],
      }),
    );
    expect(cues).toEqual([
      {
        words: [
          { text: 'Salom', start: 0.1, end: 0.5 },
          { text: 'dunyo!', start: 0.5, end: 0.9 },
        ],
      },
    ]);
  });

  it('reads a fenced reply, long key names and a bare list', () => {
    const fenced = '```json\n[{"words":[{"word":"Hi","start":"0:01.5","end":"1.9"}]}]\n```';
    expect(readCaptionReply(fenced)).toEqual([{ words: [{ text: 'Hi', start: 1.5, end: 1.9 }] }]);
  });

  it('times a cue that came as text by its words’ lengths', () => {
    const [cue] = readCaptionReply('{"segments":[{"text":"a bbb","start":0,"end":1}]}');
    expect(cue?.words.map((w) => w.text)).toEqual(['a', 'bbb']);
    expect(cue?.words[0]?.end).toBeCloseTo(1 / 3);
    expect(cue?.words[1]?.end).toBeCloseTo(1);
  });

  it('refuses a reply that isn’t JSON or has no cues', () => {
    expect(() => readCaptionReply('Sorry, I can’t help with that.')).toThrow(CaptionReplyError);
    expect(() => readCaptionReply('{"text":"hello"}')).toThrow(CaptionReplyError);
  });

  it('drops empty words and cues', () => {
    expect(readCaptionReply('{"cues":[{"words":[{"w":" ","s":0,"e":1}]},{"words":[]}]}')).toEqual(
      [],
    );
  });
});

describe('repairClipTimes', () => {
  it('reads milliseconds written for seconds', () => {
    const cues = repairClipTimes([{ words: [{ text: 'a', start: 1200, end: 1600 }] }], 10);
    expect(cues[0]?.words[0]).toEqual({ text: 'a', start: 1.2, end: 1.6 });
  });

  it('keeps words in order, inside the clip and a little long', () => {
    const cues = repairClipTimes(
      [
        {
          words: [
            { text: 'a', start: 1, end: 2 },
            { text: 'b', start: 1.5, end: 1.4 },
            { text: 'c', start: Number.NaN, end: Number.NaN },
            { text: 'd', start: 9.9, end: 12 },
          ],
        },
      ],
      10,
    );
    const [a, b, c, d] = cues[0]?.words ?? [];
    expect(b?.start).toBe(2);
    expect(b?.end).toBeCloseTo(2.08);
    expect(c?.start).toBeCloseTo(2.08);
    expect(d?.end).toBe(10);
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, d],
    ] as const) {
      expect(y?.start).toBeGreaterThanOrEqual(x?.end ?? 0);
    }
  });
});

describe('fitStyle', () => {
  it('splits a cue that’s too long for the style, at punctuation', () => {
    const cues = fitStyle(
      [{ words: words('Bugun biz, aziz do‘stlar, yangi loyihani boshlaymiz') }],
      instagram,
    );
    expect(cues.map((c) => c.words.map((w) => w.text).join(' '))).toEqual([
      'Bugun biz, aziz do‘stlar,',
      'yangi loyihani boshlaymiz',
    ]);
  });

  it('splits until every part fits, preferring pauses where there is no punctuation', () => {
    const long = [
      ...words('bir ikki uch to‘rt besh', 0),
      ...words('olti yetti sakkiz to‘qqiz o‘n o‘n bir', 2),
    ];
    const cues = fitStyle([{ words: long }], instagram);
    expect(cues[0]?.words.map((w) => w.text).join(' ')).toBe('bir ikki uch to‘rt besh');
    for (const cue of cues) expect(cue.words.length).toBeLessThanOrEqual(5);
    expect(cues.flatMap((c) => c.words)).toHaveLength(12);
  });

  it('leaves a phrase of the style’s length, or one more, whole', () => {
    const cue = { words: words('men bugun ertalab bozorga bordim') };
    expect(fitStyle([cue], instagram)).toHaveLength(1);
  });

  it('joins a lone word to the cue it runs into', () => {
    const cues = fitStyle(
      [
        { words: words('juda katta', 0) },
        { words: words('rahmat', 0.6) },
        { words: words('Keyingi gap.', 3) },
      ],
      instagram,
    );
    expect(cues.map((c) => c.words.map((w) => w.text).join(' '))).toEqual([
      'juda katta rahmat',
      'Keyingi gap.',
    ]);
  });

  it('keeps a lone word that starts a new sentence or follows a pause', () => {
    const cues = fitStyle([{ words: words('Tamom.', 0) }, { words: words('Xo‘sh', 2) }], instagram);
    expect(cues).toHaveLength(2);
  });

  it('never changes the cues it was given', () => {
    const given: WordCue[] = [{ words: words('bir', 0) }, { words: words('ikki uch', 0.3) }];
    const copy = structuredClone(given);
    fitStyle(given, instagram);
    expect(given).toEqual(copy);
  });
});

describe('finishCues', () => {
  const options = { style: instagram, closeGapsUnder: 1, durationSec: 20 };

  it('closes pauses under the setting and leaves longer ones open after a short linger', () => {
    const cues = finishCues(
      [
        { words: words('bir ikki', 0) },
        { words: words('uch to‘rt', 1.2) },
        { words: words('besh olti', 5) },
      ],
      options,
    );
    expect(cues).toEqual([
      { start: 0, end: 1200, text: 'bir ikki' },
      { start: 1200, end: 2100, text: 'uch to‘rt' },
      { start: 5000, end: 5900, text: 'besh olti' },
    ]);
  });

  it('drops a period or comma at a cue’s end for the one-line styles, keeps ? and !', () => {
    const cues = finishCues(
      [{ words: words('Salom, do‘stlar.', 0) }, { words: words('Qalaysiz?', 2) }],
      options,
    );
    expect(cues.map((c) => c.text)).toEqual(['Salom, do‘stlar', 'Qalaysiz?']);
  });

  it('wraps the two-line style and keeps its punctuation', () => {
    const [cue] = finishCues(
      [{ words: words('This sentence is long enough that it needs a second line to fit.') }],
      { ...options, style: CAPTION_STYLES.youtube },
    );
    expect(cue?.text.split('\n')).toHaveLength(2);
    expect(cue?.text.endsWith('fit.')).toBe(true);
  });

  it('moves edges next to a pause onto where the speech starts and stops', () => {
    // The voice runs 1.00-1.80 s and 3.00-3.60 s; the model was 0.15 s off.
    const level = levels(5, [
      [1, 1.8],
      [3, 3.6],
    ]);
    const cues = finishCues(
      [{ words: words('birinchi gap', 1.15, 0.35) }, { words: words('ikkinchisi', 2.85, 0.6) }],
      { ...options, durationSec: 5, levels: level, closeGapsUnder: 0.5 },
    );
    expect(cues[0]?.start).toBe(960);
    expect(cues[0]?.end).toBe(2100);
    expect(cues[1]?.start).toBe(2960);
    expect(cues[1]?.end).toBe(3900);
  });

  it('never overlaps, never runs past the file and gives a short cue room to read', () => {
    const cues = finishCues(
      [
        { words: [{ text: 'a', start: 1, end: 1.05 }] },
        { words: [{ text: 'b', start: 0.9, end: 1.5 }] },
        { words: [{ text: 'c', start: 19.9, end: 20 }] },
      ],
      { ...options, style: { ...instagram, minWords: 1 } },
    );
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]?.start).toBeGreaterThanOrEqual(cues[i - 1]?.end ?? 0);
    }
    expect(cues.at(-1)?.end).toBe(20_000);
    expect(writeSrt(cues)).toContain('00:00:19,900 --> 00:00:20,000');
  });

  it('writes Uzbek apostrophes one way throughout', () => {
    expect(uzbekApostrophes('O‘zbekiston, g`alaba, ma’no', 'typewriter')).toBe(
      "O'zbekiston, g'alaba, ma'no",
    );
    expect(uzbekApostrophes("O'zbekiston, g'alaba, ma'no", 'official')).toBe(
      'Oʻzbekiston, gʻalaba, maʼno',
    );
    const [cue] = finishCues([{ words: words('o`zbek tili') }], {
      ...options,
      uzbekApostrophe: 'typewriter',
    });
    expect(cue?.text).toBe("o'zbek tili");
  });
});

describe('speechMask and planClips', () => {
  it('fills short dips between syllables and drops clicks', () => {
    const mask = speechMask(
      levels(2, [
        [0.2, 0.5],
        [0.55, 0.9],
        [1.5, 1.52],
      ]),
      -40,
    );
    expect(mask[Math.round(0.52 / LEVEL_STEP)]).toBe(1);
    expect(mask[Math.round(1.51 / LEVEL_STEP)]).toBe(0);
  });

  it('sends a short recording as one clip', () => {
    expect(planClips(levels(60, [[0, 60]]), 60)).toEqual([{ start: 0, end: 60 }]);
  });

  it('cuts a long one in its longest pauses', () => {
    const speech: [number, number][] = [
      [0, 70],
      [70.8, 150],
      [150.5, 230],
      [231, 300],
    ];
    const clips = planClips(levels(300, speech), 300);
    expect(clips.map((c) => [Number(c.start.toFixed(2)), Number(c.end.toFixed(2))])).toEqual([
      [0, 70.4],
      [70.4, 150.25],
      [150.25, 230.5],
      [230.5, 300],
    ]);
  });

  it('cuts at the quietest moment when nobody pauses, and always moves on', () => {
    const clips = planClips(levels(400, [[0, 400]]), 400);
    expect(clips.at(-1)?.end).toBe(400);
    for (const clip of clips) expect(clip.end - clip.start).toBeLessThanOrEqual(110);
  });
});

describe('captionPrompt', () => {
  const base = {
    style: instagram,
    language: { name: 'Uzbek', script: 'latin' as const },
    uzbekApostrophe: 'typewriter' as const,
    keepFillers: false,
    glossary: '',
    clip: { index: 0, count: 1, seconds: 42.5 },
    before: '',
  };

  it('asks for the style, the language and word times within the clip', () => {
    const { system, user } = captionPrompt(base);
    expect(system).toMatch(/never paraphrase/);
    expect(user).toContain('Uzbek; write it in the Latin script');
    expect(user).toContain('2 to 4 words');
    expect(user).toContain('5 at most');
    expect(user).toContain('42.50 s long');
    expect(user).toContain("o' and g'");
    expect(user).toContain('Leave out filler sounds');
    expect(user).not.toContain('part 1');
  });

  it('names the glossary and carries on from the clip before', () => {
    const { user } = captionPrompt({
      ...base,
      language: null,
      glossary: 'Uzcosmos, EditToolbelt',
      clip: { index: 1, count: 3, seconds: 80 },
      before: 'va shu bilan',
    });
    expect(user).toContain('Detect the language');
    expect(user).toContain('spelled this way: Uzcosmos, EditToolbelt.');
    expect(user).toContain('part 2 of 3');
    expect(user).toContain('"va shu bilan"');
  });

  it('gives the next clip the last words heard', () => {
    expect(tailWords([{ words: words('a b c d e') }], 3)).toBe('c d e');
  });
});

describe('offsetCues', () => {
  it('moves a clip’s words onto the file’s timeline', () => {
    expect(offsetCues([{ words: words('a', 1) }], 60)[0]?.words[0]).toEqual({
      text: 'a',
      start: 61,
      end: 61.3,
    });
  });
});
