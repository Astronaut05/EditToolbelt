/**
 * `text` engine for T01 Subtitle Converter: reads the file's bytes, detects
 * the encoding and format, converts, and returns UTF-8. Pure JS on the main
 * thread: subtitle files are small (a feature film is about 100 KB).
 */
import { subtitles } from '@etb/core';

import { EngineAbortError } from './dummy';
import type { Engine, EngineOutput } from './types';

export interface SubtitleEngineOptions {
  to?: string;
  encoding?: string;
  bom?: string;
  styling?: string;
}

const TARGETS = ['srt', 'vtt', 'ass', 'sbv', 'txt'] as const;
const ENCODINGS = [
  'auto',
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1251',
  'windows-1252',
] as const;

const MIME: Record<subtitles.TargetFormat, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  sbv: 'text/plain',
  txt: 'text/plain',
};

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

export const subtitleEngine: Engine<SubtitleEngineOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: (input) => ({ seconds: 0.1, outputBytes: input.size }),
  async run(input, opts, ctx): Promise<EngineOutput> {
    const to = pick(opts.to, TARGETS, 'srt');
    ctx.progress(0.2, 'Reading');
    const bytes = new Uint8Array(await input.arrayBuffer());
    if (ctx.signal.aborted) throw new EngineAbortError();
    const result = subtitles.convertBytes(bytes, {
      to,
      fileName: input instanceof File ? input.name : undefined,
      encoding: pick(opts.encoding, ENCODINGS, 'auto'),
      bom: opts.bom === 'yes',
      keepStyling: opts.styling !== 'drop',
    });
    if (!result.ok) throw new Error(result.error);
    ctx.progress(1, 'Done');
    return {
      blob: new Blob([result.bytes], { type: `${MIME[to]};charset=utf-8` }),
      ext: to,
      path: 'Browser',
      notes: result.notes,
      // The readout shows values only, so each one says what it is.
      details: [
        { label: 'Cues', value: `${result.cues.toLocaleString('en-US')} cues` },
        { label: 'Formats', value: `${result.from.toUpperCase()} → ${to.toUpperCase()}` },
      ],
    };
  },
};

export interface SubtitleEditOptions {
  /** The edited cues, as JSON (the editor's state). */
  cues?: string;
  /** srt, vtt, ass or sbv. */
  format?: string;
  bom?: string;
}

/** The cues an editor option holds, or none: only well-formed cues are kept. */
export function cuesFromJson(json: string | undefined): subtitles.Cue[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is subtitles.Cue =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as subtitles.Cue).start === 'number' &&
        typeof (c as subtitles.Cue).end === 'number' &&
        typeof (c as subtitles.Cue).text === 'string',
    );
  } catch {
    return [];
  }
}

/** A subtitle file read for the editor: its cues, its format and its length. */
export async function readSubtitleFile(
  file: File,
): Promise<{ cues: subtitles.Cue[]; format: Exclude<subtitles.SubtitleFormat, 'txt'> }> {
  const { text } = subtitles.decodeBytes(new Uint8Array(await file.arrayBuffer()));
  const format = subtitles.detectFormat(text, file.name);
  if (!format || format === 'txt') {
    throw new Error('this isn’t SRT, VTT, ASS, SSA or SBV.');
  }
  return { cues: subtitles.parseSubtitles(text, format).cues, format };
}

/**
 * T03 Subtitle Editor's `text` engine: writes the edited cues (kept in the
 * page's options) in the format picked, UTF-8. The input file was read once,
 * when it arrived; this doesn't read it again.
 */
export const subtitleEditEngine: Engine<SubtitleEditOptions> = {
  capabilities: () => ({ supported: true }),
  estimate: (input) => ({ seconds: 0.1, outputBytes: input.size }),
  run(_input, opts, ctx): Promise<EngineOutput> {
    const to = pick(opts.format, ['srt', 'vtt', 'ass', 'sbv'] as const, 'srt');
    const cues = cuesFromJson(opts.cues);
    if (cues.length === 0) return Promise.reject(new Error('There are no cues to save.'));
    const dropped: subtitles.Dropped = {};
    const text = subtitles.writeSubtitles(cues, to, dropped);
    const notes = subtitles.describeDropped(dropped, to);
    ctx.progress(1, 'Done');
    return Promise.resolve({
      blob: new Blob([subtitles.encodeUtf8(text, opts.bom === 'yes')], {
        type: `${MIME[to]};charset=utf-8`,
      }),
      ext: to,
      path: 'Browser',
      notes,
      details: [
        { label: 'Cues', value: `${cues.length.toLocaleString('en-US')} cues` },
        { label: 'Format', value: to.toUpperCase() },
      ],
    });
  },
};
