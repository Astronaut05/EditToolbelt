'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { isApple, letterOf, useModifierLabel } from '../primitives/keys';
import { useGo, useSearch } from './useSearch';

/** Custom event any button can dispatch to open the search overlay. */
export const OPEN_SEARCH_EVENT = 'etb:open-search';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Ctrl+K, or ⌘K on Apple keyboards, from anywhere: a shortcut with a modifier,
 * so a stray key press or a spoken word can't set it off (WCAG 2.1.4). Not
 * Ctrl+K in a text field on a Mac, where it deletes to the end of the line.
 */
function isSearchShortcut(event: globalThis.KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return false;
  if (letterOf(event) !== 'k') return false;
  return !(event.ctrlKey && isApple() && isTyping(event.target));
}

/**
 * `/` opens search only while focus is in the site header (WCAG 2.1.4), not
 * in the phone menu's sheet, which the header also holds.
 */
function isHeaderSlash(event: globalThis.KeyboardEvent): boolean {
  return (
    event.key === '/' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.target instanceof Element &&
    event.target.closest('[data-site-header]') !== null &&
    event.target.closest('dialog') === null
  );
}

/**
 * Search from any page: Ctrl+K (⌘K), the header button, or `/` from the
 * header opens a full-width sheet under the header with the 72 px input and
 * the results (design README → Not drawn yet). On the home page the shortcut
 * focuses the hero search instead.
 */
export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const go = useGo();
  const { hits, ready, failed } = useSearch(query, { enabled: open });

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!isSearchShortcut(event) && !isHeaderSlash(event)) return;
      event.preventDefault();
      const hero = document.getElementById('home-search');
      if (hero instanceof HTMLInputElement) hero.focus();
      else setOpen(true);
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      input.current?.focus();
    }
    if (!open && node.open) node.close();
  }, [open]);

  function choose(path: string) {
    setOpen(false);
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
        setOpen(false);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) setOpen(false);
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
              setOpen(false);
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

/** Header search trigger: button on desktop (label), icon on phones. */
export function SearchButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const mod = useModifierLabel();
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
      }}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        'inline-flex items-center hover:text-text',
        compact ? 'text-text' : 'text-text-muted',
        compact ? 'size-11 justify-center' : 'h-11 gap-2 text-14',
        className,
      )}
    >
      <Search aria-hidden="true" size={compact ? 19 : 16} strokeWidth={compact ? 1.6 : 1.75} />
      <span className={cn(compact && 'sr-only')}>Search</span>
      {!compact && (
        <kbd
          aria-hidden="true"
          className="font-mono text-11.5 font-medium tracking-meta text-text-muted"
        >
          {mod === '⌘' ? '⌘K' : `${mod} K`}
        </kbd>
      )}
    </button>
  );
}
