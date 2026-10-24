---
name: feedback-test-mocking-aiflag
description: Existing tests that mock useEntitlements()'s aiFeatures:true directly break once a component also imports the real AI_ENABLED constant — must mock @/lib/aiFlag too
metadata:
  type: feedback
---

When a component or hook is changed to import `AI_ENABLED` from `@/lib/aiFlag.ts` directly (not just relying on `useEntitlements()`'s `aiFeatures`), any existing unit test that mocks `useEntitlements` to return `aiFeatures: true` will still fail/hide the AI UI, because `AI_ENABLED` reads the real `import.meta.env.VITE_AI_ENABLED`, which is unset in the Vitest env (defaults OFF) and is not affected by mocking `useEntitlements`.

**Why:** this bit `Header`, `AIGroupSuggestion`, and the `useAI`/`useAiUsage` mutation/query guards during the "AI features: coming soon" flag rollout — several already-passing suites (`sidePanelAndHeader.test.tsx`, `AIGroupSuggestion.test.tsx`, `useAI.test.ts`, `useAiUsage.test.ts`, `Settings.test.tsx`'s Dev-tab AI-usage-mock tests) broke the moment the real modules picked up the `AI_ENABLED` import, even though nothing about the tests' own assertions was wrong — they were testing the AI-enabled behavior on purpose, not the coming-soon flag itself.

**How to apply:** for any test suite that exercises "AI enabled" behavior on purpose (as opposed to a suite specifically testing the coming-soon-flag-off state), add `vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))` near the top of the file, alongside a one-line comment noting the suite is testing the feature's own logic, not the flag. Don't skip this and don't loosen the production gate to "fix" the test — the flag defaulting OFF in an unconfigured env is correct/intended.

**The reverse also bites:** Vitest loads `packages/extension/.env.local`, so a suite asserting the flag-OFF state ("Coming soon") without mocking aiFlag passes in CI and fails on a machine whose `.env.local` turns a flag on (`UpgradePrompt.test.tsx` did). Mock the flag in flag-off suites too. To flip flags per test in one file, mock with getters over a `vi.hoisted` object (`get AI_ENABLED() { return flags.managed || flags.byok }`) and set the object in `beforeEach`; components that read the constant at render see the change. Check env independence by running the full suite three ways: plain, `VITE_AI_ENABLED=true VITE_AI_BYOK_ENABLED=true`, and both `=false` (process env beats `.env.local`).
