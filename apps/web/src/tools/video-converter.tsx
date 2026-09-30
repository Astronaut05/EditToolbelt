'use client';

import { videoConverterEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'mp4', label: 'MP4' },
      { value: 'webm', label: 'WebM' },
      { value: 'mov', label: 'MOV' },
      { value: 'mkv', label: 'MKV' },
    ],
    default: 'mp4',
  },
  {
    id: 'mode',
    label: 'Quality',
    choices: [
      { value: 'keep', label: 'Keep (remux)' },
      { value: 'reencode', label: 'Re-encode' },
    ],
    default: 'keep',
  },
  {
    id: 'codec',
    label: 'Codec',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'avc', label: 'H.264 · plays everywhere' },
      { value: 'hevc', label: 'H.265 · smaller' },
      { value: 'av1', label: 'AV1 · smallest' },
      { value: 'vp9', label: 'VP9 · WebM' },
    ],
    default: 'auto',
    when: { id: 'mode', values: ['reencode'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to convert',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  formats: 'MP4, MOV, WebM, MKV · up to 2 GB and 60 min',
  options: OPTIONS,
  phoneGroups: [['format'], ['mode', 'codec']],
  probe: (file) => probeVideo(file),
  runLabel: 'Convert',
  // The engine reports the format written (WebM where MP4 can't be encoded here).
  outputExt: (options) => options.format ?? 'mp4',
  outputSuffix: '',
  resultTitle: 'Converted',
};

/** V03 Video Converter (tools/video.md). `to` presets the format on pair pages (/convert/mov-to-mp4). */
export default function VideoConverter({ tool, to }: { tool: ShellTool; to?: string }) {
  const formats = OPTIONS[0]?.choices?.map((choice) => choice.value) ?? [];
  const initialOptions = Object.fromEntries(
    OPTIONS.map((option) => [
      option.id,
      option.id === 'format' && to && formats.includes(to) ? to : option.default,
    ]),
  );
  return (
    <ToolShell
      tool={tool}
      preset={PRESET}
      engine={videoConverterEngine}
      initialOptions={initialOptions}
      onEvent={trackUnknown}
    />
  );
}
