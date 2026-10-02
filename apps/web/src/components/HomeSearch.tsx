'use client';

import type { SearchEntry } from '@etb/registry/search';
import { AppLink, cn, useGo, useSearch } from '@etb/ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * The home hero: the search line is the hero (design README → Home). Instant
 * and client-side; the index loads on focus, so the page ships without it.
 */
export function HomeSearch({
  initialQuery = '',
  index,
}: {
  initialQuery?: string;
  index?: SearchEntry[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(Boolean(initialQuery));
  const input = useRef<HTMLInputElement>(null);
  const go = useGo();

  // Desktop: the search line is the page, so it takes focus. Not on touch
  // screens, where focus would throw up the keyboard.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, []);
  const { hits } = useSearch(query, { enabled: focused, limit: 3, index });

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && hits[0]) {
      event.preventDefault();
      go(hits[0].path);
    }
  }

  return (
    <section aria-labelledby="home-search-label" className="px-4 pt-10 lg:px-10 lg:pt-15">
      <label
        id="home-search-label"
        htmlFor="home-search"
        className="block font-mono text-12 font-medium uppercase tracking-[0.16em] text-text-muted"
      >
        What do you need to do?
      </label>
      {/* Focus shows on the rule: --focus-ring and 4 px while the input has focus (padding keeps the height). */}
      <div className="mt-4.5 flex items-center gap-4 border-b-2 border-border-strong pb-5 focus-within:border-b-4 focus-within:border-focus-ring focus-within:pb-4.5">
        <input
          ref={input}
          id="home-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby="home-search-hint"
          placeholder="What do you need to do?"
          value={query}
          onFocus={() => {
            setFocused(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-34 leading-none font-strong tracking-display-xl caret-accent outline-none placeholder:text-text-muted lg:h-18 lg:text-72"
        />
        <span
          id="home-search-hint"
          className="hidden rounded-control border border-border px-2.25 py-1.5 font-mono text-12 font-medium tracking-[0.1em] text-text-muted lg:inline"
        >
          ENTER <span aria-hidden="true">↵</span>
        </span>
      </div>
      {query.trim() !== '' && (
        <ul
          aria-label="Top matches"
          aria-live="polite"
          className="grid border-b border-border lg:grid-cols-3"
        >
          {hits.map((hit, index) => (
            <li key={hit.path}>
              <AppLink
                href={hit.path}
                className="flex items-baseline justify-between gap-4 py-4 text-17 hover:underline lg:pr-8"
              >
                <span className={cn(index === 0 ? 'text-accent' : 'text-text')}>{hit.title}</span>
                <span className="font-mono text-12 uppercase tracking-[0.08em] text-text-muted">
                  {hit.soon ? 'Soon' : hit.tag}
                </span>
              </AppLink>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="py-4 text-14 text-text-muted lg:col-span-3">
              Nothing matches yet. Try a format (mp4, heic) or a task (trim, resize).
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
