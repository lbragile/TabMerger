---
name: pr-check
description: Run the right subset of TabMerger's review/test agents based on which files changed, before opening a PR.
disable-model-invocation: true
---

# PR check

Runs only the specialist agents relevant to the current diff — not the full set every time.

## Steps

1. Get the changed files: `git diff --stat master...HEAD` (or against the user-specified base branch).
2. Based on which paths appear, spawn the matching agents **in parallel** (single message, multiple `Agent` calls):

| Changed path matches | Spawn |
|---|---|
| `supabase/migrations/` | `migration-reviewer` |
| `packages/web/app/api/webhooks/stripe/`, `checkout/`, `billing-portal/`, `useEntitlements.ts` | `payments-security-reviewer` |
| `useEntitlements.ts` or `packages/shared/src/constants/index.ts` | `entitlements-auditor` |
| Any `packages/extension/` or `packages/web/` source change | `coverage-reporter` (after tests exist for the change) |
| Any change at all | `test-writer`, if `coverage-reporter` reports a gap or no tests were touched for the change |

3. If none of the path patterns match (e.g. docs-only, config-only change), say so and skip agent spawning — don't force a review that doesn't apply.
4. Collect and report all agent findings together before the user commits/opens the PR. Do not silently drop a CRITICAL/FAIL finding — surface it even if other checks passed.
5. Also remind the user to run `pnpm scan-secrets` if it hasn't run yet (Husky runs it on commit, but this catches issues before that point).
