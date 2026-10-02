/**
 * Script-transfer budgets, in bytes: each script's compressed transfer as
 * scripts/serve.ts sends it, headers included, as Lighthouse's
 * `resource-summary` counts it. A page whose tool works (ToolShell and the
 * tool's own view, not its engine) gets TOOL_SCRIPT_MAX, every other page
 * PAGE_SCRIPT_MAX (docs/DECISIONS.md → "Script budget for working tool pages").
 * Read by the root scripts/lighthouse.ts on its six pages and by
 * e2e/script-budget.spec.ts on every page.
 */
export const TOOL_SCRIPT_MAX = 180_000;
export const PAGE_SCRIPT_MAX = 160_000;
