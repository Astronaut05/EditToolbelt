'use client';

import type { ShellTool } from '@etb/ui';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

import { hasView, type ToolId } from './ids';

type View = ComponentType<{ tool: ShellTool }>;

/**
 * The client component behind each working tool, by registry id. Each one is
 * its own chunk: it is prerendered with the page and loaded only by the page
 * that shows it, so hubs and other tools don't pay for it (docs/10 → Budgets).
 * Every `live` or `beta` tool needs an entry here and in ./ids.ts
 * (checked in lib/tool.test.ts).
 */
const VIEWS: Readonly<Record<ToolId, View>> = {
  'aspect-ratio-calculator': dynamic(() => import('./aspect-ratio-calculator')),
  'bitrate-calculator': dynamic(() => import('./bitrate-calculator')),
  'timecode-calculator': dynamic(() => import('./timecode-calculator')),
};

export function ToolView({ tool }: { tool: ShellTool }) {
  if (!hasView(tool.id)) throw new Error(`${tool.id} is working but has no view in src/tools`);
  const View = VIEWS[tool.id];
  return <View tool={tool} />;
}
