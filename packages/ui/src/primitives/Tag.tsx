import type { ReactNode } from 'react';

import { cn } from '../cn';

type Tone = 'muted' | 'accent';

/** Uppercase mono tag: runtime on hub rows (BROWSER, AI · BROWSER), SOON. */
export function Tag({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-mono text-11 font-medium uppercase tracking-tag whitespace-nowrap',
        tone === 'accent' ? 'text-accent' : 'text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Bordered status tag: COMING SOON, BETA. */
export function StatusTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block self-start rounded-control border border-border px-2.5 py-1.5 font-mono text-11.5 font-medium uppercase leading-none tracking-label text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
