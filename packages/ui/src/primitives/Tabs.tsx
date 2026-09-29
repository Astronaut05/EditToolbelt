'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/** WAI-ARIA tabs with the Signal selection style (text + 600 + accent underline). */
export function Tabs({
  items,
  label,
  className,
}: {
  items: TabItem[];
  label: string;
  className?: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  function onKeyDown(event: KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    setActive(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-5.5 border-b border-border text-14.5"
      >
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={`${base}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActive(item.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
              className={cn(
                'min-h-11',
                selected ? 'font-strong text-text' : 'text-text-muted hover:text-text',
              )}
            >
              <span className={cn(selected && 'underline-accent')}>
                {item.label}
                {item.count !== undefined && (
                  <span className="ml-1.5 font-mono text-12 font-body text-text-muted">
                    {item.count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${base}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== active}
          className="pt-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
