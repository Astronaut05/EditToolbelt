'use client';

import { MEDIA_META, type Engine, type ReplaceAudioOptions } from '@etb/engines';
import {
  fileOptionFile,
  ToolShell,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const inner = mediaEngine((m) => m.replaceAudioEngine, MEDIA_META.replaceAudio);

/** The shell's options as the engine takes them: the chosen music as its file. */
const engine: Engine<Record<string, string>> = {
  capabilities: (caps) => inner.capabilities(caps),
  estimate: (input) => inner.estimate(input, {}),
  run: (file, options, ctx) => {
    const { music, ...rest } = options;
    const chosen: ReplaceAudioOptions = { ...rest, music: fileOptionFile(music ?? '') };
    return inner.run(file, chosen, ctx);
  },
};

const LEVELS = [0, -3, -6, -9, -12, -15, -18, -24].map((db) => ({
  value: String(db),
  label: db === 0 ? '0 dB, as it is' : `−${String(-db)} dB`,
}));

const FADES = [
  { value: '0', label: 'None' },
  { value: '0.5', label: '0.5 s' },
  { value: '1', label: '1 s' },
  { value: '2', label: '2 s' },
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
];

const OPTIONS: ShellOption[] = [
  {
    id: 'music',
    label: 'Music or sound',
    kind: 'file',
    accept: 'audio/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac',
    default: '',
  },
  {
    id: 'mode',
    label: 'The video’s sound',
    choices: [
      { value: 'replace', label: 'Replace it' },
      { value: 'mix', label: 'Keep it, music under' },
    ],
    default: 'replace',
  },
  {
    id: 'level',
    label: 'Music level',
    kind: 'select',
    choices: LEVELS,
    default: '0',
    when: { id: 'mode', values: ['replace'] },
  },
  {
    id: 'bedLevel',
    label: 'Music level',
    kind: 'select',
    choices: LEVELS,
    default: '-15',
    when: { id: 'mode', values: ['mix'] },
  },
  {
    id: 'videoLevel',
    label: 'Video’s sound level',
    kind: 'select',
    choices: LEVELS,
    default: '0',
    when: { id: 'mode', values: ['mix'] },
  },
  { id: 'fadeIn', label: 'Fade in', kind: 'select', choices: FADES, default: '0' },
  { id: 'fadeOut', label: 'Fade out', kind: 'select', choices: FADES, default: '2' },
  {
    id: 'offset',
    label: 'Start the music at',
    kind: 'number',
    unit: 's',
    min: 0,
    step: 0.1,
    default: '0',
  },
  {
    id: 'loop',
    label: 'If the music is shorter',
    choices: [
      { value: 'loop', label: 'Loop it' },
      { value: 'once', label: 'Play it once' },
    ],
    default: 'loop',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to add music to',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['music', 'mode'],
    ['level', 'bedLevel', 'videoLevel'],
    ['fadeIn', 'fadeOut'],
    ['offset', 'loop'],
  ],
  probe: (file) => probeVideo(file),
  facts: () => [
    {
      label: 'Picture',
      value: 'Copied as it is, never re-encoded. The music is cut or looped to the video’s length',
    },
  ],
  blocked: (options) => (options.music ? undefined : 'Choose the music or sound to add.'),
  runLabel: 'Add the sound',
  // The video keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'with-sound',
  resultTitle: 'Sound added',
};

/** V14 Add or Replace Audio in Video (tools/video.md). */
export default function ReplaceAudio({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
