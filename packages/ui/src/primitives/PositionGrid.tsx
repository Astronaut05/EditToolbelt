'use client';

import { useRef, type KeyboardEvent } from 'react';

import { cn } from '../cn';

/**
 * A spot on a 3 × 3 grid (a watermark's corner, edge or centre). Nine
 * choices, in reading order. A radio group: arrow keys move across and
 * down, Tab leaves. The chosen cell is filled and ringed, not only coloured
 * (design rule 3); each cell is named ("Bottom right").
 */
export function PositionGrid({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  /** Nine, row by row from the top left. */
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = options.length - 1;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 3,
      ArrowUp: -3,
    };
    const next =
      event.key in step
        ? (index + (step[event.key] ?? 0) + options.length) % options.length
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
      className="grid w-fit grid-cols-3 gap-1 rounded-control border border-border p-1"
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
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            className="group grid size-8 place-items-center rounded-[3px] hover:bg-surface"
          >
            <span
              aria-hidden
              className={cn(
                'block rounded-full transition-[width,height] duration-(--dur-fast)',
                selected
                  ? 'size-3.5 bg-text ring-2 ring-text ring-offset-2 ring-offset-bg'
                  : 'size-1.5 bg-text-muted group-hover:bg-text',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
