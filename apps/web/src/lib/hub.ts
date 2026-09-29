import {
  hubOrder,
  isAi,
  isAvailable,
  runsInBrowser,
  runtimeTag,
  toolPath,
  type ToolDef,
} from '@etb/registry';

import type { HubRow } from '../components/HubList';

/** Hub rows from registry entries, in hub order (working tools first). */
export function hubRows(list: ToolDef[]): HubRow[] {
  return hubOrder(list).map((tool) => ({
    id: tool.id,
    name: tool.name,
    summary: tool.summary,
    href: toolPath(tool),
    tag: runtimeTag(tool),
    ai: isAi(tool),
    browser: runsInBrowser(tool),
    soon: !isAvailable(tool),
  }));
}
