'use client';

import { accepts, AppLink, formatBytes, handOff, MonoLabel } from '@etb/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface ShareTool {
  id: string;
  name: string;
  href: string;
  accepts: string[];
  batch: boolean;
  category: string;
}

/** The service worker's cache for shared files (scripts/sw.ts). */
const SHARED = 'etb-shared';

type Shared =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'files'; files: File[]; more: boolean };

/** The shared files, read once and deleted from the cache at once: nothing is kept. */
async function takeShared(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(SHARED);
  const keys = [...(await cache.keys())].sort((a, b) => {
    const index = (request: Request) => Number(new URL(request.url).pathname.split('/').pop());
    return index(a) - index(b);
  });
  const files: File[] = [];
  for (const key of keys) {
    const response = await cache.match(key);
    await cache.delete(key);
    if (!response) continue;
    const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'shared-file');
    const blob = await response.blob();
    files.push(new File([blob], name, { type: blob.type }));
  }
  return files;
}

/** The tools that take every shared file; for several files, the batch tools first. */
export function toolsFor(tools: readonly ShareTool[], files: readonly File[]): ShareTool[] {
  const fit = tools.filter((tool) => files.every((file) => accepts(tool.accepts, file)));
  // A tool that takes any file (Batch Rename) goes last: it fits everything.
  const ranked = [...fit].sort(
    (a, b) =>
      Number(a.accepts.includes('*/*')) - Number(b.accepts.includes('*/*')) ||
      (files.length > 1 ? Number(b.batch) - Number(a.batch) : 0),
  );
  return files.length > 1 && ranked.some((tool) => tool.batch)
    ? ranked.filter((tool) => tool.batch)
    : ranked;
}

export function ShareView({ tools }: { tools: ShareTool[] }) {
  const router = useRouter();
  const [shared, setShared] = useState<Shared>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    const more = new URLSearchParams(window.location.search).get('more') === '1';
    takeShared().then(
      (files) => {
        if (live) setShared(files.length ? { kind: 'files', files, more } : { kind: 'none' });
      },
      () => {
        if (live) setShared({ kind: 'none' });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (shared.kind === 'loading') {
    return <p className="text-15 text-text-muted">Opening the shared files…</p>;
  }
  if (shared.kind === 'none') {
    return (
      <div>
        <MonoLabel size="md">Share</MonoLabel>
        <h1 className="mt-4.5 text-34 leading-display font-display tracking-display lg:text-46">
          Nothing to open
        </h1>
        <p className="mt-3.5 max-w-xl text-16.5 text-text-muted">
          Nothing was shared, or it’s been opened already. Share a photo, video or audio file to
          EditToolbelt from another app, or pick a tool on the home page.
        </p>
        <AppLink href="/" className="mt-6 inline-block text-15 font-strong underline">
          All tools
        </AppLink>
      </div>
    );
  }

  const { files, more } = shared;
  const matches = toolsFor(tools, files);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const groups = new Map<string, ShareTool[]>();
  for (const tool of matches)
    groups.set(tool.category, [...(groups.get(tool.category) ?? []), tool]);
  const several = files.length > 1;
  return (
    <div>
      <MonoLabel size="md">Share</MonoLabel>
      <h1 className="mt-4.5 text-34 leading-display font-display tracking-display lg:text-46">
        Open with a tool
      </h1>
      <p className="mt-3.5 max-w-xl text-16.5 text-text-muted">
        {several
          ? `${String(files.length)} files, ${formatBytes(total)}.`
          : `${files[0]?.name ?? 'A file'}, ${formatBytes(total)}.`}{' '}
        They stay on this device.
      </p>
      {more && <p className="mt-2 text-14 text-text-muted">Only the first 50 files were kept.</p>}
      {several && (
        <ul aria-label="Shared files" className="mt-4 max-w-xl text-14 text-text-muted">
          {files.slice(0, 6).map((file, i) => (
            <li key={`${file.name}-${String(i)}`} className="truncate font-mono text-12.5">
              {file.name}
            </li>
          ))}
          {files.length > 6 && <li>and {files.length - 6} more</li>}
        </ul>
      )}
      {matches.length === 0 ? (
        <p className="mt-6 max-w-xl text-15">
          No tool here opens {several ? 'these files together' : 'this file'} yet.{' '}
          <AppLink href="/" className="underline">
            See all tools
          </AppLink>
          .
        </p>
      ) : (
        [...groups].map(([category, list]) => (
          <section key={category} className="mt-8">
            <h2 className="font-mono text-12 tracking-meta text-text-muted uppercase">
              {category}
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // The files go to the tool in memory, across the client-side navigation.
                      handOff(files, tool.id);
                      router.push(tool.href);
                    }}
                    className="flex h-13 w-full items-center rounded-control border border-border px-4 text-left text-15 font-medium hover:border-text"
                  >
                    {tool.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
