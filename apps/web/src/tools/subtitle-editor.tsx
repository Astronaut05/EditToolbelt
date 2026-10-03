'use client';

import { DEFAULT_RULES, ENCODING_LABELS, type CheckRules } from '@etb/core/subtitles';
import { readSubtitleFile, subtitleEditEngine } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Save as',
    choices: [
      { value: 'srt', label: 'SRT' },
      { value: 'vtt', label: 'VTT' },
      { value: 'ass', label: 'ASS' },
      { value: 'sbv', label: 'SBV' },
    ],
    default: 'srt',
  },
  {
    id: 'media',
    label: 'Video or audio',
    kind: 'file',
    accept: 'video/*,audio/*,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac',
    default: '',
  },
  {
    id: 'cpl',
    label: 'Characters a line',
    kind: 'number',
    min: 20,
    max: 80,
    unit: 'chars',
    default: String(DEFAULT_RULES.maxCpl),
  },
  {
    id: 'cps',
    label: 'Reading speed',
    kind: 'number',
    min: 8,
    max: 40,
    unit: 'cps',
    default: String(DEFAULT_RULES.maxCps),
  },
  {
    id: 'gap',
    label: 'Gap between cues',
    kind: 'number',
    min: 0,
    max: 500,
    unit: 'ms',
    default: String(DEFAULT_RULES.minGap),
  },
];

const LABELS: Record<string, string> = {
  srt: 'SRT',
  vtt: 'WebVTT',
  ass: 'ASS',
  ssa: 'SSA',
  sbv: 'SBV',
};

/**
 * Reads the subtitles as they arrive: the cues go into the editor, the
 * format into "Save as". The encoding is found from the bytes; the editor's
 * "Read as" changes it.
 */
async function probe(file: File): Promise<ProbeInfo> {
  const { cues, format, encoding } = await readSubtitleFile(file);
  const end = cues.reduce((max, c) => Math.max(max, c.end), 0) / 1000;
  const minutes = Math.floor(end / 60);
  const seconds = Math.round(end % 60);
  const read = encoding === 'utf-8' ? '' : ` · ${ENCODING_LABELS[encoding]}`;
  return {
    durationSec: Math.max(1, end),
    fps: 1000,
    summary: `${LABELS[format] ?? format.toUpperCase()}${read} · ${String(cues.length)} cues · ${String(minutes)}:${String(seconds).padStart(2, '0')}`,
    values: { cues: JSON.stringify(cues), format: format === 'ssa' ? 'ass' : format },
  };
}

const limit = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function rules(options: Record<string, string>): CheckRules {
  return {
    ...DEFAULT_RULES,
    maxCpl: limit(options.cpl, DEFAULT_RULES.maxCpl),
    maxCps: limit(options.cps, DEFAULT_RULES.maxCps),
    minGap: Number(options.gap) >= 0 ? Number(options.gap) : DEFAULT_RULES.minGap,
  };
}

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '.srt,.vtt,.webvtt,.ass,.ssa,.sbv',
  dropTitle: 'Drop a subtitle file to edit',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a subtitle file',
  formats: (max) => `SRT, VTT, ASS, SSA, SBV · up to ${max}`,
  formatsShort: 'SRT, VTT, ASS, SBV',
  options: OPTIONS,
  phoneGroups: [
    ['format', 'media'],
    ['cpl', 'cps', 'gap'],
  ],
  probe,
  subtitles: { cues: 'cues', media: 'media', rules },
  // Once saved, every edit is saved again, so the download is always what's on screen.
  rerun: true,
  runLabel: 'Save subtitles',
  outputExt: (options) => options.format ?? 'srt',
  outputSuffix: 'edited',
  resultTitle: 'Subtitles saved',
};

/** T03 Subtitle Editor (tools/subtitles-and-time.md). */
export default function SubtitleEditor({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={subtitleEditEngine} onEvent={trackUnknown} />
  );
}
