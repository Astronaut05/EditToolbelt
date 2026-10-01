'use client';

import { storage } from '@etb/core';
import { CalculatorShell, MonoLabel, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, SelectField } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

const MODES = ['hours', 'space'] as const;
const UNITS = ['GB', 'TB'] as const;

const DEFAULTS = {
  mode: 'hours',
  size: '1',
  unit: 'TB',
  hours: '3',
  codec: 'xavc-s-4k',
  mbps: '100',
};

/** T08 Recording Storage Calculator (tools/subtitles-and-time.md). */
export default function StorageCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const mode = oneOf(state.mode, MODES, 'hours');
  const unit = oneOf(state.unit, UNITS, 'TB');
  const mbps = num(state.mbps);
  const codec = storage.CODECS.find((candidate) => candidate.id === state.codec);

  let problem: string | null = null;
  let facts: { label: string; value: string; unit?: string }[] = [];
  if (!(mbps > 0)) problem = 'Enter a bitrate above zero.';
  else if (mode === 'hours') {
    const size = num(state.size);
    if (!(size > 0)) problem = 'Enter a card or drive size above zero.';
    else {
      const bytes = size * (unit === 'TB' ? storage.TB : storage.GB);
      const hours = storage.hoursOn(bytes, mbps);
      facts = [
        { label: 'Recording time', value: storage.durationLabel(hours) },
        { label: 'In minutes', value: fmt(Math.floor(hours * 60)), unit: 'min' },
        { label: 'Per hour', value: storage.sizeLabel(storage.bytesFor(1, mbps)) },
      ];
    }
  } else {
    const hours = num(state.hours);
    if (!(hours > 0)) problem = 'Enter the hours you plan to record, above zero.';
    else {
      const bytes = storage.bytesFor(hours, mbps);
      facts = [
        { label: 'Storage needed', value: storage.sizeLabel(bytes) },
        { label: 'With a backup copy', value: storage.sizeLabel(bytes * 2) },
        { label: '128 GB cards', value: fmt(Math.ceil(bytes / (128 * storage.GB))) },
      ];
    }
  }

  const inputs = (
    <Rows>
      <ChoiceRow
        label="Calculate"
        value={mode}
        onChange={(value) => {
          set('mode', value);
        }}
        options={[
          { value: 'hours', label: 'Hours that fit' },
          { value: 'space', label: 'Space needed' },
        ]}
      />
      <SelectField
        id="st-codec"
        label="Camera codec"
        value={codec ? codec.id : 'custom'}
        onChange={(value) => {
          set('codec', value);
          const picked = storage.CODECS.find((candidate) => candidate.id === value);
          if (picked) set('mbps', String(picked.mbps));
        }}
        options={[
          ...storage.CODECS.map((candidate) => ({ value: candidate.id, label: candidate.name })),
          { value: 'custom', label: 'My own bitrate' },
        ]}
      />
      <NumberField
        id="st-mbps"
        label="Bitrate"
        value={state.mbps}
        onChange={(value) => {
          set('mbps', value);
          // A changed bitrate is the camera's own, not the typical one.
          if (codec && num(value) !== codec.mbps) set('codec', 'custom');
        }}
        unit="Mbps"
      />
      {mode === 'hours' ? (
        <>
          <NumberField
            id="st-size"
            label="Card or drive"
            value={state.size}
            onChange={(value) => {
              set('size', value);
            }}
            unit={unit}
          />
          <ChoiceRow
            label="Size unit"
            value={unit}
            onChange={(value) => {
              set('unit', value);
            }}
            options={[
              { value: 'GB', label: 'GB' },
              { value: 'TB', label: 'TB' },
            ]}
          />
        </>
      ) : (
        <NumberField
          id="st-hours"
          label="Recording"
          value={state.hours}
          onChange={(value) => {
            set('hours', value);
          }}
          unit="h"
        />
      )}
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      <p className="mt-4 text-13.5 text-text-muted">
        Cards and drives are sold in decimal units: 1 TB is 1,000,000,000,000 bytes, which Windows
        shows as 931 GB. Formatting and the camera’s own files take a little more.
      </p>
      <MonoLabel as="h2" size="md" className="mt-8">
        Typical bitrates: check your camera’s manual
      </MonoLabel>
      <table className="mt-3 w-full max-w-140 text-left text-14">
        <caption className="sr-only">
          Typical bitrates for common camera codecs. Your camera’s settings decide the real figure.
        </caption>
        <tbody>
          {storage.CODECS.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="py-2">{row.name}</td>
              <td className="py-2 text-right font-mono text-12.5">{fmt(row.mbps)} Mbps</td>
              <td className="py-2 pl-3 text-right">
                <button
                  type="button"
                  aria-label={`Use ${row.name}`}
                  aria-pressed={state.codec === row.id}
                  onClick={() => {
                    set('codec', row.id);
                    set('mbps', String(row.mbps));
                  }}
                  className="h-9 rounded-control border border-border px-3 text-13.5 hover:border-text aria-pressed:border-text"
                >
                  Use
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-13.5 text-text-muted">
        ProRes figures are Apple’s for 29.97 fps; higher frame rates take more. Type your camera’s
        own bitrate above to replace any of these.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
