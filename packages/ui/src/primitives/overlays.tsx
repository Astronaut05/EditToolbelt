'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../cn';

/**
 * Modal dialog on the native <dialog>: focus is trapped and restored, Esc
 * closes. `sheet` slides up from the bottom on phones (docs/03 → Mobile: options
 * open in a bottom sheet) and is a centred dialog from 640 px up.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  variant = 'dialog',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: 'dialog' | 'sheet';
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'border border-border bg-bg p-0 text-text backdrop:bg-media-scrim/60',
        variant === 'sheet'
          ? 'mx-0 mt-auto mb-0 w-full max-w-none rounded-t-card sm:m-auto sm:max-w-md sm:rounded-card'
          : 'm-auto w-[calc(100%-32px)] max-w-md rounded-card',
        className,
      )}
    >
      <div className="flex h-13 items-center justify-between border-b border-border pr-1 pl-4">
        <h2 className="text-16 font-strong">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-11 items-center justify-center text-text-muted hover:text-text"
        >
          <X aria-hidden="true" size={18} strokeWidth={1.75} />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

/** Short status message, announced politely; no colour-only meaning. */
export function Toast({
  children,
  tone = 'neutral',
  onDismiss,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'danger' | 'success';
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-control bg-media-scrim py-2.5 pr-1 pl-4 text-14 text-media-text"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 flex-none rounded-full',
          tone === 'danger'
            ? 'bg-danger'
            : tone === 'success'
              ? 'bg-media-accent'
              : 'bg-media-text-muted',
        )}
      />
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex size-9 items-center justify-center text-media-text-muted hover:text-media-text"
        >
          <X aria-hidden="true" size={16} />
          <span className="sr-only">Dismiss</span>
        </button>
      )}
    </div>
  );
}

/** Hover and focus hint. The trigger keeps its own accessible name; this adds a description. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-control bg-media-scrim px-2 py-1 font-mono text-11 whitespace-nowrap text-media-text opacity-0 transition-opacity duration-(--dur-fast) group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
