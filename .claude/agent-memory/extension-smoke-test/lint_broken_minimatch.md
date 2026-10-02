---
name: lint-broken-minimatch
description: Section A5 (pnpm --filter @tabmerger/extension lint) crashes with "TypeError: expand is not a function" from minimatch@3.1.5 before ESLint runs any rule — a repo tooling breakage, not a code regression
metadata:
  type: project
---

**Status: fixed.** The crash came from a blanket `brace-expansion` override; `pnpm-workspace.yaml` now bounds that override per major (`brace-expansion@1/@2/@5`). If the error below reappears, check those overrides first. The rest of this note is the original diagnosis.

`pnpm --filter @tabmerger/extension lint` (`eslint src --max-warnings=0`) failed with:

```
Oops! Something went wrong! :(
ESLint: 9.39.5
TypeError: expand is not a function
    at Minimatch.braceExpand (node_modules/.pnpm/minimatch@3.1.5/node_modules/minimatch/minimatch.js:271:10)
    ...
    at @eslint/config-array/dist/cjs/index.cjs
```

**Why:** `@eslint/config-array@0.21.2` resolves `minimatch@3.1.5` (which has no `expand` export) instead of the v9 it expects. Dependency-resolution problem in the monorepo, not anything in `packages/extension/src/`. ESLint exits status 2 before evaluating a single rule.

**How to apply:** When running the smoke test, expect A5 to fail every time until the minimatch resolution is fixed (e.g. a `pnpm.overrides` entry or lockfile refresh). Do NOT report it as a regression caused by the change under test, and do NOT treat a passing type-check + build as blocked by it. Note it once in the report as pre-existing tooling breakage. If you need lint signal, the per-file ESLint hook (`.claude/hooks/lint-check.py`) may still work on individual files even while the workspace script is broken — worth trying if a change is lint-sensitive.
