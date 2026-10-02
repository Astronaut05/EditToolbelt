'use client';

import { bitrate } from '@etb/core';
import { CalculatorShell, MonoLabel, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, TextField } from './calc-ui';
import { formatDuration, parseDuration } from './duration';
import { oneOf, useQueryState } from './url-state';

type Mode = 'size' | 'bitrate' | 'duration';
type RateUnit = 'mbps' | 'kbps';
type SizeUnit = 'MB' | 'GB';

const MODES = ['size', 'bitrate', 'duration'] as const;
const RATE_UNITS = ['mbps', 'kbps'] as const;
const SIZE_UNITS = ['MB', 'GB'] as const;

const DEFAULTS = {
  mode: 'size',
  duration: '1:00',
  video: '8',
  videoUnit: 'mbps',
  audio: '192',
  size: '100',
  sizeUnit: 'MB',
};

const toKbps = (value: number, unit: RateUnit) => (unit === 'mbps' ? value * 1000 : value);
const toBytes = (value: number, unit: SizeUnit) => value * (unit === 'GB' ? 1e9 : 1e6);

/** T06 Bitrate & File Size Calculator (tools/subtitles-and-time.md). */
export default function BitrateCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const mode: Mode = oneOf(state.mode, MODES, 'size');
  const videoUnit: RateUnit = oneOf(state.videoUnit, RATE_UNITS, 'mbps');
  const sizeUnit: SizeUnit = oneOf(state.sizeUnit, SIZE_UNITS, 'MB');
  const { duration, video, audio, size } = state;

  const seconds = parseDuration(duration);
  const videoKbps = toKbps(num(video), videoUnit);
  const audioKbps = num(audio) || 0;
  const bytes = toBytes(num(size), sizeUnit);

  let facts: { label: string; value: string; unit?: string }[] = [];
  let problem: string | null = null;

  if (mode === 'size') {
    if (seconds === null || seconds <= 0) problem = 'Enter a duration, like 1:30:00 or 90s.';
    else if (!(videoKbps >= 0)) problem = 'Enter the video bitrate.';
    else {
      const out = bitrate.fileSize(seconds, videoKbps, audioKbps);
      facts = [
        { label: 'File size', value: fmt(out / bitrate.MB, 2), unit: 'MB' },
        { label: 'In MiB', value: fmt(out / bitrate.MIB, 2), unit: 'MiB' },
        { label: 'In GB', value: fmt(out / 1e9, 3), unit: 'GB' },
        { label: 'Total bitrate', value: fmt((videoKbps + audioKbps) / 1000, 3), unit: 'Mbps' },
      ];
    }
  } else if (mode === 'bitrate') {
    if (seconds === null || seconds <= 0) problem = 'Enter a duration, like 1:30:00 or 90s.';
    else if (!(bytes > 0)) problem = 'Enter the target file size.';
    else {
      const kbps = bitrate.videoBitrateFor(bytes, seconds, audioKbps);
      if (kbps <= 0)
        problem = 'The audio alone fills that size. Lower the audio bitrate or raise the target.';
      else
        facts = [
          { label: 'Video bitrate', value: fmt(kbps / 1000, 2), unit: 'Mbps' },
          { label: 'In kbps', value: fmt(kbps), unit: 'kbps' },
          { label: 'Total bitrate', value: fmt((kbps + audioKbps) / 1000, 2), unit: 'Mbps' },
          { label: 'Leave headroom', value: fmt((kbps * 0.95) / 1000, 2), unit: 'Mbps' },
        ];
    }
  } else {
    if (!(bytes > 0)) problem = 'Enter the file size.';
    else if (!(videoKbps + audioKbps > 0)) problem = 'Enter a bitrate above zero.';
    else {
      const secs = bitrate.durationFor(bytes, videoKbps, audioKbps);
      facts = [
        { label: 'Duration', value: formatDuration(secs) },
        { label: 'In seconds', value: fmt(secs, 1), unit: 's' },
        { label: 'In minutes', value: fmt(secs / 60, 1), unit: 'min' },
        { label: 'Total bitrate', value: fmt((videoKbps + audioKbps) / 1000, 3), unit: 'Mbps' },
      ];
    }
  }

  const rateUnits = [
    { value: 'mbps', label: 'Mbps' },
    { value: 'kbps', label: 'kbps' },
  ] as const;

  const inputs = (
    <Rows>
      <ChoiceRow
        label="Calculate"
        value={mode}
        onChange={(value) => {
          set('mode', value);
        }}
        options={[
          { value: 'size', label: 'File size' },
          { value: 'bitrate', label: 'Bitrate' },
          { value: 'duration', label: 'Duration' },
        ]}
      />
      {mode !== 'duration' && (
        <TextField
          id="br-duration"
          label="Duration"
          value={duration}
          onChange={(value) => {
            set('duration', value);
          }}
          placeholder="1:30:00"
          invalid={duration !== '' && parseDuration(duration) === null}
        />
      )}
      {mode !== 'size' && (
        <>
          <NumberField
            id="br-size"
            label="File size"
            value={size}
            onChange={(value) => {
              set('size', value);
            }}
            unit={sizeUnit}
          />
          <ChoiceRow
            label="Size unit"
            value={sizeUnit}
            onChange={(value) => {
              set('sizeUnit', value);
            }}
            options={[
              { value: 'MB', label: 'MB' },
              { value: 'GB', label: 'GB' },
            ]}
          />
        </>
      )}
      {mode !== 'bitrate' && (
        <>
          <NumberField
            id="br-video"
            label="Video bitrate"
            value={video}
            onChange={(value) => {
              set('video', value);
            }}
            unit={videoUnit}
          />
          <ChoiceRow
            label="Video unit"
            value={videoUnit}
            onChange={(value) => {
              set('videoUnit', value);
            }}
            options={rateUnits}
          />
        </>
      )}
      <NumberField
        id="br-audio"
        label="Audio bitrate"
        value={audio}
        onChange={(value) => {
          set('audio', value);
        }}
        unit="kbps"
      />
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      <p className="mt-4 text-13.5 text-text-muted">
        MB here is 1,000,000 bytes, as macOS and phones count. Windows counts 1,048,576 bytes and
        still calls it MB: that is the MiB figure.
      </p>
      <MonoLabel as="h2" size="md" className="mt-8">
        Typical bitrates, for reference
      </MonoLabel>
      <table className="mt-3 w-full max-w-120 text-left text-14">
        <caption className="sr-only">
          Typical bitrates. Not rules: the right bitrate depends on the content.
        </caption>
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-2 font-normal">
              Use
            </th>
            <th scope="col" className="py-2 font-normal">
              Codec
            </th>
            <th scope="col" className="py-2 text-right font-normal">
              Bitrate
            </th>
          </tr>
        </thead>
        <tbody>
          {bitrate.TYPICAL_BITRATES.map((row) => (
            <tr key={`${row.use}-${row.codec}`} className="border-b border-border">
              <th scope="row" className="py-2 font-normal">
                {row.use}
              </th>
              <td className="py-2 text-text-muted">{row.codec}</td>
              <td className="py-2 text-right font-mono text-12.5">
                {row.kbps >= 1000 ? `${fmt(row.kbps / 1000)} Mbps` : `${fmt(row.kbps)} kbps`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-13.5 text-text-muted">
        Typical values, not rules: busy footage needs more.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
