import type { ReactNode } from 'react';

import { cn } from '../cn';
import { MonoLabel } from './MonoLabel';

/**
 * Card: the exception to "hairlines over boxes" (design rule 2), used for
 * bordered panels such as the phone settings list.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-card border border-border bg-bg', className)}>{children}</div>;
}

/**
 * Empty and error states share the drop-zone layout: mono label, heading,
 * one line, action. Errors get a --danger dot, never a red background.
 */
export function StatePanel({
  label,
  title,
  body,
  actions,
  tone = 'neutral',
  className,
}: {
  label: string;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)} role={tone === 'danger' ? 'alert' : undefined}>
      <MonoLabel size="md" className="flex items-center gap-2.5">
        {tone === 'danger' && <span aria-hidden="true" className="size-2 rounded-full bg-danger" />}
        {label}
      </MonoLabel>
      <h2 className="mt-4 text-32 leading-title font-display tracking-display">{title}</h2>
      {body && <p className="mt-3.5 max-w-xl text-16.5 text-text-muted">{body}</p>}
      {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function EmptyState(props: Omit<Parameters<typeof StatePanel>[0], 'tone'>) {
  return <StatePanel {...props} />;
}

export function ErrorState(props: Omit<Parameters<typeof StatePanel>[0], 'tone'>) {
  return <StatePanel {...props} tone="danger" />;
}

/** When the browser can't do something, say what and offer the alternative. */
export function CapabilityNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-y border-border py-3.5 text-14" role="note">
      <span aria-hidden="true" className="mt-1.5 size-2 flex-none rounded-full bg-warning" />
      <div>
        <p className="font-strong">{title}</p>
        <p className="mt-0.5 text-text-muted">{children}</p>
      </div>
    </div>
  );
}

/** Balance in the header once accounts exist (M3+): mono number and unit. */
export function CreditBadge({ credits }: { credits: number }) {
  return (
    <span className="font-mono text-12.5 uppercase tracking-meta text-text">
      {credits} <span className="text-text-muted">credits</span>
    </span>
  );
}

/**
 * The price line before a paid run (docs/05; "never charge without a
 * confirm"): "This will use 6 credits · you have 120", same row style.
 */
export function PriceConfirm({
  credits,
  balance,
  actions,
}: {
  credits: number;
  balance: number;
  actions?: ReactNode;
}) {
  const short = balance < credits;
  return (
    <div className="border-y border-border py-3.5">
      <p className="text-14">
        This will use <span className="font-mono font-medium">{credits} credits</span>
        <span className="text-text-muted"> · you have </span>
        <span className="font-mono font-medium">{balance}</span>
      </p>
      {short && (
        <p className="mt-1 text-14 text-text-muted">
          You need {credits - balance} more credits for this file.
        </p>
      )}
      {actions && <div className="mt-3.5 flex gap-3">{actions}</div>}
    </div>
  );
}
