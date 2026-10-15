'use client';

import { CAPTION_LANGUAGES } from '@etb/core/caption-languages';
import { MEDIA_META } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { loadMediaEngines, mediaEngine } from './media-engine';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.subtitleGeneratorEngine, MEDIA_META.subtitleGenerator);

const OPTIONS: ShellOption[] = [
  {
    id: 'apiKey',
    label: 'Gemini API key',
    kind: 'secret',
    // Strictly necessary, kept only while Remember is ticked (/cookies lists it).
    remember: 'etb.gemini_key',
    placeholder: 'Paste your key',
    default: '',
  },
  {
    id: 'style',
    label: 'Style',
    kind: 'select',
    choices: [
      { value: 'instagram', label: 'Instagram · 2 to 4 words, 1 line' },
      { value: 'phrase', label: 'Phrase · 4 to 7 words, 1 line' },
      { value: 'youtube', label: 'Two lines · 42 characters each' },
    ],
    default: 'instagram',
  },
  {
    id: 'language',
    label: 'Language',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto · detect it' },
      ...CAPTION_LANGUAGES.map((language) => ({ value: language.value, label: language.label })),
    ],
    default: 'uz',
  },
  {
    id: 'apostrophe',
    label: 'oʻ and gʻ',
    choices: [
      { value: 'typewriter', label: "o' · every font" },
      { value: 'official', label: 'oʻ · official' },
    ],
    default: 'typewriter',
    when: { id: 'language', values: ['uz', 'auto'] },
  },
  {
    id: 'fillers',
    label: 'Filler sounds',
    choices: [
      { value: 'remove', label: 'Remove' },
      { value: 'keep', label: 'Keep' },
    ],
    default: 'remove',
  },
  {
    id: 'gaps',
    label: 'Close gaps under',
    kind: 'number',
    unit: 's',
    min: 0,
    max: 10,
    step: 0.1,
    default: '1.5',
  },
  {
    id: 'glossary',
    label: 'Names and terms',
    kind: 'textarea',
    placeholder: 'Names, brands and terms, spelled your way',
    default: '',
  },
  {
    id: 'model',
    label: 'Gemini model',
    kind: 'text',
    placeholder: 'gemini-3.5-flash',
    default: 'gemini-3.5-flash',
  },
];

/** The sound's length and a line about it, from a recording or a video's soundtrack. */
async function probe(file: File): Promise<ProbeInfo> {
  const info = await (await loadMediaEngines()).probeAudio(file);
  return { durationSec: info.durationSec, summary: info.summary };
}

const PRESET: ShellPreset = {
  noun: 'audio',
  accept:
    'audio/*,video/mp4,video/quicktime,video/webm,video/x-matroska,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.weba,.mp4,.mov,.m4v,.webm,.mkv',
  dropTitle: 'Drop a video or recording to subtitle',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a video or recording',
  formats: (max) => `MP4, MOV, MP3, WAV, M4A and more · up to ${max} and 2 h`,
  formatsShort: 'MP4, MOV, MP3, WAV, M4A',
  options: OPTIONS,
  phoneGroups: [
    ['apiKey'],
    ['style', 'language', 'apostrophe'],
    ['fillers', 'gaps'],
    ['glossary', 'model'],
  ],
  probe,
  blocked: (options) =>
    options.apiKey?.trim()
      ? undefined
      : 'Paste your Gemini API key first. Get one free at aistudio.google.com/apikey.',
  privacy: {
    line: 'Your audio goes from your browser to Google Gemini with your own key, never to our servers.',
    short: 'Audio goes to Google Gemini with your key, not to us.',
  },
  runLabel: 'Generate subtitles',
  runningNote: 'Gemini takes about a quarter of the recording’s length. Keep this tab open.',
  outputExt: () => 'srt',
  outputSuffix: 'subtitles',
  resultTitle: 'Subtitles ready',
  preview: 'text',
};

/** T09 Subtitle Generator (tools/subtitles-and-time.md). */
export default function SubtitleGenerator({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
