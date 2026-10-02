'use client';

import { Download, Plus, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import { color, gradient as grad } from '@etb/core';
import {
  Button,
  CalculatorShell,
  ColorInput,
  CopyButton,
  MonoLabel,
  OptionRow,
  type ShellTool,
} from '@etb/ui';

import { ChoiceRow, NumberField, Results, Rows, TextField, num } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

/** Stops in the URL: "2563eb@0,f97316@100". */
const DEFAULTS = {
  k: 'linear',
  a: '90',
  s: '2563eb@0,f97316@100',
  m: 'smooth',
  w: '1920',
  h: '1080',
};

const KINDS = ['linear', 'radial', 'conic'] as const;
const MAX_STOPS = 8;
/** Pixels on the longer side of a PNG: 8,000, drawn in this tab in a second or two. */
const MAX_SIDE = 8000;

interface Stop {
  hex: string;
  at: string;
}

const noSubscribe = () => () => undefined;

function readStops(value: string): Stop[] {
  const stops = value
    .split(',')
    .map((part) => {
      const [hex = '', at = ''] = part.split('@');
      return { hex: `#${hex.replace(/^#/, '')}`, at };
    })
    .slice(0, MAX_STOPS);
  return stops.length >= 2 ? stops : readStops(DEFAULTS.s);
}

const writeStops = (stops: Stop[]) =>
  stops.map((stop) => `${stop.hex.replace(/^#/, '')}@${stop.at}`).join(',');

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** C07 Gradient Generator (tools/color.md): linear, radial or conic, as CSS or a PNG. */
export default function GradientGenerator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  // The page is server-rendered: until its script runs, Save PNG would do nothing.
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [status, setStatus] = useState('');
  const kind = oneOf(state.k, KINDS, 'linear');
  const smooth = state.m !== 'plain';
  const stops = readStops(state.s);
  const parsed = stops.map((stop) => ({ stop, color: color.parseColor(stop.hex) }));
  const width = Math.round(num(state.w));
  const height = Math.round(num(state.h));
  const angle = num(state.a);

  const setStop = (index: number, patch: Partial<Stop>) => {
    set('s', writeStops(stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop))));
  };

  const inputs = (
    <Rows>
      <ChoiceRow
        label="Type"
        value={kind}
        onChange={(value) => {
          set('k', value);
        }}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
          { value: 'conic', label: 'Conic' },
        ]}
      />
      {kind !== 'radial' && (
        <NumberField
          id="gg-angle"
          label={kind === 'conic' ? 'Starts at' : 'Angle'}
          value={state.a}
          onChange={(value) => {
            set('a', value);
          }}
          unit="deg"
        />
      )}
      {stops.map((stop, i) => {
        const ok = parsed[i]?.color.ok ?? false;
        return (
          <div key={i} className="flex flex-col gap-2 border-t border-border pt-3">
            <TextField
              id={`gg-stop-${String(i)}`}
              label={`Stop ${String(i + 1)}`}
              value={stop.hex}
              onChange={(value) => {
                setStop(i, { hex: value });
              }}
              placeholder="#2563eb"
              width="w-40"
              invalid={!ok}
            />
            <OptionRow label="Pick">
              <span className="flex items-center gap-2">
                <ColorInput
                  label={`Pick stop ${String(i + 1)}`}
                  value={
                    ok && parsed[i]?.color.ok
                      ? color.toHex({ ...parsed[i].color.rgb, a: 1 })
                      : '#000000'
                  }
                  onChange={(value) => {
                    setStop(i, { hex: value });
                  }}
                />
                {stops.length > 2 && (
                  <Button
                    type="button"
                    icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
                    onClick={() => {
                      set('s', writeStops(stops.filter((_, j) => j !== i)));
                    }}
                  >
                    Remove stop {i + 1}
                  </Button>
                )}
              </span>
            </OptionRow>
            <NumberField
              id={`gg-at-${String(i)}`}
              label={`Stop ${String(i + 1)} at`}
              value={stop.at}
              onChange={(value) => {
                setStop(i, { at: value });
              }}
              unit="%"
            />
          </div>
        );
      })}
      {stops.length < MAX_STOPS && (
        <OptionRow label="Stops">
          <Button
            type="button"
            icon={<Plus aria-hidden="true" size={16} strokeWidth={1.75} />}
            onClick={() => {
              // Halfway between the last two, in their blended color.
              const a = parsed.at(-2);
              const b = parsed.at(-1);
              const at = (num(a?.stop.at ?? '0') + num(b?.stop.at ?? '100')) / 2;
              const mid =
                a?.color.ok && b?.color.ok
                  ? color.toHex(color.toBytes(grad.blend(a.color.rgb, b.color.rgb, 0.5, smooth)))
                  : '#808080';
              const next = [...stops];
              next.splice(stops.length - 1, 0, { hex: mid, at: String(Math.round(at)) });
              set('s', writeStops(next));
            }}
          >
            Add a stop
          </Button>
        </OptionRow>
      )}
      <ChoiceRow
        label="Blend"
        value={smooth ? 'smooth' : 'plain'}
        onChange={(value) => {
          set('m', value);
        }}
        options={[
          { value: 'smooth', label: 'Smooth · Oklch' },
          { value: 'plain', label: 'Plain · sRGB' },
        ]}
      />
      <NumberField
        id="gg-width"
        label="PNG width"
        value={state.w}
        onChange={(value) => {
          set('w', value);
        }}
        unit="px"
      />
      <NumberField
        id="gg-height"
        label="PNG height"
        value={state.h}
        onChange={(value) => {
          set('h', value);
        }}
        unit="px"
      />
    </Rows>
  );

  const bad = parsed.findIndex((entry) => !entry.color.ok);
  const badAt = stops.findIndex((stop) => !(num(stop.at) >= 0 && num(stop.at) <= 100));
  const problem =
    bad >= 0
      ? `Stop ${String(bad + 1)}: ${parsed[bad]?.color.ok === false ? parsed[bad].color.error : ''}`
      : badAt >= 0
        ? `Stop ${String(badAt + 1)}: a position from 0 to 100 %.`
        : kind !== 'radial' && !Number.isFinite(angle)
          ? 'Set the angle in degrees.'
          : null;
  if (problem) {
    return (
      <CalculatorShell
        tool={tool}
        inputs={inputs}
        results={<Results facts={[]} problem={problem} />}
      />
    );
  }

  const value: grad.Gradient = {
    kind,
    angle,
    smooth,
    stops: parsed.map(({ stop, color: c }) => ({
      color: c.ok ? c.rgb : { r: 0, g: 0, b: 0, a: 1 },
      at: num(stop.at) / 100,
    })),
  };
  const css = grad.gradientCss(value);
  const sizeOk =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    Math.max(width, height) <= MAX_SIDE;

  const shape = sizeOk ? { w: width, h: height } : { w: 16, h: 9 };

  const savePng = () => {
    setSaving(true);
    setStatus('');
    // Drawn after the button shows it's working: a large PNG takes a moment.
    setTimeout(() => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.putImageData(
          new ImageData(grad.renderGradient(value, width, height), width, height),
          0,
          0,
        );
        canvas.toBlob((blob) => {
          setSaving(false);
          if (blob) save(blob, `gradient-${String(width)}x${String(height)}.png`);
          else setStatus('The PNG could not be made in this browser.');
        }, 'image/png');
      } catch {
        setSaving(false);
        setStatus('The PNG could not be made in this browser. Try a smaller size.');
      }
    }, 30);
  };

  const results = (
    <Results
      facts={[
        { label: 'Stops', value: String(stops.length) },
        { label: 'Blend', value: smooth ? 'Oklch' : 'sRGB' },
      ]}
    >
      <div
        role="img"
        aria-label={`Preview of the ${kind} gradient`}
        className="mt-6 w-full rounded-card border border-border"
        // The PNG's shape, no taller than 22rem: the width gives way, so the layout matches the PNG.
        style={{
          backgroundImage: css,
          aspectRatio: `${String(shape.w)} / ${String(shape.h)}`,
          maxWidth: `calc(22rem * ${String(shape.w / shape.h)})`,
        }}
      />
      <MonoLabel as="h2" size="md" className="mt-8">
        CSS
      </MonoLabel>
      <div className="mt-3 flex items-start gap-2 rounded-card border border-border p-3">
        <code className="min-w-0 flex-1 font-mono text-12.5 break-all" data-testid="gradient-css">
          background-image: {css};
        </code>
        <CopyButton text={`background-image: ${css};`} label="Copy the CSS" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!ready || !sizeOk || saving}
          icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
          onClick={savePng}
        >
          {saving ? 'Drawing…' : `Save PNG · ${String(width)} × ${String(height)} px`}
        </Button>
        {!sizeOk && (
          <p className="text-14 text-text-muted">
            A PNG from 1 to {MAX_SIDE.toLocaleString('en')} px a side.
          </p>
        )}
      </div>
      {status && (
        <p role="status" className="mt-3 text-14">
          {status}
        </p>
      )}
      <p className="mt-3 text-13.5 text-text-muted">
        {smooth
          ? 'Smooth blends in Oklch, so the middle stays as clear as the ends. The CSS spells it out as a stop every 10 %, so it looks the same in every browser.'
          : 'Plain blends in sRGB, as CSS does by default. Opposite colors can meet in a grey or muddy middle; Smooth avoids it.'}{' '}
        The PNG is dithered, so no bands show.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
