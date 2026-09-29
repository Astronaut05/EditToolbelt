import { cn } from '../cn';

export interface GridFact {
  label: string;
  value: string;
  unit?: string;
}

/**
 * Results of analyzer tools and calculators: mono label, big mono number and
 * unit (docs/03 → "Show the numbers").
 */
export function FactGrid({ facts, className }: { facts: GridFact[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 border-t border-border', className)}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="border-b border-border py-4 odd:pr-6 even:border-l even:pl-6"
        >
          <dt className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            {fact.label}
          </dt>
          <dd className="mt-2 font-mono text-32 leading-none font-medium tracking-tight">
            {fact.value}
            {fact.unit && <span className="ml-1.5 text-16 text-text-muted">{fact.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
