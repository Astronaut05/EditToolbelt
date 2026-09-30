'use client';

import type { ReactNode } from 'react';

import {
  cn,
  CopyButton,
  FactGrid,
  OptionRow,
  OptionsPanel,
  SegmentedControl,
  type GridFact,
} from '@etb/ui';

import { shareUrl } from './url-state';

/** Shared bits for calculator tools: hairline input rows and mono results. */

export function Rows({ children }: { children: ReactNode }) {
  return <OptionsPanel>{children}</OptionsPanel>;
}

const input =
  'h-11 rounded-control border border-border bg-bg px-3 font-mono text-14 text-text hover:border-text focus-visible:border-text';

export function NumberField({
  id,
  label,
  value,
  onChange,
  unit,
  width = 'w-36',
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  width?: string;
  step?: string;
}) {
  return (
    <OptionRow label={label} htmlFor={id}>
      <span className={cn('relative inline-flex items-center', width)}>
        <input
          id={id}
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={cn(input, 'w-full text-right', unit && 'pr-14')}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 font-mono text-12 uppercase text-text-muted">
            {unit}
          </span>
        )}
      </span>
    </OptionRow>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  width = 'w-44',
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: string;
  invalid?: boolean;
}) {
  return (
    <OptionRow label={label} htmlFor={id}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={cn(input, width, 'text-right', invalid && 'border-danger')}
      />
    </OptionRow>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <OptionRow label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={cn(input, 'w-44 cursor-pointer')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </OptionRow>
  );
}

export function ChoiceRow<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <OptionRow label={label}>
      <SegmentedControl label={label} value={value} onChange={onChange} options={options} />
    </OptionRow>
  );
}

/**
 * Results: big mono facts with copy buttons, an optional problem line
 * (--danger dot, never a red block), and "Copy link" to share the inputs.
 */
export function Results({
  facts,
  problem,
  children,
}: {
  facts: GridFact[];
  problem?: string | null;
  children?: ReactNode;
}) {
  return (
    <div>
      {problem ? (
        <p
          className="flex min-h-14 items-center gap-2.5 border-y border-border text-14"
          role="alert"
        >
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-danger" />
          {problem}
        </p>
      ) : (
        <FactGrid facts={facts} copyable />
      )}
      <CopyButton text={shareUrl} label="Copy link" className="-ml-3 mt-2">
        Copy link
      </CopyButton>
      {children}
    </div>
  );
}

/** Numbers as typed: accepts "1 920", "1,920" and "1920.5". */
export function num(value: string): number {
  const cleaned = value.replace(/[\s,]/g, '');
  return cleaned === '' ? Number.NaN : Number(cleaned);
}

export function fmt(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
