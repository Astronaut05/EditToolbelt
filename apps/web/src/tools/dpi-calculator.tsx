'use client';

import { useRef, useState, type ReactNode } from 'react';

import { print } from '@etb/core';
import { Button, CalculatorShell, MonoLabel, OptionRow, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, SelectField, useReady } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

const MODES = ['size', 'pixels', 'dpi'] as const;
const UNITS = ['cm', 'mm', 'in'] as const;

const DEFAULTS = {
  mode: 'size',
  w: '3000',
  h: '2000',
  dpi: '300',
  unit: 'cm',
  paper: 'a4',
  pw: '20',
  ph: '30',
};

const DPI_PRESETS = ['72', '150', '300'];

/** Lengths to the tenth of a unit (whole mm), as rulers read. */
const length = (value: number, unit: print.Unit) => fmt(value, unit === 'mm' ? 0 : 2);

/** U03 Print Size & DPI Calculator (tools/utility.md). */
export default function DpiCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const ready = useReady();
  const mode = oneOf(state.mode, MODES, 'size');
  const unit = oneOf(state.unit, UNITS, 'cm');
  const [readError, setReadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const w = num(state.w);
  const h = num(state.h);
  const dpi = num(state.dpi);
  const pixelsValid = w > 0 && h > 0;
  const paper = print.PAPERS.find((candidate) => candidate.id === state.paper);
  const printW = paper ? paper.width : num(state.pw);
  const printH = paper ? paper.height : num(state.ph);
  const printUnit: print.Unit = paper ? paper.unit : unit;

  /** Reads an image's pixel size in the browser; the file goes nowhere. */
  const readImage = async (file: File) => {
    setReadError(null);
    try {
      const bitmap = await createImageBitmap(file);
      set('w', String(bitmap.width));
      set('h', String(bitmap.height));
      bitmap.close();
    } catch {
      setReadError('This browser can’t read that image. Type its size instead.');
    }
  };

  let facts: { label: string; value: string; unit?: string }[] = [];
  let problem: string | null = null;
  let extra: ReactNode = null;

  if (mode === 'size') {
    if (!pixelsValid) problem = 'Enter a width and height in pixels above zero.';
    else if (!(dpi > 0)) problem = 'Enter a DPI above zero.';
    else {
      const best300 = print.largestPaper(w, h, 300);
      const best150 = print.largestPaper(w, h, 150);
      facts = [
        {
          label: 'Print size',
          value: `${length(print.printSize(w, dpi, unit), unit)} × ${length(print.printSize(h, dpi, unit), unit)}`,
          unit,
        },
        ...UNITS.filter((other) => other !== unit).map((other) => ({
          label: `In ${other === 'in' ? 'inches' : other}`,
          value: `${length(print.printSize(w, dpi, other), other)} × ${length(print.printSize(h, dpi, other), other)}`,
          unit: other,
        })),
        { label: 'Megapixels', value: fmt((w * h) / 1e6, 1), unit: 'MP' },
      ];
      extra = (
        <>
          <MonoLabel as="h2" size="md" className="mt-8">
            Largest paper it fills
          </MonoLabel>
          <ul className="mt-3 border-t border-border text-14">
            <li className="flex min-h-12 items-center justify-between gap-3 border-b border-border">
              <span>At 300 DPI, photo quality</span>
              <span className="font-mono">{best300?.label ?? 'Smaller than A6'}</span>
            </li>
            <li className="flex min-h-12 items-center justify-between gap-3 border-b border-border">
              <span>At 150 DPI, fine at arm’s length</span>
              <span className="font-mono">{best150?.label ?? 'Smaller than A6'}</span>
            </li>
          </ul>
        </>
      );
    }
  } else if (mode === 'pixels') {
    if (!(printW > 0) || !(printH > 0)) problem = 'Enter a print width and height above zero.';
    else if (!(dpi > 0)) problem = 'Enter a DPI above zero.';
    else {
      const pw = print.pixelsFor(printW, printUnit, dpi);
      const ph = print.pixelsFor(printH, printUnit, dpi);
      facts = [
        { label: 'Pixels needed', value: `${fmt(pw)} × ${fmt(ph)}`, unit: 'px' },
        { label: 'Megapixels', value: fmt((pw * ph) / 1e6, 1), unit: 'MP' },
        {
          label: 'Print size',
          value: `${length(printW, printUnit)} × ${length(printH, printUnit)}`,
          unit: printUnit,
        },
        { label: 'Landscape', value: `${fmt(ph)} × ${fmt(pw)}`, unit: 'px' },
      ];
    }
  } else {
    if (!pixelsValid) problem = 'Enter the image’s width and height in pixels.';
    else if (!(printW > 0) || !(printH > 0)) problem = 'Enter a print width and height above zero.';
    else {
      // Whichever way round fits the image better.
      const portraitImage = w <= h;
      const [shortPx, longPx] = portraitImage ? [w, h] : [h, w];
      const [shortPrint, longPrint] = printW <= printH ? [printW, printH] : [printH, printW];
      const across = print.dpiOf(shortPx, shortPrint, printUnit);
      const down = print.dpiOf(longPx, longPrint, printUnit);
      const effective = Math.min(across, down);
      const verdict = print.quality(effective);
      facts = [
        { label: 'Effective DPI', value: fmt(effective), unit: 'DPI' },
        { label: 'Short side', value: fmt(across), unit: 'DPI' },
        { label: 'Long side', value: fmt(down), unit: 'DPI' },
      ];
      extra = (
        <p className="mt-4 flex items-center gap-2.5 text-14">
          <span
            aria-hidden="true"
            className={
              verdict.level === 'print'
                ? 'size-2 flex-none rounded-full bg-success'
                : verdict.level === 'fair'
                  ? 'size-2 flex-none rounded-full bg-warning'
                  : 'size-2 flex-none rounded-full bg-danger'
            }
          />
          {verdict.label}
          {Math.abs(across - down) / Math.max(across, down) > 0.02 &&
            '. The shapes differ, so the print crops or leaves a border.'}
        </p>
      );
    }
  }

  const sizeOfImage = (
    <>
      <NumberField
        id="dpi-w"
        label="Width"
        value={state.w}
        onChange={(value) => {
          set('w', value);
        }}
        unit="px"
      />
      <NumberField
        id="dpi-h"
        label="Height"
        value={state.h}
        onChange={(value) => {
          set('h', value);
        }}
        unit="px"
      />
      <OptionRow label="From an image">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readImage(file);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          disabled={!ready}
          onClick={() => {
            picker.current?.click();
          }}
        >
          Use an image’s size
        </Button>
      </OptionRow>
      {readError && (
        <p role="alert" className="border-b border-border py-3 text-14">
          {readError}
        </p>
      )}
    </>
  );

  const printSizeInputs = (
    <>
      <SelectField
        id="dpi-paper"
        label="Paper"
        value={paper ? paper.id : 'custom'}
        onChange={(value) => {
          set('paper', value);
        }}
        options={[
          ...print.PAPERS.map((candidate) => ({ value: candidate.id, label: candidate.label })),
          { value: 'custom', label: 'Custom size' },
        ]}
      />
      {!paper && (
        <>
          <NumberField
            id="dpi-pw"
            label="Print width"
            value={state.pw}
            onChange={(value) => {
              set('pw', value);
            }}
            unit={unit}
          />
          <NumberField
            id="dpi-ph"
            label="Print height"
            value={state.ph}
            onChange={(value) => {
              set('ph', value);
            }}
            unit={unit}
          />
        </>
      )}
    </>
  );

  const unitChoice = (
    <ChoiceRow
      label="Units"
      value={unit}
      onChange={(value) => {
        set('unit', value);
      }}
      options={[
        { value: 'cm', label: 'cm' },
        { value: 'mm', label: 'mm' },
        { value: 'in', label: 'inches' },
      ]}
    />
  );

  const dpiInput = (
    <>
      <NumberField
        id="dpi-dpi"
        label="DPI"
        value={state.dpi}
        onChange={(value) => {
          set('dpi', value);
        }}
        unit="DPI"
      />
      <OptionRow label="Common">
        <span className="flex gap-2">
          {DPI_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={!ready}
              aria-pressed={state.dpi === preset}
              onClick={() => {
                set('dpi', preset);
              }}
              className="h-9 rounded-control border border-border px-3 font-mono text-12.5 hover:border-text aria-pressed:border-text"
            >
              {preset}
            </button>
          ))}
        </span>
      </OptionRow>
    </>
  );

  const inputs = (
    <Rows>
      <ChoiceRow
        label="Calculate"
        value={mode}
        onChange={(value) => {
          set('mode', value);
        }}
        options={[
          { value: 'size', label: 'Print size' },
          { value: 'pixels', label: 'Pixels needed' },
          { value: 'dpi', label: 'DPI of a print' },
        ]}
      />
      {mode !== 'pixels' && sizeOfImage}
      {mode !== 'dpi' && dpiInput}
      {mode !== 'size' && printSizeInputs}
      {(mode === 'size' || !paper) && unitChoice}
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      {extra}
      <p className="mt-6 text-13.5 text-text-muted">
        300 DPI is photo and print quality; 150 DPI is fine for posters and anything seen from a
        step back. Screens ignore DPI: only the pixels count there.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
