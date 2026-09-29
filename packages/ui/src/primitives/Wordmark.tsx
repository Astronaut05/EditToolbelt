import { cn } from '../cn';

/**
 * Placeholder logo until open question 1 is decided: "Edit" + "Toolbelt" in
 * the accent (docs/design/README.md → Changes to 03).
 */
export function Wordmark({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'font-bold tracking-title whitespace-nowrap',
        size === 'lg' ? 'text-22' : 'text-17',
        className,
      )}
    >
      Edit<span className="text-accent">Toolbelt</span>
    </span>
  );
}
