'use client';

import { timecode } from '@etb/core';
import { CalculatorShell, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, SelectField, TextField } from './calc-ui';
import { formatDuration } from './duration';
import { oneOf, useQueryState } from './url-state';

type Mode = 'convert' | 'math' | 'rate' | 'duration';
type From = 'timecode' | 'frames' | 'seconds';

const RATE_OPTIONS = [
  ...timecode.FRAME_RATES.map((rate) => ({
    value: rate.id,
    label: rate.label.replace(/^([\d.]+)/, '$1 fps'),
  })),
  { value: 'custom', label: 'Custom' },
];

function rateFrom(id: string, custom: string): timecode.FrameRate | null {
  try {
    return id === 'custom' ? timecode.customRate(num(custom)) : timecode.getFrameRate(id);
  } catch {
    return null;
  }
}

const MODES = ['convert', 'math', 'duration', 'rate'] as const;
const FROMS = ['timecode', 'frames', 'seconds'] as const;
const OPS = ['add', 'subtract'] as const;

const DEFAULTS = {
  mode: 'convert',
  rate: '29.97-df',
  custom: '12',
  target: '25',
  targetCustom: '12',
  from: 'timecode',
  a: '01:00:00;00',
  b: '00:00:10;00',
  op: 'add',
  amount: '1800',
};

function readTc(value: string, rate: timecode.FrameRate): { frames: number } | { error: string } {
  const result = timecode.parseTimecode(value, rate);
  return result.ok ? { frames: result.frames } : { error: result.error };
}

/** T04 Timecode Calculator (tools/subtitles-and-time.md): SMPTE drop-frame aware. */
export default function TimecodeCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const mode: Mode = oneOf(state.mode, MODES, 'convert');
  const from: From = oneOf(state.from, FROMS, 'timecode');
  const op = oneOf(state.op, OPS, 'add');
  const { a, b, amount } = state;
  const rate = rateFrom(state.rate, state.custom);
  const targetRate = rateFrom(state.target, state.targetCustom);

  let facts: { label: string; value: string; unit?: string }[] = [];
  let problem: string | null = null;
  const describe = (frames: number, fr: timecode.FrameRate) => [
    { label: 'Timecode', value: timecode.formatTimecode(frames, fr) },
    { label: 'Frames', value: fmt(frames) },
    { label: 'Seconds', value: fmt(timecode.framesToSeconds(frames, fr), 3), unit: 's' },
    { label: 'Real time', value: formatDuration(Math.abs(timecode.framesToSeconds(frames, fr))) },
  ];

  if (!rate) problem = 'Enter a custom frame rate between 1 and 1000.';
  else if (mode === 'convert') {
    let frames: number | null = null;
    if (from === 'timecode') {
      const read = readTc(a, rate);
      if ('error' in read) problem = read.error;
      else frames = read.frames;
    } else {
      const value = num(amount);
      if (!Number.isFinite(value)) problem = `Enter a number of ${from}.`;
      else frames = from === 'frames' ? Math.round(value) : timecode.secondsToFrames(value, rate);
    }
    if (frames !== null) facts = describe(frames, rate);
  } else if (mode === 'math' || mode === 'duration') {
    const first = readTc(a, rate);
    const second = readTc(b, rate);
    if ('error' in first) problem = `${mode === 'duration' ? 'In' : 'First'}: ${first.error}`;
    else if ('error' in second)
      problem = `${mode === 'duration' ? 'Out' : 'Second'}: ${second.error}`;
    else {
      const frames =
        mode === 'duration'
          ? second.frames - first.frames
          : op === 'add'
            ? first.frames + second.frames
            : first.frames - second.frames;
      facts = describe(frames, rate);
    }
  } else if (!targetRate) problem = 'Enter a custom target frame rate between 1 and 1000.';
  else {
    const read = readTc(a, rate);
    if ('error' in read) problem = read.error;
    else {
      const frames = timecode.convertFrames(read.frames, rate, targetRate);
      facts = [
        {
          label: `Timecode at ${targetRate.label}`,
          value: timecode.formatTimecode(frames, targetRate),
        },
        { label: 'Frames', value: fmt(frames) },
        { label: 'Source frames', value: fmt(read.frames) },
        { label: 'Real time', value: formatDuration(timecode.framesToSeconds(read.frames, rate)) },
      ];
    }
  }

  const tcHint = rate?.dropFrame ? 'HH:MM:SS;FF' : 'HH:MM:SS:FF';
  const inputs = (
    <Rows>
      <ChoiceRow
        label="Calculate"
        value={mode}
        onChange={(value) => {
          set('mode', value);
        }}
        options={[
          { value: 'convert', label: 'Convert' },
          { value: 'math', label: 'Add' },
          { value: 'duration', label: 'Duration' },
          { value: 'rate', label: 'New rate' },
        ]}
      />
      <SelectField
        id="tc-rate"
        label="Frame rate"
        value={state.rate}
        onChange={(value) => {
          set('rate', value);
        }}
        options={RATE_OPTIONS}
      />
      {state.rate === 'custom' && (
        <NumberField
          id="tc-custom"
          label="Custom rate"
          value={state.custom}
          onChange={(value) => {
            set('custom', value);
          }}
          unit="fps"
        />
      )}
      {mode === 'convert' && (
        <ChoiceRow
          label="From"
          value={from}
          onChange={(value) => {
            set('from', value);
          }}
          options={[
            { value: 'timecode', label: 'Timecode' },
            { value: 'frames', label: 'Frames' },
            { value: 'seconds', label: 'Seconds' },
          ]}
        />
      )}
      {(mode !== 'convert' || from === 'timecode') && (
        <TextField
          id="tc-a"
          label={mode === 'duration' ? 'In' : 'Timecode'}
          value={a}
          onChange={(value) => {
            set('a', value);
          }}
          placeholder={tcHint}
        />
      )}
      {mode === 'convert' && from !== 'timecode' && (
        <NumberField
          id="tc-amount"
          label={from === 'frames' ? 'Frames' : 'Seconds'}
          value={amount}
          onChange={(value) => {
            set('amount', value);
          }}
          unit={from === 'frames' ? 'f' : 's'}
        />
      )}
      {mode === 'math' && (
        <ChoiceRow
          label="Operation"
          value={op}
          onChange={(value) => {
            set('op', value);
          }}
          options={[
            { value: 'add', label: 'Plus' },
            { value: 'subtract', label: 'Minus' },
          ]}
        />
      )}
      {(mode === 'math' || mode === 'duration') && (
        <TextField
          id="tc-b"
          label={mode === 'duration' ? 'Out' : op === 'add' ? 'Plus' : 'Minus'}
          value={b}
          onChange={(value) => {
            set('b', value);
          }}
          placeholder={tcHint}
        />
      )}
      {mode === 'rate' && (
        <>
          <SelectField
            id="tc-target"
            label="Target rate"
            value={state.target}
            onChange={(value) => {
              set('target', value);
            }}
            options={RATE_OPTIONS}
          />
          {state.target === 'custom' && (
            <NumberField
              id="tc-target-custom"
              label="Custom target"
              value={state.targetCustom}
              onChange={(value) => {
                set('targetCustom', value);
              }}
              unit="fps"
            />
          )}
        </>
      )}
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      <p className="mt-4 max-w-xl text-13.5 leading-body text-text-muted">
        Drop-frame (DF) timecode uses a semicolon before the frames. At 29.97 DF it skips frame
        numbers 00 and 01 at the start of every minute except each tenth (00 to 03 at 59.94 DF), so
        the clock matches real time. Frame rate conversion keeps real time and rounds to the nearest
        frame.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
