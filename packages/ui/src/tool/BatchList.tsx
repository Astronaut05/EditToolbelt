import { Download } from 'lucide-react';

import { cn } from '../cn';
import { formatBytes } from './format';

export interface BatchItem {
  id: string;
  /** Local file name; never sent anywhere. */
  name: string;
  size: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  /** 0-1 while running. */
  progress?: number;
  resultSize?: number;
  error?: string;
  /** What changed in this file, e.g. "3 style overrides removed". */
  note?: string;
}

const STATUS: Record<BatchItem['status'], string> = {
  queued: 'Queued',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
};

/** One row per file: name, size, status, result size, download (docs/03 → BatchList). */
export function BatchList({
  items,
  onDownload,
  className,
}: {
  items: BatchItem[];
  onDownload?: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-14">
        <caption className="sr-only">Files</caption>
        <thead>
          <tr className="border-b border-border font-mono text-11.5 uppercase tracking-label text-text-muted">
            <th scope="col" className="py-2.5 pr-4 font-medium">
              File
            </th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">
              Size
            </th>
            <th scope="col" className="py-2.5 pr-4 font-medium">
              Status
            </th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">
              Result
            </th>
            <th scope="col" className="py-2.5 font-medium">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="h-13 border-b border-border">
              <td className="max-w-60 truncate pr-4">{item.name}</td>
              <td className="pr-4 text-right font-mono text-12.5 text-text-muted">
                {formatBytes(item.size)}
              </td>
              <td className="pr-4">
                <span className="inline-flex items-center gap-2 font-mono text-12 uppercase tracking-meta">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 rounded-full',
                      item.status === 'done'
                        ? 'bg-accent'
                        : item.status === 'failed'
                          ? 'bg-danger'
                          : 'bg-text-muted',
                    )}
                  />
                  {STATUS[item.status]}
                  {item.status === 'running' &&
                    item.progress !== undefined &&
                    ` ${String(Math.round(item.progress * 100))}%`}
                </span>
                {item.error && <span className="block text-13 text-text-muted">{item.error}</span>}
                {item.note && <span className="block text-13 text-text-muted">{item.note}</span>}
              </td>
              <td className="pr-4 text-right font-mono text-12.5">
                {item.resultSize !== undefined ? formatBytes(item.resultSize) : ''}
              </td>
              <td className="w-11 text-right">
                {item.status === 'done' && onDownload && (
                  <button
                    type="button"
                    onClick={() => {
                      onDownload(item.id);
                    }}
                    className="inline-flex size-11 items-center justify-center text-text-muted hover:text-text"
                  >
                    <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span className="sr-only">Download {item.name}</span>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
