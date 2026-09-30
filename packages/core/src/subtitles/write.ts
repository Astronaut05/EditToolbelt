/**
 * Strict, spec-correct writing (tools/subtitles-and-time.md → shared rules).
 * Line endings are "\n"; the encoding step decides the bytes.
 */
import { formatAssTime, formatSbvTime, formatSrtTime, formatVttTime } from './time';
import { count, type Cue, type Dropped, type SubtitleFormat } from './types';

const TAG = /<\/?[ibu]>/g;

function stripTags(text: string, dropped: Dropped): string {
  const plain = text.replace(TAG, '');
  if (plain !== text) count(dropped, 'tagsForFormat');
  return plain;
}

export function writeSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${String(index + 1)}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`,
    )
    .join('\n');
}

/** WebVTT text escapes &, < and > (our three tags stay) and may not contain "-->". */
function escapeVtt(text: string): string {
  return text
    .split(/(<\/?[ibu]>)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
    .join('');
}

export function writeVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${escapeVtt(cue.text)}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function writeSbv(cues: readonly Cue[], dropped: Dropped): string {
  return cues
    .map(
      (cue) =>
        `${formatSbvTime(cue.start)},${formatSbvTime(cue.end)}\n${stripTags(cue.text, dropped)}\n`,
    )
    .join('\n');
}

export function writeTxt(cues: readonly Cue[], dropped: Dropped): string {
  return `${cues.map((cue) => stripTags(cue.text, dropped)).join('\n\n')}\n`;
}

/**
 * The default style for SRT → ASS (spec: "a default style, editable"): white
 * Arial 64 px on a 1920 × 1080 canvas, 3 px black outline, bottom centre.
 * Edit it in Aegisub or any ASS editor afterwards.
 */
export const ASS_DEFAULT_STYLE =
  'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,50,1';

function assText(text: string): string {
  return text
    .replace(/[{}]/g, (brace) => (brace === '{' ? '(' : ')'))
    .replace(/<(\/?)([ibu])>/g, (_, slash: string, tag: string) => `{\\${tag}${slash ? '0' : '1'}}`)
    .replace(/\n/g, '\\N');
}

export function writeAss(cues: readonly Cue[], dropped: Dropped): string {
  const rounded = cues.filter((cue) => cue.start % 10 !== 0 || cue.end % 10 !== 0).length;
  if (rounded > 0) count(dropped, 'centiseconds', rounded);
  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${assText(cue.text)}`,
    )
    .join('\n');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ASS_DEFAULT_STYLE,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    events,
    '',
  ].join('\n');
}

export function writeSubtitles(
  cues: readonly Cue[],
  format: Exclude<SubtitleFormat, 'ssa'>,
  dropped: Dropped,
): string {
  switch (format) {
    case 'srt':
      return writeSrt(cues);
    case 'vtt':
      return writeVtt(cues);
    case 'sbv':
      return writeSbv(cues, dropped);
    case 'txt':
      return writeTxt(cues, dropped);
    case 'ass':
      return writeAss(cues, dropped);
  }
}
