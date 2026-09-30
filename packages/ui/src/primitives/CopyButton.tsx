'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '../cn';

/**
 * Copies text to the clipboard. The icon turns into a check and the change is
 * announced, so success is never shown by colour alone. 44 px hit area.
 */
export function CopyButton({
  text,
  label,
  className,
  children,
}: {
  /** The text to copy, or a function that builds it on click. */
  text: string | (() => string);
  /** Accessible name of an icon-only button, e.g. "Copy ratio". */
  label: string;
  className?: string;
  /** Visible text next to the icon; icon-only when omitted. */
  children?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const Icon = state === 'copied' ? Check : Copy;
  const status = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : '';
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void copy();
        }}
        aria-label={children ? undefined : label}
        className={cn(
          'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control text-text-muted hover:text-text',
          children && 'px-3 text-14',
          className,
        )}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
        {children && <span>{state === 'copied' ? 'Copied' : children}</span>}
      </button>
      <span role="status" className="sr-only">
        {status}
      </span>
    </>
  );
}
