import type { ToolDef } from '../schema';
import audio from './audio';
import color from './color';
import photo from './photo';
import subtitlesTime from './subtitles-time';
import utility from './utility';
import video from './video';

/** Every tool, in tools/README.md order. */
export const tools: readonly ToolDef[] = [
  ...photo,
  ...video,
  ...audio,
  ...color,
  ...subtitlesTime,
  ...utility,
];
