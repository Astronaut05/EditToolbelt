'use client';

import { useId, useRef, type KeyboardEvent } from 'react';

import { cn } from '../cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Small mono count after the label (hub filters: "All 19"). */
  count?: number;
}

/**
 * One choice out of a few, shown as text options. Selected = --text, weight
 * 600 and a 2 px accent underline; never colour alone (design rule 3). A radio
 * group for assistive tech: arrow keys move the selection, Tab leaves.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
}: {
  /** Accessible name, e.g. "Background". */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const name = useId();

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex items-center',
        size === 'lg' ? 'gap-5.5 text-14.5' : 'gap-4 text-14',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className={cn(
              'inline-flex min-h-11 items-center transition-colors duration-(--dur-fast)',
              selected ? 'font-strong text-text' : 'text-text-muted hover:text-text',
            )}
          >
            <span className={cn('leading-tight', selected && 'underline-accent')}>
              {option.label}
              {option.count !== undefined && (
                <span className="ml-1.5 font-mono text-12 font-body text-text-muted">
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
