/**
 * Tool status from the database (docs/12 → M3: "registry resolution from DB
 * flags, 30 s cache"). Reads every `tool_flags` row at most every 30 s and
 * hands them to the registry, whose helpers then answer with them. An admin
 * change clears the cache in the process that made it; other processes catch
 * up within 30 s. A tool with no page in src/tools can't be switched on: its
 * live or beta override is ignored.
 */
import { setToolFlags, type ToolFlag } from '@etb/registry';
import { toolFlags } from '@etb/db';

import { log } from '../lib/log';
import { hasView } from '../tools/ids';
import { db } from './db';

export const FLAGS_TTL_MS = 30_000;

let loadedAt = 0;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  const rows = await db().select().from(toolFlags);
  const next = new Map<string, ToolFlag>();
  for (const row of rows) {
    const opens = row.status === 'live' || row.status === 'beta';
    next.set(row.toolId, {
      status: opens && !hasView(row.toolId) ? null : row.status,
      maintenanceMessage: row.maintenanceMessage,
      surfaces: row.surfacesOverride as ToolFlag['surfaces'],
      serverEnabled: row.serverEnabled,
      // Validated against the registry's schemas when an admin saves them.
      cost: row.costOverride as ToolFlag['cost'],
      limits: row.limitsOverride as ToolFlag['limits'],
    });
  }
  setToolFlags(next);
  loadedAt = Date.now();
}

/** Makes the registry's overrides at most 30 s old. On a database error the last ones stay. */
export async function refreshToolFlags(): Promise<void> {
  if (Date.now() - loadedAt < FLAGS_TTL_MS) return;
  loading ??= load()
    .catch((error: unknown) => {
      log.warn({ err: error }, 'flags.load_failed');
    })
    .finally(() => {
      loading = null;
    });
  await loading;
}

/** After an admin change: the next render reads the database again. */
export function invalidateToolFlags(): void {
  loadedAt = 0;
}
