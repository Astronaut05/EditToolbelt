'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '../cn';
import { isApple, letterOf, useModifierLabel } from '../primitives/keys';
import type { SearchDialog } from './SearchDialog';

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

let dialog: Promise<typeof import('./SearchDialog')> | undefined;

/**
 * The sheet, its results and the search are a file of their own, fetched the
 * first time search is asked for. A fetch that failed (offline, or a deploy
 * replaced the file) is tried again at the next ask.
 */
function loadDialog() {
  dialog ??= import('./SearchDialog').catch((error: unknown) => {
    dialog = undefined;
    throw error;
  });
  return dialog;
}

/** Puts the sheet on the page, closed, once its file is in (set by SearchOverlay). */
let mount: ((sheet: typeof SearchDialog) => void) | undefined;

/**
 * Fetches the sheet before it's asked for and puts it on the page, closed. An
 * open then happens in the same turn as the tap or the key that asked: a
 * phone raises its keyboard only for a focus made while the tap is handled.
 */
function warm() {
  loadDialog().then(
    (loaded) => {
      fetched = true;
      mount?.(loaded.SearchDialog);
    },
    () => undefined,
  );
}

/**
 * Keys typed after search was asked for and before the sheet's input can take
 * them. Its file is fetched on first use, so someone who presses Ctrl+K and
 * types at once would lose their first letters: they are kept here instead
 * (and kept out of whatever field had focus), and the sheet opens with them.
 */
let early = '';
let fetched = false;
/** Takes the ask back (set while the sheet is on its way). */
let withdraw: (() => void) | undefined;

function keepKey(event: globalThis.KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === 'Escape') {
    // Never mind. The key is the sheet's, not the page's, where Esc cancels a running tool.
    stopKeeping();
    withdraw?.();
    event.stopImmediatePropagation();
  } else if (event.key.length === 1) early += event.key;
  else if (event.key === 'Backspace') early = early.slice(0, -1);
  // Enter is for the result that isn't listed yet, not for whatever button has focus.
  else if (event.key !== 'Enter') return;
  event.preventDefault();
}

/** What was typed while the sheet loaded. */
export const earlyKeys = () => early;

/** The sheet's input has focus: keys go there from now on. */
export function stopKeeping() {
  window.removeEventListener('keydown', keepKey, true);
  early = '';
}

/**
 * Search from any page: Ctrl+K (⌘K), the header button, or `/` from the
 * header opens the search sheet (SearchDialog). On the home page the shortcut
 * focuses the hero search instead. This part is in every page's first load,
 * so it only listens: the sheet's file is fetched at the first touch, click
 * or key press on the page, or when it's first asked for, whichever is first.
 */
export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [Dialog, setDialog] = useState<typeof SearchDialog | null>(null);

  useEffect(() => {
    mount = (sheet) => {
      setDialog(() => sheet);
    };
    withdraw = () => {
      setOpen(false);
    };
    function show() {
      setOpen(true);
      if (!fetched) window.addEventListener('keydown', keepKey, true);
      loadDialog().then(
        (loaded) => {
          fetched = true;
          setDialog(() => loaded.SearchDialog);
        },
        () => {
          stopKeeping();
          setOpen(false);
        },
      );
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (!isSearchShortcut(event) && !isHeaderSlash(event)) return;
      event.preventDefault();
      const hero = document.getElementById('home-search');
      if (hero instanceof HTMLInputElement) hero.focus();
      else show();
    }
    // The first sign of someone there. Before `onKey`, so Ctrl is already fetching when K lands.
    window.addEventListener('pointerdown', warm, { once: true, passive: true });
    window.addEventListener('keydown', warm, { once: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => {
      mount = undefined;
      withdraw = undefined;
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
    };
  }, []);

  return Dialog && <Dialog open={open} onOpenChange={setOpen} />;
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
      onPointerEnter={warm}
      onFocus={warm}
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
