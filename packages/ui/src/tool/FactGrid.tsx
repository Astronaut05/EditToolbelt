import { cn } from '../cn';
import { CopyButton } from '../primitives/CopyButton';

export interface GridFact {
  label: string;
  value: string;
  unit?: string;
}

/**
 * Results of analyzer tools and calculators: mono label, big mono number and
 * unit (docs/03 → "Show the numbers"). `copyable` adds a copy button to each
 * fact (calculators, tools/subtitles-and-time.md).
 */
export function FactGrid({
  facts,
  className,
  copyable = false,
}: {
  facts: GridFact[];
  className?: string;
  copyable?: boolean;
}) {
  return (
    <dl className={cn('grid grid-cols-2 border-t border-border', className)}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="group relative min-w-0 border-b border-border py-4 odd:pr-6 even:border-l even:pl-6"
        >
          <dt className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            {fact.label}
          </dt>
          <dd className="mt-2 font-mono text-32 leading-none font-medium tracking-tight break-words">
            {fact.value}
            {fact.unit && <span className="ml-1.5 text-16 text-text-muted">{fact.unit}</span>}
            {/* Inside the <dd>: a <dl> group may only hold <dt> and <dd>. */}
            {copyable && (
              <CopyButton
                text={fact.value}
                label={`Copy ${fact.label.toLowerCase()}`}
                className="absolute top-1 right-0 group-odd:right-3"
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
