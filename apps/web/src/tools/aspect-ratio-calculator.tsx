'use client';

import { aspect } from '@etb/core';
import { CalculatorShell, MonoLabel, Switch, type ShellTool } from '@etb/ui';

import { ChoiceRow, fmt, num, NumberField, Results, Rows, TextField, useReady } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

type Mode = 'size' | 'solve' | 'fit';

const MODES = ['size', 'solve', 'fit'] as const;
const SIDES = ['width', 'height'] as const;

const DEFAULTS = {
  mode: 'size',
  width: '1920',
  height: '1080',
  ratio: '2.39:1',
  known: 'width',
  side: '1920',
  even: '1',
  boxW: '1920',
  boxH: '1080',
};

/** T05 Aspect Ratio Calculator (tools/subtitles-and-time.md). */
export default function AspectRatioCalculator({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const ready = useReady();
  const mode: Mode = oneOf(state.mode, MODES, 'size');
  const known = oneOf(state.known, SIDES, 'width');
  const even = state.even !== '0';
  const { width, height, ratio, side, boxW, boxH } = state;

  const w = num(width);
  const h = num(height);
  const sizeValid = w > 0 && h > 0;
  const parsedRatio = aspect.parseRatio(ratio);
  const sideValue = num(side);

  let facts: { label: string; value: string; unit?: string }[] = [];
  let problem: string | null = null;

  if (mode === 'size') {
    if (!sizeValid) problem = 'Enter a width and height above zero.';
    else {
      const simple = aspect.simplify(w, h);
      facts = [
        { label: 'Ratio', value: simple.label },
        { label: 'Decimal', value: `${simple.decimal.toFixed(3)}:1` },
        {
          label: 'Closest common',
          value:
            simple.nearest ??
            (aspect.COMMON_RATIOS.some((r) => r.label === simple.label) ? simple.label : 'None'),
        },
        { label: 'Megapixels', value: ((w * h) / 1e6).toFixed(2), unit: 'MP' },
      ];
    }
  } else if (mode === 'solve') {
    if (parsedRatio === null) problem = 'Type a ratio like 16:9, 2.39:1 or 1.85.';
    else if (!(sideValue > 0)) problem = `Enter the ${known} in pixels.`;
    else {
      const other =
        known === 'width'
          ? aspect.heightFor(sideValue, parsedRatio, even)
          : aspect.widthFor(sideValue, parsedRatio, even);
      const [fw, fh] = known === 'width' ? [sideValue, other] : [other, sideValue];
      facts = [
        { label: known === 'width' ? 'Height' : 'Width', value: fmt(other), unit: 'px' },
        { label: 'Frame', value: `${fmt(fw)} × ${fmt(fh)}`, unit: 'px' },
        {
          label: 'Exact',
          value: (known === 'width' ? sideValue / parsedRatio : sideValue * parsedRatio).toFixed(2),
          unit: 'px',
        },
        { label: 'Megapixels', value: ((fw * fh) / 1e6).toFixed(2), unit: 'MP' },
      ];
    }
  } else {
    const bw = num(boxW);
    const bh = num(boxH);
    if (!sizeValid || !(bw > 0) || !(bh > 0)) problem = 'Enter both sizes above zero.';
    else {
      const fit = aspect.fitInto(w, h, bw, bh, even);
      facts = [
        { label: 'Scaled size', value: `${fmt(fit.width)} × ${fmt(fit.height)}`, unit: 'px' },
        { label: 'Scale', value: fmt((fit.width / w) * 100, 1), unit: '%' },
        {
          label:
            fit.bars === 'letterbox'
              ? 'Letterbox bars'
              : fit.bars === 'pillarbox'
                ? 'Pillarbox bars'
                : 'Bars',
          value: fit.bars === 'none' ? 'None' : fmt(fit.barSize, 1),
          unit: fit.bars === 'none' ? undefined : 'px each',
        },
        { label: 'Box', value: `${fmt(bw)} × ${fmt(bh)}`, unit: 'px' },
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
          { value: 'size', label: 'Ratio of a size' },
          { value: 'solve', label: 'Missing side' },
          { value: 'fit', label: 'Fit into' },
        ]}
      />
      {mode === 'solve' ? (
        <>
          <TextField
            id="ar-ratio"
            label="Ratio"
            value={ratio}
            onChange={(value) => {
              set('ratio', value);
            }}
            invalid={parsedRatio === null}
          />
          <ChoiceRow
            label="Known side"
            value={known}
            onChange={(value) => {
              set('known', value);
            }}
            options={[
              { value: 'width', label: 'Width' },
              { value: 'height', label: 'Height' },
            ]}
          />
          <NumberField
            id="ar-side"
            label={known === 'width' ? 'Width' : 'Height'}
            value={side}
            onChange={(value) => {
              set('side', value);
            }}
            unit="px"
          />
        </>
      ) : (
        <>
          <NumberField
            id="ar-w"
            label="Width"
            value={width}
            onChange={(value) => {
              set('width', value);
            }}
            unit="px"
          />
          <NumberField
            id="ar-h"
            label="Height"
            value={height}
            onChange={(value) => {
              set('height', value);
            }}
            unit="px"
          />
        </>
      )}
      {mode === 'fit' && (
        <>
          <NumberField
            id="ar-bw"
            label="Box width"
            value={boxW}
            onChange={(value) => {
              set('boxW', value);
            }}
            unit="px"
          />
          <NumberField
            id="ar-bh"
            label="Box height"
            value={boxH}
            onChange={(value) => {
              set('boxH', value);
            }}
            unit="px"
          />
        </>
      )}
      {mode !== 'size' && (
        <div className="flex min-h-13.5 items-center justify-between border-b border-border">
          <span className="text-14 text-text-muted">Even numbers (video)</span>
          <Switch
            label="Even numbers for video"
            checked={even}
            onChange={(value) => {
              set('even', value ? '1' : '0');
            }}
          />
        </div>
      )}
    </Rows>
  );

  const results = (
    <Results facts={facts} problem={problem}>
      <MonoLabel as="h2" size="md" className="mt-8">
        Common ratios
      </MonoLabel>
      <ul className="mt-3 flex flex-wrap gap-2">
        {aspect.COMMON_RATIOS.map((common) => (
          <li key={common.label}>
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                set('mode', 'solve');
                set('ratio', common.label);
              }}
              className="h-9 rounded-control border border-border px-3 font-mono text-12.5 hover:border-text"
            >
              {common.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-13.5 text-text-muted">
        Video codecs need even dimensions. Keep “Even numbers” on for anything you will encode.
      </p>
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
