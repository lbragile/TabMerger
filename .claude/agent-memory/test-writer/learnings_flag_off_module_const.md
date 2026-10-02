---
name: feedback-flag-off-module-const
description: Testing a feature flag that's read into a module-level const (e.g. AI_ENABLED) requires vi.resetModules() + dynamic import per state, not just vi.stubEnv
metadata:
  type: feedback
---

When a flag is exported as a module-level `const X = isEnabled(process.env.FOO)` (computed once
at import time — e.g. `packages/extension/src/lib/aiFlag.ts`, `packages/web/lib/aiFlag.ts`),
`vi.stubEnv` alone does nothing for components/hooks that statically imported that const before the
stub ran. Two working patterns, pick based on what's already imported in the file:

1. **Static top-level import of the flag-consuming module** (e.g. a React component test file that
   does `import { PricingCard } from '@/components/pricing/PricingCard'` at the top): switch to
   `vi.resetModules()` + `vi.stubEnv(...)` + `await import(...)` *inside each test*, discarding the
   static import. Works within a single test file for both flag states.
2. **File already does dynamic `await import(...)` inside each test** (common in Next.js server
   component tests, e.g. `dashboard/page.tsx`, `account/page.tsx`): just add
   `vi.resetModules()` + `vi.stubEnv(...)` before the import — no rewrite needed.
3. **Hook/component tests that use `vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))` at the
   top of the file** (static, hoisted, one value for the whole file): if you need both flag states
   in the same logical test suite, put the off-state tests in a **separate file** — `vi.mock`
   factories are file-static and there's no clean per-test override. Suffix convention used here:
   `useAI.test.ts` (on) + `useAI.flagOff.test.ts` (off).

**Why:** hit this directly on the 2026-09-26 "AI features: coming soon" test-writer pass —
`PricingCard.test.tsx`'s pre-existing proAi tests broke because the component's `AI_ENABLED` import
was evaluated once against the test env's default-off value, before any `vi.stubEnv` in a `beforeEach`
had a chance to matter.

**How to apply:** whenever a task introduces a global kill-switch flag backed by `import.meta.env`/
`process.env` and consumed via a plain module constant (not read per-call), immediately audit every
existing test file that imports the flag-gated module/component statically — those tests will need
the resetModules+dynamic-import treatment, not just an env stub. See also [[learnings_vitest_hoisting]]
for the related TDZ gotcha with `vi.hoisted()`.
