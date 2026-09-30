'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Calculator state lives in the URL query, so any result can be shared as a
 * link and nothing is stored (tools/subtitles-and-time.md → Calculators).
 *
 * The query is read once per page into memory and written back with
 * `history.replaceState` after typing pauses: Safari throws after 100
 * history calls in 30 s, and one entry per keystroke would flood Back.
 * Only values that differ from the defaults go into the URL.
 */

const WRITE_DELAY_MS = 300;

let memory: { path: string; search: string } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function current(): string {
  const { pathname, search } = window.location;
  if (memory?.path !== pathname) memory = { path: pathname, search: search.replace(/^\?/, '') };
  return memory.search;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onPop = () => {
    memory = null;
    listener();
  };
  window.addEventListener('popstate', onPop);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', onPop);
  };
}

function write(search: string): void {
  memory = { path: window.location.pathname, search };
  for (const listener of listeners) listener();
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { pathname, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${search ? `?${search}` : ''}${hash}`,
    );
  }, WRITE_DELAY_MS);
}

/** Reads `defaults`' keys from a query string; unknown keys are ignored. */
export function readQuery<T extends Record<string, string>>(search: string, defaults: T): T {
  const params = new URLSearchParams(search);
  const values: Record<string, string> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = params.get(key);
    if (value !== null) values[key] = value;
  }
  return values as T;
}

/** The query with `key` set, or removed when it equals its default. */
export function withValue(search: string, key: string, value: string, fallback: string): string {
  const params = new URLSearchParams(search);
  if (value === fallback) params.delete(key);
  else params.set(key, value);
  return params.toString();
}

/** A value from a fixed list, or the fallback when the URL holds something else. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function useQueryState<T extends Record<string, string>>(
  defaults: T,
): [T, (key: keyof T & string, value: string) => void] {
  // The server renders the defaults; the browser switches to the URL after hydration.
  const search = useSyncExternalStore(subscribe, current, () => '');
  const set = useCallback(
    (key: keyof T & string, value: string) => {
      write(withValue(current(), key, value, defaults[key] ?? ''));
    },
    // `defaults` is a module-level constant in every calculator, so this is stable.
    [defaults],
  );
  return [readQuery(search, defaults), set];
}

/** The page URL with the current state, for "Copy link". */
export function shareUrl(): string {
  const { origin, pathname } = window.location;
  const search = current();
  return `${origin}${pathname}${search ? `?${search}` : ''}`;
}
