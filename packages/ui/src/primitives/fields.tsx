'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../cn';

const field =
  'h-11 w-full rounded-control border border-border bg-bg px-3 text-14 text-text placeholder:text-text-muted transition-colors duration-(--dur-fast) hover:border-text focus-visible:border-text disabled:opacity-38';

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(field, className)} {...rest} />;
});

/** Number input with its unit always visible (px, MB, fps, LUFS). */
export function NumberWithUnit({
  unit,
  className,
  id,
  ...rest
}: Omit<ComponentProps<'input'>, 'type'> & { unit: string }) {
  const fallback = useId();
  const inputId = id ?? fallback;
  return (
    <span className={cn('relative inline-flex w-36 items-center', className)}>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        className={cn(field, 'pr-12 text-right font-mono')}
        {...rest}
      />
      <span className="pointer-events-none absolute right-3 font-mono text-12 uppercase text-text-muted">
        {unit}
      </span>
    </span>
  );
}

/** Native select with a visible chevron; `className` sizes it (w-56). */
export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex min-w-36', className)}>
      <select className={cn(field, 'cursor-pointer appearance-none truncate pr-9')} {...rest}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-muted"
      />
    </span>
  );
}

/** Native range, styled: 4 px track, accent fill is the browser's own (accent-color). */
export function Slider({ className, ...rest }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="range"
      className={cn('h-11 w-40 cursor-pointer accent-(--accent)', className)}
      {...rest}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked);
      }}
      className="group inline-flex h-11 items-center"
    >
      <span
        className={cn(
          'relative h-5 w-9 rounded-full border transition-colors duration-(--dur-fast)',
          checked ? 'border-text bg-text' : 'border-border bg-surface group-hover:border-text',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3.5 rounded-full transition-transform duration-(--dur-fast) ease-signal',
            checked ? 'translate-x-4.5 bg-bg' : 'translate-x-0.5 bg-text-muted',
          )}
        />
      </span>
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

export function ColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="color"
        autoComplete="off"
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="size-9 cursor-pointer rounded-control border border-border bg-bg p-0.5"
      />
      <span className="font-mono text-12.5 uppercase text-text">{value}</span>
    </span>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-13 text-text-muted">{children}</p>;
}
