/**
 * T01 Subtitle Converter: any readable format in, any writable format out,
 * with a plain-language report of what was dropped ("12 style overrides
 * removed"), per tools/subtitles-and-time.md.
 */
import {
  decodeBytes,
  encodeUtf8,
  ENCODING_LABELS,
  type Encoding,
  type EncodingChoice,
} from './encoding';
import { detectFormat, parseSubtitles } from './parse';
import { type Dropped, type DropKind, type SubtitleFormat } from './types';
import { writeSubtitles } from './write';

export type TargetFormat = 'srt' | 'vtt' | 'ass' | 'sbv' | 'txt';

export const FORMAT_LABELS: Record<SubtitleFormat, string> = {
  srt: 'SRT',
  vtt: 'WebVTT',
  ass: 'ASS',
  ssa: 'SSA',
  sbv: 'SBV',
  txt: 'TXT',
};

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

const DESCRIBE: Record<DropKind, (n: number, to: string) => string> = {
  assOverrides: (n) => `${plural(n, 'style override')} removed`,
  assComments: (n) => `${plural(n, 'comment line')} skipped`,
  assDrawings: (n) => `${plural(n, 'vector drawing')} skipped`,
  vttSettings: (n) => `${plural(n, 'cue position setting')} removed`,
  vttVoices: (n) => `${plural(n, 'speaker tag')} removed, the text is kept`,
  vttClasses: (n) => `${plural(n, 'class or language tag')} removed`,
  vttTimestamps: (n) => `${plural(n, 'karaoke timestamp')} removed`,
  vttBlocks: (n) => `${plural(n, 'STYLE or REGION block')} removed`,
  srtFont: (n) => `${plural(n, 'font or color tag')} removed`,
  srtPosition: (n) => `${plural(n, 'position code')} like {\\an8} removed`,
  tagsForFormat: (n, to) =>
    `${plural(n, 'cue')} lost italic, bold or underline: ${to} has no styling`,
  centiseconds: (n) =>
    `${plural(n, 'cue')} rounded to hundredths of a second, the finest ASS stores`,
  badTimes: (n) => `${plural(n, 'cue')} with unreadable times skipped`,
  emptyCues: (n) => `${plural(n, 'empty cue')} removed`,
};

export function describeDropped(dropped: Dropped, to: TargetFormat): string[] {
  // A fixed order, so the same file always reads the same.
  return (Object.keys(DESCRIBE) as DropKind[]).flatMap((kind) => {
    const n = dropped[kind] ?? 0;
    return n > 0 ? [DESCRIBE[kind](n, FORMAT_LABELS[to])] : [];
  });
}

export interface ConvertOptions {
  to: TargetFormat;
  /** Read as this format instead of detecting it. */
  from?: Exclude<SubtitleFormat, 'txt'>;
  fileName?: string;
  keepStyling?: boolean;
}

export type ConvertResult =
  | { ok: true; text: string; from: SubtitleFormat; cues: number; notes: string[] }
  | { ok: false; error: string };

export function convertText(input: string, options: ConvertOptions): ConvertResult {
  const from = options.from ?? detectFormat(input, options.fileName);
  if (!from || from === 'txt') {
    return {
      ok: false,
      error:
        'This doesn’t look like SRT, WebVTT, ASS/SSA or SBV. Plain text has no timings to convert.',
    };
  }
  const parsed = parseSubtitles(input, from, { keepStyling: options.keepStyling ?? true });
  if (parsed.cues.length === 0) {
    return { ok: false, error: `No subtitles found in this ${FORMAT_LABELS[from]} file.` };
  }
  const dropped: Dropped = { ...parsed.dropped };
  const text = writeSubtitles(parsed.cues, options.to, dropped);
  return {
    ok: true,
    text,
    from,
    cues: parsed.cues.length,
    notes: describeDropped(dropped, options.to),
  };
}

export interface ConvertFileOptions extends ConvertOptions {
  encoding?: EncodingChoice;
  bom?: boolean;
}

export type ConvertFileResult =
  | {
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      from: SubtitleFormat;
      encoding: Encoding;
      cues: number;
      notes: string[];
    }
  | { ok: false; error: string };

/** Bytes in, UTF-8 bytes out. Notes say which encoding was read when it wasn't UTF-8. */
export function convertBytes(bytes: Uint8Array, options: ConvertFileOptions): ConvertFileResult {
  const { text, encoding } = decodeBytes(bytes, options.encoding ?? 'auto');
  const result = convertText(text, options);
  if (!result.ok) return result;
  const notes = [...result.notes];
  if (encoding !== 'utf-8') notes.unshift(`Read as ${ENCODING_LABELS[encoding]}, written as UTF-8`);
  return {
    ok: true,
    bytes: encodeUtf8(result.text, options.bom ?? false),
    from: result.from,
    encoding,
    cues: result.cues,
    notes,
  };
}
