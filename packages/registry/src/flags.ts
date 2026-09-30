/**
 * Runtime overrides of the registry's defaults (docs/02: "`tool_flags` in the
 * DB overrides it at runtime. Resolution order: DB flag → code default").
 *
 * The server build loads the overrides from the database, at most 30 s old
 * (apps/web/src/server/flags.ts), before it renders a page that shows tool
 * status. The static export never sets any, so every helper answers with the
 * code default there. Overrides are global, not per request: every visitor
 * sees the same status.
 */
import type { CreditRule, Surface, ToolDef, ToolStatus } from './schema';

export interface ToolFlag {
  status?: ToolStatus | null;
  /** Shown on the tool page while set. */
  maintenanceMessage?: string | null;
  surfaces?: Surface[] | null;
  /** The server path of a hybrid tool is switched on (M4). */
  serverEnabled?: boolean;
  cost?: CreditRule | null;
  limits?: ToolDef['limits'] | null;
}

let flags: ReadonlyMap<string, ToolFlag> = new Map();

/** Replaces every override at once (the server build, after reading `tool_flags`). */
export function setToolFlags(next: ReadonlyMap<string, ToolFlag>): void {
  flags = next;
}

export function toolFlag(id: string): ToolFlag | undefined {
  return flags.get(id);
}

/** The status that counts: the override, else the code default. */
export function statusOf(tool: Pick<ToolDef, 'id' | 'status'>): ToolStatus {
  return flags.get(tool.id)?.status ?? tool.status;
}

export function surfacesOf(tool: Pick<ToolDef, 'id' | 'surfaces'>): readonly Surface[] {
  return flags.get(tool.id)?.surfaces ?? tool.surfaces;
}

export function maintenanceMessage(tool: Pick<ToolDef, 'id'>): string | null {
  return flags.get(tool.id)?.maintenanceMessage ?? null;
}

/** The price rule that counts (M5 prices jobs with it). */
export function costOf(tool: Pick<ToolDef, 'id' | 'cost'>): CreditRule {
  return flags.get(tool.id)?.cost ?? tool.cost;
}

/** The limits that count (M4 enforces them on the server). */
export function limitsOf(tool: Pick<ToolDef, 'id' | 'limits'>): ToolDef['limits'] {
  return flags.get(tool.id)?.limits ?? tool.limits;
}
