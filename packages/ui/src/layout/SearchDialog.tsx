'use client';

import { Search, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { earlyKeys, stopKeeping } from './SearchOverlay';
import { useGo, useSearch } from './useSearch';

/**
 * The search sheet itself: a full-width sheet under the header with the 72 px
 * input and the results (design README → Not drawn yet). SearchOverlay loads
 * this file the first time search is asked for, so no page carries it, the
 * search or the index in its first load.
 */
export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // It opens with what was typed while this file was on its way (SearchOverlay → keepKey).
  const [query, setQuery] = useState(earlyKeys);
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const go = useGo();
  const { hits, ready, failed } = useSearch(query, { enabled: open });

  // Before the browser takes another key: from the first render to the input
  // having focus nothing is typed in between, so no letter falls in the gap.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      input.current?.focus();
      stopKeeping();
    }
    if (!open && node.open) node.close();
  }, [open]);

  function choose(path: string) {
    onOpenChange(false);
    setQuery('');
    go(path);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(hits.length - 1, active + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (event.key === 'Enter') {
      const hit = hits[active];
      if (hit) {
        event.preventDefault();
        choose(hit.path);
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Search tools"
      onClose={() => {
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onOpenChange(false);
      }}
      className="m-0 mt-(--header-h) h-auto max-h-[calc(100dvh-var(--header-h))] w-full max-w-none border-b border-border bg-bg p-0 text-text backdrop:bg-media-scrim/50 max-lg:mt-13"
    >
      <div className="mx-auto max-w-(--content-max) px-4 pt-6 pb-8 lg:px-10 lg:pt-10">
        <div className="flex items-center gap-3 border-b-2 border-border-strong pb-4 focus-within:border-b-4 focus-within:border-focus-ring focus-within:pb-3.5">
          <Search
            aria-hidden="true"
            className="flex-none text-text-muted"
            size={28}
            strokeWidth={1.75}
          />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${String(active)}` : undefined}
            aria-autocomplete="list"
            aria-label="Search tools"
            placeholder="What do you need to do?"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-34 leading-none font-strong tracking-display-xl caret-accent outline-none placeholder:text-text-muted lg:text-72"
          />
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
            }}
            className="inline-flex size-11 flex-none items-center justify-center text-text-muted hover:text-text"
          >
            <X aria-hidden="true" size={20} />
            <span className="sr-only">Close search</span>
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Search results" className="mt-2">
          {hits.map((hit, index) => (
            <li key={hit.path} role="presentation">
              <AppLink
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={index === active}
                href={hit.path}
                onClick={(event) => {
                  event.preventDefault();
                  choose(hit.path);
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                className={cn(
                  'flex min-h-13 items-center gap-4 border-b border-border py-2',
                  index === active && 'bg-surface',
                )}
              >
                <span
                  className={cn(
                    'text-17',
                    index === 0 ? 'text-accent' : hit.soon ? 'text-text-muted' : 'text-text',
                  )}
                >
                  {hit.title}
                </span>
                <span className="hidden flex-1 truncate text-13.5 text-text-muted sm:block">
                  {hit.summary}
                </span>
                <span className="ml-auto font-mono text-12 uppercase tracking-[0.08em] text-text-muted">
                  {hit.soon ? 'Soon' : hit.tag}
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
        {query.trim() && ready && hits.length === 0 && (
          <p className="mt-4 text-14 text-text-muted">
            No tool matches “{query}”. Try a format (mp4, heic) or a task (trim, resize).
          </p>
        )}
        {failed && (
          <p className="mt-4 text-14 text-text-muted">
            Search couldn’t load. Check your connection and try again.
          </p>
        )}
      </div>
    </dialog>
  );
}
