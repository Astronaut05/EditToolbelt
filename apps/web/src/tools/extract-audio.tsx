'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.extractAudioEngine, MEDIA_META.extractAudio);

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'mp3', label: 'MP3' },
      { value: 'wav', label: 'WAV' },
      { value: 'm4a', label: 'M4A' },
      { value: 'aac', label: 'AAC' },
      { value: 'flac', label: 'FLAC' },
      { value: 'ogg', label: 'OGG' },
    ],
    default: 'mp3',
  },
  {
    id: 'bitrate',
    label: 'Bitrate',
    choices: [
      { value: '128', label: '128' },
      { value: '192', label: '192' },
      { value: '256', label: '256' },
      { value: '320', label: '320 kbps' },
    ],
    default: '192',
    when: { id: 'format', values: ['mp3', 'm4a', 'aac', 'ogg'] },
  },
  {
    id: 'sampleRate',
    label: 'Sample rate',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '44100', label: '44.1 kHz' },
      { value: '48000', label: '48 kHz' },
    ],
    default: 'keep',
  },
  { id: 'track', label: 'Audio track', kind: 'select', probed: true, default: '1' },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  accept: `${VIDEO_INTAKE.accept},audio/*`,
  dropTitle: 'Drop a video to extract its audio',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['format', 'bitrate'], ['sampleRate'], ['track']],
  probe: (file) => probeVideo(file, true),
  runLabel: 'Extract audio',
  outputExt: (options) => options.format ?? 'mp3',
  outputSuffix: '',
  resultTitle: 'Audio extracted',
};

/** V06 Extract Audio (tools/video.md). */
export default function ExtractAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
