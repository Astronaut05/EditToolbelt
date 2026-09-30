/** Subtitle formats T01 reads and writes (tools/subtitles-and-time.md). TXT is write-only. */
export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'sbv' | 'txt';

export const READABLE_FORMATS: readonly SubtitleFormat[] = ['srt', 'vtt', 'ass', 'ssa', 'sbv'];
export const WRITABLE_FORMATS: readonly SubtitleFormat[] = ['srt', 'vtt', 'ass', 'sbv', 'txt'];

/**
 * One cue. Times in whole milliseconds. Text uses "\n" for line breaks and
 * only three inline tags, <i>, <b> and <u>, which every format can express or
 * drop cleanly; everything else is removed at parse time and counted.
 */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** What a parse or a write had to drop or change, counted per kind. */
export type Dropped = Partial<Record<DropKind, number>>;

export type DropKind =
  | 'assOverrides'
  | 'assComments'
  | 'assDrawings'
  | 'vttSettings'
  | 'vttVoices'
  | 'vttClasses'
  | 'vttTimestamps'
  | 'vttBlocks'
  | 'srtFont'
  | 'srtPosition'
  | 'tagsForFormat'
  | 'centiseconds'
  | 'badTimes'
  | 'emptyCues';

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: Cue[];
  dropped: Dropped;
}

export function count(dropped: Dropped, kind: DropKind, by = 1): void {
  dropped[kind] = (dropped[kind] ?? 0) + by;
}
