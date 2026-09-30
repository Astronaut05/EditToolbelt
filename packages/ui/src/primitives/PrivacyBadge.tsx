import { cn } from '../cn';

export type Noun = 'image' | 'video' | 'audio' | 'file';

/**
 * One line on where the work happens (docs/02 → ToolShell). Browser tools get
 * the accent dot; server tools a muted one (design rule 1: status dots).
 */
export function PrivacyBadge({
  runtime,
  noun = 'file',
  short = false,
  text,
  className,
}: {
  runtime: 'client' | 'hybrid' | 'server-cpu' | 'server-gpu';
  noun?: Noun;
  /** Phone copy: drops the first sentence. */
  short?: boolean;
  /** Replaces the default line (calculators: nothing is a file). */
  text?: string;
  className?: string;
}) {
  const server = runtime === 'server-cpu' || runtime === 'server-gpu';
  const line =
    text ??
    (server
      ? 'Processed on our servers, deleted within 1 hour.'
      : short
        ? `Your ${noun} never leaves your device.`
        : `Runs in your browser. Your ${noun} never leaves your device.`);
  return (
    <p className={cn('flex items-center gap-2.5 text-13.5', className)}>
      <span
        aria-hidden="true"
        className={cn('size-2 flex-none rounded-full', server ? 'bg-text-muted' : 'bg-accent')}
      />
      {line}
    </p>
  );
}
