'use client';

import { shutter } from '@etb/core';
import { CalculatorShell, MonoLabel, OptionRow, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, TextField } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

const MODES = ['angle', 'speed'] as const;
const MAINS = ['50', '60'] as const;

const DEFAULTS = { mode: 'angle', fps: '24', angle: '180', speed: '1/50', hz: '50' };

/** "23.976" and friends are the exact NTSC rates, 24000/1001 and so on. */
function fpsValue(text: string): number {
  const preset = shutter.FRAME_RATES.find((rate) => rate.label === text.trim());
  return preset ? preset.fps : num(text);
}

/** T07 Shutter Angle Calculator (tools/subtitles-and-time.md). */
export default function ShutterAngleCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const mode = oneOf(state.mode, MODES, 'angle');
  const hz = Number(oneOf(state.hz, MAINS, '50'));
  const fps = fpsValue(state.fps);

  let problem: string | null = null;
  let seconds = Number.NaN;
  let angle = Number.NaN;
  if (!(fps > 0)) problem = 'Enter a frame rate above zero.';
  else if (mode === 'angle') {
    angle = num(state.angle);
    if (!(angle > 0) || angle > 360) problem = 'Enter an angle from above 0° to 360°.';
    else seconds = shutter.speedFromAngle(fps, angle);
  } else {
    seconds = shutter.parseSpeed(state.speed);
    if (!(seconds > 0)) problem = 'Enter a shutter speed, like 1/50 or 0.02.';
    else {
      angle = shutter.angleFromSpeed(fps, seconds);
      if (angle > 360 + 1e-9) {
        problem = `Longer than a frame: at ${fmt(fps, 3)} fps the longest is ${shutter.speedLabel(1 / fps)} (360°).`;
      }
    }
  }

  const rule = shutter.speedFromAngle(fps, 180);
  const safe = shutter.flickerSafe(fps, hz);
  const locked = fps > 0 && shutter.frameLocked(fps, hz);
  const facts = problem
    ? []
    : [
        mode === 'angle'
          ? { label: 'Shutter speed', value: shutter.speedLabel(seconds), unit: 's' }
          : { label: 'Shutter angle', value: fmt(angle, 1), unit: '°' },
        { label: 'Exposure', value: fmt(seconds * 1000, 2), unit: 'ms' },
        { label: '180° rule at this rate', value: shutter.speedLabel(rule), unit: 's' },
      ];
  const safeNow = !problem && (locked || shutter.isFlickerSafe(seconds, hz));

  const inputs = (
    <Rows>
      <ChoiceRow
        label="Convert"
        value={mode}
        onChange={(value) => {
          set('mode', value);
        }}
        options={[
          { value: 'angle', label: 'Angle to speed' },
          { value: 'speed', label: 'Speed to angle' },
        ]}
      />
      <NumberField
        id="sa-fps"
        label="Frame rate"
        value={state.fps}
        onChange={(value) => {
          set('fps', value);
        }}
        unit="fps"
      />
      <OptionRow label="Common">
        <span className="flex flex-wrap justify-end gap-2">
          {shutter.FRAME_RATES.map((rate) => (
            <button
              key={rate.label}
              type="button"
              aria-pressed={state.fps === rate.label}
              onClick={() => {
                set('fps', rate.label);
              }}
              className="h-9 rounded-control border border-border px-3 font-mono text-12.5 hover:border-text aria-pressed:border-text"
            >
              {rate.label}
            </button>
          ))}
        </span>
      </OptionRow>
      {mode === 'angle' ? (
        <NumberField
          id="sa-angle"
          label="Shutter angle"
          value={state.angle}
          onChange={(value) => {
            set('angle', value);
          }}
          unit="°"
        />
      ) : (
        <TextField
          id="sa-speed"
          label="Shutter speed"
          value={state.speed}
          placeholder="1/50"
          invalid={!(shutter.parseSpeed(state.speed) > 0)}
          onChange={(value) => {
            set('speed', value);
          }}
        />
      )}
      <ChoiceRow
        label="Mains power"
        value={oneOf(state.hz, MAINS, '50')}
        onChange={(value) => {
          set('hz', value);
        }}
        options={[
          { value: '50', label: '50 Hz' },
          { value: '60', label: '60 Hz' },
        ]}
      />
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      {!problem && <p className="mt-4 text-14">{shutter.motionLook(angle)}.</p>}
      <MonoLabel as="h2" size="md" className="mt-8">
        Flicker-safe under {hz} Hz light
      </MonoLabel>
      {!problem && (
        <p className="mt-3 flex items-center gap-2.5 text-14">
          <span
            aria-hidden="true"
            className={
              safeNow
                ? 'size-2 flex-none rounded-full bg-success'
                : 'size-2 flex-none rounded-full bg-warning'
            }
          />
          {locked
            ? `At ${fmt(fps, 3)} fps every frame starts at the same point of the light’s pulse, so no speed flickers. A rolling shutter may still show still bands.`
            : safeNow
              ? 'This speed spans whole pulses of the light: no flicker.'
              : 'This speed may flicker under mains-powered lights. Pick one below.'}
        </p>
      )}
      {safe.length > 0 && (
        <table className="mt-3 w-full max-w-120 text-left text-14">
          <caption className="sr-only">
            Shutter speeds that span whole pulses of {hz} Hz lighting, at this frame rate
          </caption>
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th scope="col" className="py-2 font-normal">
                Speed
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Angle
              </th>
            </tr>
          </thead>
          <tbody>
            {safe.map((row) => (
              <tr key={row.n} className="border-b border-border">
                <td className="py-2 font-mono text-12.5">{shutter.speedLabel(row.seconds)} s</td>
                <td className="py-2 text-right font-mono text-12.5">{fmt(row.angle, 1)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-13.5 text-text-muted">
        Lights on {hz} Hz mains pulse {hz * 2} times a second. A shutter open for a whole number of
        pulses sees the same light in every frame. LED lights with their own drivers may differ.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
