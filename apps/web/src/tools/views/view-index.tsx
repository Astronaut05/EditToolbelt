import type { ShellTool } from '@etb/ui';
import type { ComponentType } from 'react';

/** `to` presets the output format on conversion pair pages (/convert/srt-to-vtt). */
export interface ViewProps {
  tool: ShellTool;
  to?: string;
}

export type View = ComponentType<ViewProps>;

/**
 * One category's index: its tools' views by id, each loaded with
 * `next/dynamic`, so each view is its own chunk. The index's chunk is
 * preloaded with the page; a view's is requested when the index renders it
 * (Turbopack preloads only a page's own `next/dynamic` imports).
 */
export function viewIndex<Id extends string>(views: Readonly<Record<Id, View>>): View {
  const byId: Readonly<Partial<Record<string, View>>> = views;
  return function ViewIndex({ tool, to }: ViewProps) {
    const Shown = byId[tool.id];
    if (!Shown) throw new Error(`${tool.id} has no view in its category's index (src/tools/views)`);
    return <Shown tool={tool} to={to} />;
  };
}
