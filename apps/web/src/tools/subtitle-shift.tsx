'use client';

import { loadSubtitleShift, subtitleShiftEngine } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const FPS = [
  { value: '23.976', label: '23.976' },
  { value: '24', label: '24' },
  { value: '25', label: '25' },
  { value: '29.97', label: '29.97' },
  { value: '30', label: '30' },
  { value: '50', label: '50' },
  { value: '59.94', label: '59.94' },
  { value: '60', label: '60' },
];

const SHIFT = { id: 'mode', values: ['shift'] };
const RESCALE = { id: 'mode', values: ['rescale'] };
const TWO_POINT = { id: 'mode', values: ['two-point'] };

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Fix',
    choices: [
      { value: 'shift', label: 'Shift' },
      { value: 'rescale', label: 'Frame rate' },
      { value: 'two-point', label: 'Two points' },
    ],
    default: 'shift',
  },
  {
    id: 'shift',
    label: 'Move by',
    kind: 'number',
    unit: 's',
    step: 0.001,
    default: '0',
    when: SHIFT,
  },
  { id: 'from', label: 'From cue', kind: 'number', min: 1, step: 1, default: '1', when: SHIFT },
  {
    id: 'fromFps',
    label: 'Made for',
    kind: 'select',
    choices: FPS,
    default: '23.976',
    when: RESCALE,
  },
  { id: 'toFps', label: 'Plays at', kind: 'select', choices: FPS, default: '25', when: RESCALE },
  { id: 'cueA', label: 'First cue', kind: 'select', probed: true, default: '1', when: TWO_POINT },
  {
    id: 'atA',
    label: 'First cue at',
    kind: 'text',
    placeholder: '00:00:12.500',
    default: '',
    when: TWO_POINT,
  },
  { id: 'cueB', label: 'Second cue', kind: 'select', probed: true, default: '2', when: TWO_POINT },
  {
    id: 'atB',
    label: 'Second cue at',
    kind: 'text',
    placeholder: '01:42:08.000',
    default: '',
    when: TWO_POINT,
  },
];

/**
 * The cue's words for a picker label: markup tags (<i>) and ASS override
 * blocks ({\an8}) dropped in one pass, an unclosed one to the end.
 */
function plainText(text: string): string {
  let out = '';
  let close: string | null = null;
  for (const char of text) {
    if (close) {
      if (char === close) close = null;
    } else if (char === '<') close = '>';
    else if (char === '{') close = '}';
    else out += char;
  }
  return out;
}

const clip = (text: string) => {
  const line = plainText(text).replace(/\s+/g, ' ').trim();
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
};

/**
 * Reads the file as it arrives: its cues, for the two-point pickers and their
 * times. The reader and @etb/core's subtitle code load with the first file.
 */
async function probe(file: File): Promise<ProbeInfo> {
  const [{ readSubtitles }, subtitles] = await Promise.all([
    loadSubtitleShift(),
    import('@etb/core/subtitles'),
  ]);
  const read = readSubtitles(new Uint8Array(await file.arrayBuffer()), file.name);
  const parsed = subtitles.parseSubtitles(read.text, read.format).cues;
  // Cue text is looked up by start time: ASS files list events out of order.
  const textAt = new Map(parsed.map((cue) => [cue.start, cue.text]));
  const choices = read.times.map((cue) => ({
    value: String(cue.number),
    label: `${String(cue.number)} · ${subtitles.formatVttTime(cue.start)} · ${clip(textAt.get(cue.start) ?? '')}`,
  }));
  const first = read.times[0];
  const last = read.times.at(-1);
  return {
    durationSec: (last?.end ?? 0) / 1000,
    summary: `${read.format.toUpperCase()} · ${read.times.length.toLocaleString('en-US')} cues · ${subtitles.formatVttTime(first?.start ?? 0)} to ${subtitles.formatVttTime(last?.end ?? 0)}`,
    choices: { cueA: choices, cueB: choices },
    values: {
      cueA: String(first?.number ?? 1),
      cueB: String(last?.number ?? 1),
      atA: subtitles.formatVttTime(first?.start ?? 0),
      atB: subtitles.formatVttTime(last?.start ?? 0),
    },
  };
}

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '.srt,.vtt,.webvtt,.ass,.ssa,.sbv',
  maxBytes: 20 * 1024 * 1024,
  dropTitle: 'Drop a subtitle file here',
  chooseLabel: 'Choose a file',
  tapLabel: 'Choose a subtitle file',
  formats: 'SRT, VTT, ASS, SSA, SBV · up to 20 MB',
  formatsShort: 'SRT, VTT, ASS, SSA, SBV',
  sampleUrl: '/samples/sample.srt',
  sampleName: 'sample.srt',
  options: OPTIONS,
  phoneGroups: [['mode'], ['shift', 'from', 'fromFps', 'toFps'], ['cueA', 'atA'], ['cueB', 'atB']],
  probe,
  runLabel: 'Sync',
  outputExt: () => 'srt',
  outputSuffix: 'synced',
  resultTitle: 'Synced',
  preview: 'text',
};

/** T02 Subtitle Sync & Shift (tools/subtitles-and-time.md). */
export default function SubtitleShift({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={subtitleShiftEngine} onEvent={trackUnknown} />
  );
}
