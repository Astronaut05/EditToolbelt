'use client';

import { searchIndex, type SearchEntry, type SearchHit } from '@etb/registry/search';
import { needsFullPageLoad } from '@etb/registry/isolated';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Written at build time from the registry (apps/web → search-index.json route). */
export const SEARCH_INDEX_URL = '/search-index.json';

let cache: Promise<SearchEntry[]> | null = null;

/** Loads the search index once per page load, on first use, never in the initial bundle. */
export function loadSearchIndex(): Promise<SearchEntry[]> {
  cache ??= fetch(SEARCH_INDEX_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`search index: HTTP ${String(response.status)}`);
      return response.json() as Promise<SearchEntry[]>;
    })
    .catch((error: unknown) => {
      cache = null;
      throw error;
    });
  return cache;
}

export function useSearch(
  query: string,
  {
    enabled = true,
    limit = 8,
    index,
  }: { enabled?: boolean; limit?: number; index?: SearchEntry[] } = {},
) {
  const [entries, setEntries] = useState<SearchEntry[] | null>(index ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || entries) return;
    let live = true;
    loadSearchIndex()
      .then((loaded) => {
        if (live) setEntries(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [enabled, entries]);

  const hits: SearchHit[] = useMemo(
    () => (entries ? searchIndex(entries, query, limit) : []),
    [entries, query, limit],
  );
  return { hits, ready: entries !== null, failed };
}

/** Go to a result: soft navigation, or a full page load into isolated routes. */
export function useGo() {
  const router = useRouter();
  return useCallback(
    (path: string) => {
      if (needsFullPageLoad(path)) window.location.assign(path);
      else router.push(path);
    },
    [router],
  );
}
