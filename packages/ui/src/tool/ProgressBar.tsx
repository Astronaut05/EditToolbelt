import { cn } from '../cn';

export interface ProgressMeta {
  /** Left: "74 / 115 MB". */
  amount?: string;
  /** Middle: "Step 1 of 2 · then finding the subject". */
  step?: string;
  /** Right: seconds since start. */
  elapsedSec: number;
}

/**
 * Progress over the preview (media scrim, always dark). Determinate when
 * `fraction` is set; indeterminate otherwise. Announced to screen readers
 * through the native progressbar role.
 */
export function ProgressBar({
  title,
  fraction,
  meta,
  className,
}: {
  title: string;
  fraction?: number;
  meta: ProgressMeta;
  className?: string;
}) {
  const percent =
    fraction === undefined ? undefined : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div
      className={cn(
        'absolute inset-x-6 bottom-6 z-10 rounded-control bg-media-scrim px-5 py-4.5 text-media-text',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-17 font-strong">{title}</p>
        {percent !== undefined && (
          <p className="font-mono text-13 font-medium tracking-meta">{percent}%</p>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-3.5 h-1 overflow-hidden bg-media-text/15"
      >
        <div
          className={cn(
            'h-1 bg-media-accent transition-[width] duration-(--dur) ease-signal',
            percent === undefined && 'w-1/3 animate-pulse',
          )}
          style={percent === undefined ? undefined : { width: `${String(percent)}%` }}
        />
      </div>
      <div className="mt-3 flex justify-between gap-4 font-mono text-12 uppercase tracking-meta text-media-text-muted">
        <span>{meta.amount && <b className="font-medium text-media-text">{meta.amount}</b>}</span>
        <span className="hidden sm:inline">{meta.step}</span>
        <span>
          Elapsed <b className="font-medium text-media-text">{meta.elapsedSec.toFixed(1)} s</b>
        </span>
      </div>
    </div>
  );
}
