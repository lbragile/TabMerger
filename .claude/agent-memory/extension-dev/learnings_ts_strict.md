---
name: learnings-ts-strict
description: TypeScript strict mode gotchas in the extension package, especially @tabmerger/shared resolution
metadata:
  type: feedback
---

## @tabmerger/shared path resolution for tsc

`strict: true` was already set in `packages/extension/tsconfig.json`. The only type errors were `TS2307: Cannot find module '@tabmerger/shared'` — tsc couldn't resolve the sibling workspace package because pnpm does not symlink it into `node_modules` (it's not declared as a dependency in `packages/extension/package.json`).

**Fix:** add path aliases to the extension tsconfig:

```json
"paths": {
  "@/*": ["src/*"],
  "@tabmerger/shared": ["../shared/src/index.ts"],
  "@tabmerger/shared/*": ["../shared/src/*"]
}
```

WXT/Vite handles the actual runtime resolution via `pnpm-workspace.yaml`; the path alias is only needed for `tsc --noEmit`. Once the alias resolves, all implicit `any` errors in test files (e.g. `.flatMap((w) => w.tabs)`) also disappear because the types flow through from `ExtWindow`.

**Why not add it as a workspace dependency?** Unnecessary — the shared package has no build step and is already bundled by WXT. A tsconfig path is the minimal fix.
