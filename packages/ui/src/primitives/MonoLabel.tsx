import type { ElementType, ReactNode } from 'react';

import { cn } from '../cn';

/** Uppercase mono micro-label (+0.14em): section labels, STEP 1, footer headings. */
export function MonoLabel({
  children,
  as: Tag = 'p',
  size = 'sm',
  className,
  id,
}: {
  children: ReactNode;
  as?: ElementType;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        'font-mono font-medium uppercase tracking-label text-text-muted',
        size === 'md' ? 'text-12' : 'text-11.5',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
