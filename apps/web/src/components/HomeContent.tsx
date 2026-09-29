import type { SearchEntry } from '@etb/registry/search';
import {
  categories,
  categoryPath,
  getCategory,
  getTool,
  MOST_USED,
  toolPath,
  toolsInCategory,
} from '@etb/registry';
import { AppLink, MonoLabel } from '@etb/ui';

import { HomeSearch } from './HomeSearch';

function MostUsedList({ ids, start }: { ids: readonly string[]; start: number }) {
  return (
    <ol>
      {ids.map((id, index) => {
        const tool = getTool(id);
        return (
          <li key={id}>
            <AppLink
              href={toolPath(tool)}
              className="group flex h-9.5 items-baseline gap-4 border-b border-border text-16"
            >
              <span aria-hidden="true" className="w-5.5 font-mono text-12 text-text-muted">
                {String(start + index).padStart(2, '0')}
              </span>
              <span className="group-hover:underline">{tool.name}</span>
              <span className="ml-auto font-mono text-11 uppercase tracking-[0.1em] text-text-muted">
                {getCategory(tool.category).tag}
              </span>
            </AppLink>
          </li>
        );
      })}
    </ol>
  );
}

export function HomeContent({
  initialQuery,
  index,
}: {
  initialQuery?: string;
  index?: SearchEntry[];
}) {
  return (
    // The hero fills the first screen; the footer starts below it, as drawn.
    <div className="lg:min-h-[calc(100dvh-var(--header-h)-72px)]">
      <h1 className="sr-only">EditToolbelt: quick tools for video, photo and audio editors</h1>
      <HomeSearch initialQuery={initialQuery} index={index} />
      <div className="grid gap-10 px-4 pt-9 lg:grid-cols-[1fr_1fr_360px] lg:px-10">
        <section aria-labelledby="most-used" className="lg:col-span-2">
          <MonoLabel as="h2" size="md" id="most-used" className="mb-2.5">
            Most used
          </MonoLabel>
          <div className="grid gap-x-10 lg:grid-cols-2">
            <MostUsedList ids={MOST_USED.slice(0, 5)} start={1} />
            <MostUsedList ids={MOST_USED.slice(5, 10)} start={6} />
          </div>
        </section>
        <section aria-labelledby="categories">
          <MonoLabel as="h2" size="md" id="categories" className="mb-2.5">
            Categories
          </MonoLabel>
          <ul>
            {categories.map((category) => (
              <li key={category.id}>
                <AppLink
                  href={categoryPath(category)}
                  className="group flex h-9.5 items-center justify-between border-b border-border text-16"
                >
                  <span className="group-hover:underline">{category.name}</span>
                  <span className="font-mono text-13 text-text-muted">
                    {toolsInCategory(category.id).length}
                  </span>
                </AppLink>
              </li>
            ))}
          </ul>
          <p className="mt-4.5 text-14 leading-[1.5] text-text-muted">
            Quick tools for photo, video and audio editors. Most run in your browser: no upload, no
            sign-up.
          </p>
        </section>
      </div>
    </div>
  );
}
