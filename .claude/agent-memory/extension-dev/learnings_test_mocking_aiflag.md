---
name: feedback-test-mocking-aiflag
description: Existing tests that mock useEntitlements()'s aiFeatures:true directly break once a component also imports the real AI_ENABLED constant — must mock @/lib/aiFlag too
metadata:
  type: feedback
---

When a component or hook is changed to import `AI_ENABLED` from `@/lib/aiFlag.ts` directly (not just relying on `useEntitlements()`'s `aiFeatures`), any existing unit test that mocks `useEntitlements` to return `aiFeatures: true` will still fail/hide the AI UI, because `AI_ENABLED` reads the real `import.meta.env.VITE_AI_ENABLED`, which is unset in the Vitest env (defaults OFF) and is not affected by mocking `useEntitlements`.

**Why:** this bit `Header`, `AIGroupSuggestion`, and the `useAI`/`useAiUsage` mutation/query guards during the "AI features: coming soon" flag rollout — several already-passing suites (`sidePanelAndHeader.test.tsx`, `AIGroupSuggestion.test.tsx`, `useAI.test.ts`, `useAiUsage.test.ts`, `Settings.test.tsx`'s Dev-tab AI-usage-mock tests) broke the moment the real modules picked up the `AI_ENABLED` import, even though nothing about the tests' own assertions was wrong — they were testing the AI-enabled behavior on purpose, not the coming-soon flag itself.

**How to apply:** for any test suite that exercises "AI enabled" behavior on purpose (as opposed to a suite specifically testing the coming-soon-flag-off state), add `vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))` near the top of the file, alongside a one-line comment noting the suite is testing the feature's own logic, not the flag. Don't skip this and don't loosen the production gate to "fix" the test — the flag defaulting OFF in an unconfigured env is correct/intended.
