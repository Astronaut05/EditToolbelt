import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/Button';
import { formatBytes, formatTimecode, matchesAccept } from './format';

export interface OrderedFile {
  id: string;
  /** Local file name; never sent anywhere. */
  name: string;
  size: number;
  /** What it holds ("MP3 · 44.1 kHz · stereo"), once read. */
  summary?: string;
  durationSec?: number;
  /** Why it can't be used. */
  error?: string;
}

function IconButton({
  label,
  disabled,
  onClick,
  buttonRef,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  buttonRef?: (node: HTMLButtonElement | null) => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:text-text disabled:opacity-40 disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}

/**
 * The files to join, in the order they'll play (docs/03 → FileOrder): move
 * each up or down, remove it, or add more. Keyboard: every control is a
 * button, and focus stays on the moved file's button.
 */
export function FileOrder({
  items,
  onMove,
  onRemove,
  onAdd,
  accept,
  max,
  className,
}: {
  items: OrderedFile[];
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onAdd: (files: File[]) => void;
  accept: string;
  max: number;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  const total = items.reduce((sum, item) => sum + (item.durationSec ?? 0), 0);
  const known = items.every((item) => item.durationSec !== undefined);

  // A moved file's button keeps the focus, even when it reaches an end and is disabled.
  useEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    const button = buttons.current.get(key);
    if (button && !button.disabled) {
      button.focus();
    } else {
      const [id] = key.split(':');
      buttons.current.get(`${id ?? ''}:${key.endsWith(':up') ? 'down' : 'up'}`)?.focus();
    }
  }, [items]);

  const bind = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(key, node);
    else buttons.current.delete(key);
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ol aria-label="Files, in order" className="flex flex-col border-t border-border">
        {items.map((item, i) => (
          <li key={item.id} className="flex min-h-14 items-center gap-2 border-b border-border">
            <span className="w-7 shrink-0 font-mono text-12.5 tabular-nums text-text-muted">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 py-2">
              <span className="block truncate text-14">{item.name}</span>
              <span
                className={cn(
                  'block font-mono text-12 tabular-nums',
                  item.error ? 'text-danger' : 'text-text-muted',
                )}
              >
                {item.error ??
                  [
                    item.summary,
                    item.durationSec !== undefined ? formatTimecode(item.durationSec) : undefined,
                    formatBytes(item.size),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              </span>
            </span>
            <IconButton
              label={`Move ${item.name} up`}
              disabled={i === 0}
              buttonRef={bind(`${item.id}:up`)}
              onClick={() => {
                refocus.current = `${item.id}:up`;
                onMove(i, i - 1);
              }}
            >
              <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Move ${item.name} down`}
              disabled={i === items.length - 1}
              buttonRef={bind(`${item.id}:down`)}
              onClick={() => {
                refocus.current = `${item.id}:down`;
                onMove(i, i + 1);
              }}
            >
              <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Remove ${item.name}`}
              onClick={() => {
                onRemove(i);
              }}
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" disabled={items.length >= max} onClick={() => input.current?.click()}>
          Add files
        </Button>
        <span className="font-mono text-12 uppercase tracking-meta tabular-nums text-text-muted">
          {items.length} {items.length === 1 ? 'file' : 'files'}
          {known && items.length > 0 ? ` · ${formatTimecode(total)}` : ''}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Add files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter((file) =>
            matchesAccept(file, accept),
          );
          event.target.value = '';
          if (files.length > 0) onAdd(files);
        }}
      />
    </div>
  );
}
