import type { ReactNode } from 'react';

import { cn } from '../cn';

/**
 * Numbered hairline rows with mono numbers (01, 02 …): how-to steps, "what it
 * will do" on coming-soon pages.
 */
export function NumberedList({
  items,
  variant = 'steps',
  className,
}: {
  items: ReactNode[];
  /** steps: 38 px rows (how-to). prose: wrapping rows with more air (coming soon). */
  variant?: 'steps' | 'prose';
  className?: string;
}) {
  return (
    <ol className={cn(variant === 'prose' && 'border-t border-border', className)}>
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            'flex gap-4 border-b border-border',
            variant === 'steps' ? 'h-9.5 items-baseline text-15' : 'py-3.5 text-15.5 leading-body',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'w-5.5 flex-none font-mono text-12 text-text-muted',
              variant === 'prose' && 'pt-0.75',
            )}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}
