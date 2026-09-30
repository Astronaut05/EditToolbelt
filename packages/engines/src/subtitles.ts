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
