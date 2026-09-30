'use client';

import { subtitleEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'to',
    label: 'Convert to',
    choices: [
      { value: 'srt', label: 'SRT' },
      { value: 'vtt', label: 'VTT' },
      { value: 'ass', label: 'ASS' },
      { value: 'sbv', label: 'SBV' },
      { value: 'txt', label: 'TXT' },
    ],
    default: 'vtt',
  },
  {
    id: 'styling',
    label: 'Italic and bold',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'drop', label: 'Remove' },
    ],
    default: 'keep',
  },
  {
    id: 'encoding',
    label: 'Read as',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'utf-8', label: 'UTF-8' },
      { value: 'windows-1251', label: '1251' },
      { value: 'windows-1252', label: '1252' },
    ],
    default: 'auto',
  },
  {
    id: 'bom',
    label: 'UTF-8 BOM',
    choices: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
    ],
    default: 'no',
  },
];

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '.srt,.vtt,.webvtt,.ass,.ssa,.sbv',
  multiple: true,
  maxBytes: 20 * 1024 * 1024,
  dropTitle: 'Drop subtitle files here',
  chooseLabel: 'Choose files',
  tapLabel: 'Choose subtitle files',
  formats: 'SRT, VTT, ASS, SSA, SBV · up to 20 MB each · several at once',
  formatsShort: 'SRT, VTT, ASS, SSA, SBV',
  sampleUrl: '/samples/sample.srt',
  sampleName: 'sample.srt',
  options: OPTIONS,
  phoneGroups: [['to'], ['styling', 'encoding', 'bom']],
  runLabel: 'Convert',
  outputExt: (options) => options.to ?? 'vtt',
  outputSuffix: '',
  resultTitle: 'Converted',
  preview: 'text',
};

/** T01 Subtitle Converter (tools/subtitles-and-time.md). `to` presets the target on pair pages. */
export default function SubtitleConverter({ tool, to }: { tool: ShellTool; to?: string }) {
  const initialOptions = Object.fromEntries(
    OPTIONS.map((option) => [option.id, option.id === 'to' && to ? to : option.default]),
  );
  return (
    <ToolShell
      tool={tool}
      preset={PRESET}
      engine={subtitleEngine}
      initialOptions={initialOptions}
      onEvent={trackUnknown}
    />
  );
}
