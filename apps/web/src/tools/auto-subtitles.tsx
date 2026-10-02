'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import {
  AUDIO_ACCEPT,
  isAudioFile,
  LANGUAGE_OPTION,
  lineLength,
  probeSpeech,
  soundOnly,
} from './speech-presets';
import { VIDEO_ACCEPT, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  LANGUAGE_OPTION,
  {
    id: 'translate',
    label: 'Translate',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'en', label: 'To English' },
    ],
    default: 'off',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'srt', label: 'SRT' },
      { value: 'vtt', label: 'VTT' },
      { value: 'ass', label: 'ASS' },
      { value: 'txt', label: 'TXT' },
    ],
    default: 'srt',
  },
  {
    id: 'maxChars',
    label: 'Line length',
    kind: 'number',
    unit: 'chars',
    min: 16,
    max: 80,
    step: 1,
    default: '42',
    when: { id: 'format', values: ['srt', 'vtt', 'ass'] },
  },
  {
    id: 'maxLines',
    label: 'Lines',
    choices: [
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ],
    default: '2',
    when: { id: 'format', values: ['srt', 'vtt', 'ass'] },
  },
  {
    id: 'words',
    label: 'Word timing',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    default: 'off',
    when: { id: 'format', values: ['vtt', 'ass'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  accept: `${VIDEO_ACCEPT},${AUDIO_ACCEPT}`,
  maxBytes: 2 * 1024 ** 3,
  dropTitle: 'Drop a video or audio file',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a file',
  formats: 'MP4, MOV, WebM, MKV, MP3, WAV, M4A · up to 30 min free, 4 h with credits',
  formatsShort: 'MP4, MOV, WebM, MP3, WAV',
  options: OPTIONS,
  phoneGroups: [['language', 'translate'], ['format'], ['maxChars', 'maxLines'], ['words']],
  probe: probeSpeech,
  preview: 'text',
  serverReason:
    'Speech recognition needs a large AI model on a GPU, so this runs on our servers. Your browser takes the sound out of a video first and sends only that.',
  runningNote: 'Only the sound is uploaded, not the video.',
  runLabel: 'Make subtitles',
  outputExt: (options) => options.format ?? 'srt',
  outputSuffix: 'subtitles',
  resultTitle: 'Subtitles ready',
};

/** The same settings for our servers (@etb/registry/options → auto-subtitles). */
const toServerOptions = (options: Record<string, string>) => ({
  language: options.language,
  translate: options.translate === 'en',
  format: options.format,
  maxChars: lineLength(options.maxChars),
  maxLines: Number(options.maxLines) || 2,
  words: options.words === 'on',
});

/** V17 Auto Subtitles (tools/video.md): Whisper large-v3 on our GPU servers, sound only. */
export default function AutoSubtitles({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
        [],
        {
          prepare: (file, ctx) =>
            isAudioFile(file) ? Promise.resolve(file) : soundOnly(file, ctx),
        },
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
