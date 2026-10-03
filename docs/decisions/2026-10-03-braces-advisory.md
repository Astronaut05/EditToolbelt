# 2026-10-03 · The braces advisory is ignored until a fix exists

**Decision:** `pnpm audit` ignores GHSA-vfj7-8cjw-p6xm (`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`). It covers braces 3.0.3 and earlier: a deeply nested brace pattern exhausts the stack.

**Why:**
- The advisory came out on 2026-10-03 with no fixed version ("patched: none"), and CI's dependency audit fails on any high advisory, so every pull request and main went red.
- braces reaches us by one path only: `@next/eslint-plugin-next > fast-glob > micromatch > braces`, a dev dependency used by `pnpm lint`.
- It expands only the glob patterns in our own lint setup, never anything a visitor sends. Nothing in the browser build or on a server loads it, and `pnpm audit --prod` finds nothing.
- An override can't help while no fixed braces exists, and dropping Next's ESLint plugin would lose its checks for nothing.

**Reverse:** remove the `auditConfig` block from `pnpm-workspace.yaml` once a fixed braces is out (Dependabot will propose it), and update the lockfile.
