import type { ReactNode } from 'react';

import { cn } from '../cn';

/** Settings as hairline rows (design rule 2): label left, control right. */
export function OptionsPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('border-t border-border', className)}>{children}</div>;
}

export function OptionRow({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  /** Set when the control is a single labelable element (input, select). */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div
      className={cn(
        'flex min-h-13.5 items-center justify-between gap-4 border-b border-border',
        className,
      )}
    >
      <Label htmlFor={htmlFor} className="text-14 text-text-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Read-only fact in a settings row, in mono (e.g. the AI model). */
export function OptionFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <OptionRow label={label}>
      <span className="text-right font-mono text-12.5 uppercase text-text-muted">{children}</span>
    </OptionRow>
  );
}
