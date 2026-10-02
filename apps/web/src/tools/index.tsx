'use client';

import type { CategoryId } from '@etb/registry';
import dynamic from 'next/dynamic';

import type { View, ViewProps } from './views/view-index';

/**
 * The client component behind each working tool comes in two steps, each its
 * own chunk: the index of the tool's category (./views/<category>.tsx), then
 * the tool's view. Both are prerendered with the page and loaded only by a
 * page that shows a tool. This file knows only the six categories, so the
 * script every hub and tool page loads doesn't grow with the number of tools
 * (docs/10 → Budgets; docs/DECISIONS.md → "Tool views load through their
 * category's index"). Every `live` or `beta` tool needs an id in ./ids.ts and
 * an entry in its category's index (checked by the types and in
 * lib/tool.test.ts).
 */
const INDEXES: Readonly<Record<CategoryId, View>> = {
  photo: dynamic(() => import('./views/photo')),
  video: dynamic(() => import('./views/video')),
  audio: dynamic(() => import('./views/audio')),
  color: dynamic(() => import('./views/color')),
  'subtitles-time': dynamic(() => import('./views/subtitles-time')),
  utility: dynamic(() => import('./views/utility')),
};

/** `category` is the tool's registry category, which picks the index. */
export function ToolView({ category, tool, to }: ViewProps & { category: CategoryId }) {
  const Index = INDEXES[category];
  return <Index tool={tool} to={to} />;
}
