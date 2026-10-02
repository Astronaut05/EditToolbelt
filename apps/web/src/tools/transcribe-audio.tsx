'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { AUDIO_ACCEPT, AUDIO_FORMATS, LANGUAGE_OPTION, probeSpeech } from './speech-presets';

const OPTIONS: ShellOption[] = [
  LANGUAGE_OPTION,
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'txt', label: 'TXT' },
      { value: 'srt', label: 'SRT' },
      { value: 'vtt', label: 'VTT' },
      { value: 'json', label: 'JSON' },
    ],
    default: 'txt',
  },
];

const PRESET: ShellPreset = {
  noun: 'audio',
  accept: AUDIO_ACCEPT,
  maxBytes: 2 * 1024 ** 3,
  dropTitle: 'Drop audio to transcribe',
  chooseLabel: 'Choose audio',
  tapLabel: 'Choose audio',
  formats: `${AUDIO_FORMATS} · up to 30 min free, 4 h with credits`,
  formatsShort: AUDIO_FORMATS,
  options: OPTIONS,
  phoneGroups: [['language'], ['format']],
  probe: probeSpeech,
  preview: 'text',
  serverReason:
    'Speech recognition needs a large AI model on a GPU, so this tool runs on our servers.',
  runLabel: 'Transcribe',
  outputExt: (options) => options.format ?? 'txt',
  outputSuffix: 'transcript',
  resultTitle: 'Transcribed',
};

/** The same settings for our servers (@etb/registry/options → transcribe-audio). */
const toServerOptions = (options: Record<string, string>) => ({
  language: options.language,
  format: options.format,
});

/** A12 Transcribe Audio (tools/audio.md): Whisper large-v3 on our GPU servers. */
export default function TranscribeAudio({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
