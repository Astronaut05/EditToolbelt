import { cn } from '../cn';

export interface Fact {
  /** Mono, uppercase: "3024 × 4032 px", "4.8 MB → 3.1 MB". */
  value: string;
  /** Screen-reader label: "Dimensions". */
  label: string;
}

/**
 * Facts strip over the preview (bottom-left, media scrim). The last cell, the
 * engine path, is in the media accent.
 */
export function Readout({ facts, className }: { facts: Fact[]; className?: string }) {
  return (
    <dl
      className={cn(
        'absolute bottom-6 left-6 z-10 flex rounded-control bg-media-scrim font-mono text-12 font-medium uppercase tracking-[0.08em] text-media-text',
        className,
      )}
    >
      {facts.map((fact, index) => (
        <div
          key={fact.label}
          className={cn(
            'px-3.5 py-2.5 whitespace-nowrap',
            index < facts.length - 1 ? 'border-r border-media-text/12' : 'text-media-accent',
          )}
        >
          <dt className="sr-only">{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Phone: the same facts as a hairline row under the full-bleed preview. */
export function ReadoutRow({
  facts,
}: {
  facts: { value: string; unit?: string; label: string }[];
}) {
  return (
    <dl className="flex justify-between border-b border-border px-4 py-3 font-mono text-11.5 font-medium uppercase tracking-meta text-text-muted">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="sr-only">{fact.label}</dt>
          <dd>
            <span className="text-text">{fact.value}</span>
            {fact.unit && ` ${fact.unit}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
