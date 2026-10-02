'use client';

import { ADJUST_RANGES, adjustValue, NO_ADJUST, type Adjust } from '@etb/engines';
import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '../cn';
import { Slider } from '../primitives/fields';

const LABELS: Record<keyof Adjust, string> = {
  exposure: 'Exposure',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  warmth: 'Warmth',
};

const KEYS = Object.keys(LABELS) as (keyof Adjust)[];

function AdjustSlider({
  name,
  value,
  onChange,
  shown,
}: {
  name: keyof Adjust;
  value: number;
  onChange: (value: number, done: boolean) => void;
  /** On phones only the chosen slider shows. */
  shown: boolean;
}) {
  const id = useId();
  const range = ADJUST_RANGES[name];
  const text = adjustValue(name, value);
  return (
    <span className={cn('items-center gap-2', shown ? 'flex' : 'hidden sm:flex')}>
      <label htmlFor={id} className="w-20 text-14 text-text-muted">
        {LABELS[name]}
      </label>
      <Slider
        id={id}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-valuetext={text || '0'}
        onChange={(event) => {
          onChange(Number(event.target.value), false);
        }}
        onPointerUp={(event) => {
          onChange(Number(event.currentTarget.value), true);
        }}
        onKeyUp={(event) => {
          onChange(Number(event.currentTarget.value), true);
        }}
        onDoubleClick={() => {
          onChange(0, true);
        }}
        className="min-w-0 flex-1 sm:max-w-28 sm:flex-none"
      />
      <output htmlFor={id} className="w-14 font-mono text-12.5">
        {text || '0'}
      </output>
    </span>
  );
}

/**
 * The adjust mode's toolbar: exposure (EV), brightness, contrast, saturation
 * and warmth (−100 to 100), each a slider that previews live; letting go
 * makes it one undo step. Double-click a slider, or Reset, for zero. On a
 * phone, a row of chips picks one and only its slider shows, so the photo
 * keeps the room.
 */
export function AdjustBar({
  adjust,
  onAdjust,
}: {
  adjust: Adjust;
  /** `transient` while a slider moves. */
  onAdjust: (adjust: Adjust, transient?: boolean) => void;
}) {
  const moved = KEYS.some((key) => adjust[key] !== 0);
  const [chosen, setChosen] = useState<keyof Adjust>('brightness');
  return (
    <div className="flex flex-none flex-col gap-x-6 border-b border-border bg-bg px-3 py-1 sm:flex-row sm:flex-wrap sm:items-center">
      <div
        role="group"
        aria-label="Adjustment"
        className="-mx-3 flex overflow-x-auto px-1 sm:hidden"
      >
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={chosen === key}
            onClick={() => {
              setChosen(key);
            }}
            className={cn(
              'inline-flex h-11 flex-none items-center px-2.5 text-14',
              chosen === key ? 'font-strong text-text' : 'text-text-muted',
            )}
          >
            <span className={cn(chosen === key && 'underline-accent')}>{LABELS[key]}</span>
            {adjust[key] !== 0 && (
              <span aria-hidden="true" className="ml-1 size-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
        <button
          type="button"
          disabled={!moved}
          onClick={() => {
            onAdjust(NO_ADJUST);
          }}
          className="ml-auto inline-flex h-11 flex-none items-center px-2.5 text-14 text-text-muted disabled:opacity-38"
        >
          Reset
        </button>
      </div>
      {KEYS.map((key) => (
        <AdjustSlider
          key={key}
          name={key}
          shown={chosen === key}
          value={adjust[key]}
          onChange={(value, done) => {
            const step = ADJUST_RANGES[key].step;
            onAdjust({ ...adjust, [key]: Math.round(value / step) * step }, !done);
          }}
        />
      ))}
      <button
        type="button"
        disabled={!moved}
        onClick={() => {
          onAdjust(NO_ADJUST);
        }}
        className="hidden h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text disabled:opacity-38 sm:ml-auto sm:inline-flex"
      >
        <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
        Reset
      </button>
    </div>
  );
}
