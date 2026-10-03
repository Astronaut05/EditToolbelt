import type { ReactNode, Ref } from 'react';

import { cn } from '../cn';

/** Settings as hairline rows (design rule 2): label left, control right. */
export function OptionsPanel({
  children,
  className,
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={cn('border-t border-border', className)}>
      {children}
    </div>
  );
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

/** A settings row whose control needs the width: the label above it (a checklist). */
export function OptionStack({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-border pt-4 pb-5', className)}>
      <span className="mb-3 block text-14 text-text-muted" aria-hidden="true">
        {label}
      </span>
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
