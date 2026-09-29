'use client';

import { AppLink, cn, SegmentedControl, Tag } from '@etb/ui';
import { useState } from 'react';

export interface HubRow {
  id: string;
  name: string;
  summary: string;
  href: string;
  /** "AI · Browser" */
  tag: string;
  ai: boolean;
  browser: boolean;
  soon: boolean;
}

type Filter = 'all' | 'browser' | 'ai';

/**
 * Hub tool rows: numbered, two columns, name + one line + runtime tag.
 * `soon` rows come last, dimmed, tagged SOON, and are not links (design README).
 */
export function HubList({
  rows,
  lead,
  counts,
}: {
  rows: HubRow[];
  lead: string;
  /** Filter counts; default from the rows. */
  counts?: Record<Filter, number>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = rows.filter((row) => filter === 'all' || (filter === 'ai' ? row.ai : row.browser));
  const n = counts ?? {
    all: rows.length,
    browser: rows.filter((row) => row.browser).length,
    ai: rows.filter((row) => row.ai).length,
  };

  return (
    <>
      <div className="mt-4.5 flex flex-col gap-4 border-b-2 border-border-strong pb-5.5 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-155 text-15.5 leading-body text-text-muted lg:text-17">{lead}</p>
        <SegmentedControl
          label="Show"
          size="lg"
          className="lg:-mb-3.5"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: n.all },
            { value: 'browser', label: 'In browser', count: n.browser },
            { value: 'ai', label: 'AI', count: n.ai },
          ]}
        />
      </div>
      <ol className="grid lg:grid-cols-2 lg:gap-x-10" aria-live="polite">
        {shown.map((row, index) => {
          const inner = (
            <>
              <span aria-hidden="true" className="font-mono text-12 text-text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-17 font-strong tracking-tight',
                    row.soon && 'text-text-muted opacity-60',
                  )}
                >
                  {row.name}
                </span>
                <span className="block truncate text-13.5 text-text-muted">{row.summary}</span>
              </span>
              <Tag tone={row.ai && !row.soon ? 'accent' : 'muted'} className="pl-4">
                {row.soon ? 'Soon' : row.tag}
              </Tag>
            </>
          );
          const rowClass =
            'grid min-h-16 grid-cols-[36px_1fr_auto] items-center border-b border-border py-2';
          return (
            <li key={row.id}>
              {row.soon ? (
                <div className={rowClass}>
                  {inner}
                  <span className="sr-only">(coming soon)</span>
                </div>
              ) : (
                <AppLink
                  href={row.href}
                  className={cn(rowClass, 'group hover:[&_.block:first-child]:underline')}
                >
                  {inner}
                </AppLink>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
