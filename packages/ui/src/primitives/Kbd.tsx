import type { ReactNode } from 'react';

import { cn } from '../cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'rounded-control border border-border px-1.5 py-0.5 font-mono text-12 font-medium text-text',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
