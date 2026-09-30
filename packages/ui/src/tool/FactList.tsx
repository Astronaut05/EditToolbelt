import type { ReactNode } from 'react';

import { cn } from '../cn';
import { CopyButton } from '../primitives/CopyButton';

export interface ListFact {
  label: string;
  value: string;
  /** Muted line under the value, e.g. "approximate, not color-managed". */
  note?: string;
  /** Leading visual, e.g. a colour chip. */
  lead?: ReactNode;
}

/**
 * Long results in one column: mono label, mono value, a copy button per row
 * (colour codes, payloads). The two-column FactGrid is for short numbers.
 */
export function FactList({
  facts,
  className,
  copyable = true,
}: {
  facts: ListFact[];
  className?: string;
  copyable?: boolean;
}) {
  return (
    <dl className={cn('border-t border-border', className)}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="grid min-h-14 grid-cols-[6.5rem_1fr_auto] items-center gap-x-3 border-b border-border py-2 sm:grid-cols-[8rem_1fr_auto]"
        >
          <dt className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            {fact.label}
          </dt>
          <dd className="min-w-0">
            <span className="flex items-center gap-2.5">
              {fact.lead}
              <span className="font-mono text-15 break-all sm:text-16">{fact.value}</span>
            </span>
            {fact.note && (
              <span className="mt-0.5 block text-12.5 text-text-muted">{fact.note}</span>
            )}
          </dd>
          {copyable && (
            <dd>
              <CopyButton text={fact.value} label={`Copy ${fact.label}`} />
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
