import { describe, expect, it } from 'vitest';

import { parseVtt } from './parse';

/** The text of a one-cue WebVTT file. */
const cueText = (text: string) =>
  parseVtt(`WEBVTT\n\n00:01.000 --> 00:02.000\n${text}\n`).cues[0]?.text;

describe('WebVTT character references', () => {
  it('decodes named, decimal and hex ones', () => {
    expect(cueText('a &amp; b &#233; &#xE9; &#x1F600; &#x10FFFF;')).toBe('a & b é é 😀 \u{10FFFF}');
  });

  it('leaves a number past U+10FFFF as it was written', () => {
    expect(cueText('bad &#1234567; entity')).toBe('bad &#1234567; entity');
    expect(cueText('bad &#x110000; entity')).toBe('bad &#x110000; entity');
    expect(cueText(`bad &#${'9'.repeat(400)}; entity`)).toBe(`bad &#${'9'.repeat(400)}; entity`);
  });

  it('leaves half a surrogate pair as it was written', () => {
    expect(cueText('bad &#xD800; entity')).toBe('bad &#xD800; entity');
    expect(cueText('bad &#57343; entity')).toBe('bad &#57343; entity');
    // The characters either side of the surrogates still decode.
    expect(cueText('&#xD7FF;&#xE000;')).toBe('퟿');
  });
});
