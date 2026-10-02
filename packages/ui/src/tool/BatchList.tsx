import { CircleAlert, Download } from 'lucide-react';
import { Fragment } from 'react';

import { cn } from '../cn';
import { CopyButton } from '../primitives/CopyButton';
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
  /** U02: the file's new name, what's wrong with it, and whether that stops the rename. */
  to?: string;
  problem?: string;
  blocks?: boolean;
  /** U04: values read from the file (its hashes), shown under its name with copy buttons. */
  facts?: { label: string; value: string }[];
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
  results = true,
  className,
}: {
  items: BatchItem[];
  onDownload?: (id: string) => void;
  /** The result size column; off when a batch gives values, not files (U04). */
  results?: boolean;
  className?: string;
}) {
  const renaming = items.some((item) => item.to !== undefined);
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-14">
        <caption className="sr-only">Files</caption>
        <thead>
          <tr className="border-b border-border font-mono text-11.5 uppercase tracking-label text-text-muted">
            <th scope="col" className="py-2.5 pr-4 font-medium">
              File
            </th>
            {renaming && (
              <th scope="col" className="py-2.5 pr-4 font-medium">
                New name
              </th>
            )}
            <th scope="col" className="hidden py-2.5 pr-4 text-right font-medium sm:table-cell">
              Size
            </th>
            <th scope="col" className="py-2.5 pr-4 font-medium">
              Status
            </th>
            {results && (
              <th scope="col" className="hidden py-2.5 pr-4 text-right font-medium sm:table-cell">
                Result
              </th>
            )}
            <th scope="col" className="py-2.5 font-medium">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="h-13 border-b border-border">
              <td className="py-2 pr-4">
                <span
                  className={cn(
                    'block break-all',
                    !item.facts && 'sm:max-w-60 sm:truncate sm:break-normal',
                  )}
                >
                  {item.name}
                </span>
                {item.facts && (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3">
                    {item.facts.map((fact) => (
                      <Fragment key={fact.label}>
                        <dt className="font-mono text-11.5 tracking-label text-text-muted uppercase">
                          {fact.label}
                        </dt>
                        <dd className="flex min-w-0 items-center">
                          <span className="min-w-0 font-mono text-12.5 break-all">
                            {fact.value}
                          </span>
                          <CopyButton
                            text={fact.value}
                            label={`Copy ${fact.label} of ${item.name}`}
                            className="flex-none"
                          />
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
                {!renaming && item.problem && (
                  <span className="mt-1 flex items-start gap-1.5 text-13 text-danger">
                    <CircleAlert
                      aria-hidden="true"
                      size={14}
                      strokeWidth={2}
                      className="mt-0.5 flex-none"
                    />
                    {item.problem}
                  </span>
                )}
              </td>
              {renaming && (
                <td className="py-2 pr-4">
                  <span className="block font-medium break-all sm:max-w-72 sm:truncate sm:break-normal">
                    {item.to}
                  </span>
                  {item.problem && (
                    <span
                      className={cn(
                        'mt-0.5 flex items-start gap-1.5 text-13',
                        item.blocks ? 'text-danger' : 'text-text-muted',
                      )}
                    >
                      {item.blocks && (
                        <CircleAlert
                          aria-hidden="true"
                          size={14}
                          strokeWidth={2}
                          className="mt-0.5 flex-none"
                        />
                      )}
                      {item.blocks ? `Can’t use: ${item.problem}` : item.problem}
                    </span>
                  )}
                </td>
              )}
              <td className="hidden pr-4 text-right font-mono text-12.5 text-text-muted sm:table-cell">
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
              {results && (
                <td className="hidden pr-4 text-right font-mono text-12.5 sm:table-cell">
                  {item.resultSize !== undefined ? formatBytes(item.resultSize) : ''}
                </td>
              )}
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
