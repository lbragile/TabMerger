---
name: lint-config
description: ESLint config was missing from packages/web — next lint hangs waiting for interactive config setup without it
metadata:
  type: project
---

The web package had no `.eslintrc.json`. Running `pnpm --filter @tabmerger/web lint` would hang waiting for interactive config selection (`Strict / Base / Cancel`).

**Why:** Next.js 15 `next lint` requires an ESLint config file to run non-interactively. The project was created without one.

**Fix:** Created `packages/web/.eslintrc.json` with `{"extends": ["next/core-web-vitals", "next/typescript"]}`.

**How to apply:** If lint hangs on first run after creating a new Next.js package, create this config file.
