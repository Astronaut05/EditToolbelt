import { lazyEngine } from '../lazy';
import type { readSubtitleFile as readFile } from '../subtitles';
import type { InputMeta } from '../types';

/** T01-T03, before their engines load: text in, text out, at once. */
export const SUBTITLE_META = {
  capabilities: () => ({ supported: true }),
  estimate: (input: InputMeta) => ({ seconds: 0.1, outputBytes: input.size }),
};

const loadSubtitles = () => import('../subtitles');

export const subtitleEngine = lazyEngine(
  () => loadSubtitles().then((m) => m.subtitleEngine),
  SUBTITLE_META,
);

export const subtitleEditEngine = lazyEngine(
  () => loadSubtitles().then((m) => m.subtitleEditEngine),
  SUBTITLE_META,
);

export const subtitleShiftEngine = lazyEngine(
  () => import('../subtitle-shift').then((m) => m.subtitleShiftEngine),
  SUBTITLE_META,
);

/** `readSubtitleFile` (../subtitles), loaded with the first file. */
export async function readSubtitleFile(file: File): ReturnType<typeof readFile> {
  const loaded = await loadSubtitles();
  return loaded.readSubtitleFile(file);
}

/** T02's reader and checks (../subtitle-shift), for a page reading a file as it arrives. */
export const loadSubtitleShift = () => import('../subtitle-shift');
