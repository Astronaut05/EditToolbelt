'use client';

import { color, CSS_NAMED_COLORS } from '@etb/core';
import {
  CalculatorShell,
  cn,
  ColorInput,
  CopyButton,
  FactList,
  MonoLabel,
  OptionRow,
  type ShellTool,
} from '@etb/ui';

import { Rows, TextField } from './calc-ui';
import { shareUrl, useQueryState } from './url-state';

const DEFAULTS = { c: '#ff6347' };

/** A colour chip; the checkerboard shows through when there is transparency. */
function Chip({ hex, size = 'size-5' }: { hex: string; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'checkerboard inline-block flex-none rounded-control border border-border',
        size,
      )}
    >
      <span className="block size-full rounded-control" style={{ background: hex }} />
    </span>
  );
}

/** C03 Color Converter (tools/color.md): one colour in, every notation out. */
export default function ColorConverter({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const result = color.parseColor(state.c);
  const setColor = (value: string) => {
    set('c', value);
  };

  const inputs = (
    <Rows>
      <TextField
        id="color-input"
        label="Color"
        value={state.c}
        onChange={setColor}
        placeholder="#ff6347"
        width="w-52"
        invalid={!result.ok}
      />
      <OptionRow label="Pick">
        <ColorInput
          label="Pick a color"
          value={result.ok ? color.toHex({ ...result.rgb, a: 1 }) : '#000000'}
          onChange={setColor}
        />
      </OptionRow>
    </Rows>
  );

  if (!result.ok) {
    return (
      <CalculatorShell
        tool={tool}
        inputs={inputs}
        results={
          <p
            className="flex min-h-14 items-center gap-2.5 border-y border-border text-14"
            role="alert"
          >
            <span aria-hidden="true" className="size-2 flex-none rounded-full bg-danger" />
            {result.error}
          </p>
        }
      />
    );
  }

  const { rgb, clipped } = result;
  const all = color.formats(rgb);
  const name = color.nearestName(rgb);
  const { tints, shades } = color.tintsAndShades(rgb);
  const ramp = [...tints, rgb, ...shades].map((step) => color.toHex(step));

  const results = (
    <div>
      <div className="checkerboard h-28 border border-border lg:h-36">
        <div className="size-full" style={{ background: all.hex }} />
      </div>
      {clipped && (
        <p className="mt-3 flex items-center gap-2.5 text-14">
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-warning" />
          Outside what sRGB screens can show: clipped to the nearest color they can.
        </p>
      )}
      <FactList
        className="mt-6"
        facts={[
          { label: 'HEX', value: all.hex },
          { label: 'RGB', value: all.rgb },
          { label: 'HSL', value: all.hsl },
          { label: 'HSV / HSB', value: all.hsv },
          {
            label: 'CMYK',
            value: all.cmyk,
            note: 'Approximate, not color-managed. Printers use ICC profiles.',
          },
          {
            label: 'Lab',
            value: all.lab,
            note: 'CIE Lab, D50 white, as CSS lab() and Photoshop use.',
          },
          { label: 'Oklch', value: all.oklch },
          {
            label: 'Name',
            value: name.name,
            note:
              name.distance < 0.05
                ? 'Exact CSS color name.'
                : `Nearest CSS color name, ΔE ${name.distance.toFixed(1)} (Oklab).`,
            lead: <Chip hex={CSS_NAMED_COLORS[name.name] ?? all.hex} />,
          },
        ]}
      />
      <CopyButton text={shareUrl} label="Copy link" className="-ml-3 mt-2">
        Copy link
      </CopyButton>
      <MonoLabel as="h2" size="md" className="mt-8">
        Tints and shades
      </MonoLabel>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-9">
        {ramp.map((hex, index) => (
          <li key={`${hex}-${String(index)}`}>
            <button
              type="button"
              onClick={() => {
                setColor(hex);
              }}
              aria-current={index === 4 ? 'true' : undefined}
              aria-label={`Use ${hex}`}
              className="group flex w-full flex-col items-stretch gap-1.5 text-left"
            >
              <span className="checkerboard block h-12 rounded-control border border-border group-hover:border-text">
                <span className="block size-full rounded-control" style={{ background: hex }} />
              </span>
              <span
                className={cn('font-mono text-11.5', index === 4 ? 'text-text' : 'text-text-muted')}
              >
                {hex}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-13.5 text-text-muted">
        Tints mix toward white and shades toward black in 20% steps, in linear light. Select one to
        convert it.
      </p>
    </div>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
