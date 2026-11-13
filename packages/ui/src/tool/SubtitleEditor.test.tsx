import { DEFAULT_RULES, type Cue } from '@etb/core/subtitles';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SubtitleEditor, SubtitleWorkspace } from './SubtitleEditor';

// The page as it first renders, without a browser: the rows, the blocks and
// the playhead's parts are components of their own, and must say what the
// editor says. What they do on a click or a key is the Playwright test's.

const cues: Cue[] = [
  { start: 0, end: 2000, text: 'One <i>two</i>' },
  // 40 ms after the first: under the 83 ms the rules ask for.
  { start: 2040, end: 4000, text: 'Three' },
  { start: 6000, end: 8000, text: 'Four' },
];
const noop = () => undefined;
const count = (html: string, part: string) => html.split(part).length - 1;

describe('SubtitleEditor', () => {
  const html = renderToStaticMarkup(
    <SubtitleEditor cues={cues} onChange={noop} rules={DEFAULT_RULES} />,
  );

  it('shows every cue as a row to type in and as a block on the timeline', () => {
    for (const n of [1, 2, 3]) {
      expect(count(html, `aria-label="Play from cue ${String(n)}"`)).toBe(1);
      expect(count(html, `aria-label="Cue ${String(n)} start"`)).toBe(1);
      expect(count(html, `aria-label="Cue ${String(n)} end"`)).toBe(1);
      expect(count(html, `aria-label="Cue ${String(n)} text"`)).toBe(1);
    }
    expect(html).toContain('aria-label="Cue 2: 00:00:02.040 to 00:00:04.000"');
    expect(html).toContain('aria-label="Cue 3: 00:00:06.000 to 00:00:08.000"');
    expect(html).toContain('value="00:00:02.040"');
    expect(html).toContain('2.00 s · 3.5 cps');
  });

  it('starts with the first cue selected', () => {
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toMatch(/aria-pressed="true" aria-label="Cue 1: /);
  });

  it('says what is wrong on the cue’s row, and that its block has issues', () => {
    expect(html).toContain('aria-label="Cue 1: 00:00:00.000 to 00:00:02.000, has issues"');
    expect(count(html, '40 ms before the next cue (83 ms at least)')).toBe(2);
    expect(count(html, ', has issues"')).toBe(1);
  });

  it('starts with the playhead at 0', () => {
    expect(html).toMatch(/Playhead <b[^>]*>00:00:00\.000<\/b> · 3 cues/);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*style="left:0px"><\/div>/);
  });

  it('shows the cue under the playhead over a video, without its tags', () => {
    const media = new File([], 'film.mp4', { type: 'video/mp4' });
    const withVideo = renderToStaticMarkup(
      <SubtitleEditor cues={cues} onChange={noop} rules={DEFAULT_RULES} media={media} />,
    );
    expect(withVideo).toMatch(/<video [^>]*><\/video><p aria-hidden="true"[^>]*>One two<\/p>/);
    // Nothing over the video when no cue is on screen at the playhead.
    const later = renderToStaticMarkup(
      <SubtitleEditor cues={cues.slice(1)} onChange={noop} rules={DEFAULT_RULES} media={media} />,
    );
    expect(later).toMatch(/<video [^>]*><\/video><\/div>/);
  });
});

describe('SubtitleWorkspace', () => {
  it('reads the cues from the option’s JSON, and shows none for none', () => {
    const html = renderToStaticMarkup(
      <SubtitleWorkspace cues={JSON.stringify(cues)} onChange={noop} rules={DEFAULT_RULES} />,
    );
    expect(html).toContain('· 3 cues');
    expect(html).toContain('aria-label="Cue 3 text"');
    const empty = renderToStaticMarkup(
      <SubtitleWorkspace cues={undefined} onChange={noop} rules={DEFAULT_RULES} />,
    );
    expect(empty).toContain('· 0 cues');
    expect(empty).not.toContain('aria-label="Cue 1 text"');
  });
});
