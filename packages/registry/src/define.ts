import type { ToolDef } from './schema';

/**
 * Identity helper for tool files: gives entries their type without importing
 * Zod, so the registry can be used in client components. The schema check runs
 * in tests and CI (src/registry.test.ts).
 */
export function defineTool(tool: ToolDef): ToolDef {
  return tool;
}
