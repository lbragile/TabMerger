---
name: ai-kill-switch
description: NEXT_PUBLIC_AI_ENABLED gates every /api/ai/* handler via lib/ai-guard.ts aiDisabledResponse() BEFORE auth — defaults OFF, returns 503 {error:'ai_disabled'}; affects tests and E2E
metadata:
  type: project
---

Every `/api/ai/*` handler (including organize GET and dev-usage) calls `aiDisabledResponse()` from `packages/web/lib/ai-guard.ts` as its first statement. The flag is on only when `NEXT_PUBLIC_AI_ENABLED` is exactly `"true"`, so it's off when unset. When off, the handler returns 503 `{ error: 'ai_disabled' }` and never reaches auth, `ai_usage`, workflow start, or Anthropic. Rolled out 2026-09-26 as "AI features: coming soon".

**Why:** AI features were launched as "Coming soon" and had to be dark across web, extension, and checkout without deleting the routes.

**How to apply:**
- A new `/api/ai/*` handler must call the guard first, and the flag-off `describe.each` in `__tests__/ai-routes.test.ts` must list it.
- Unit tests for AI routes must `vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')` in `beforeEach`. Otherwise every test hits the 503.
- E2E specs can't assume auth-guard 401s, because the CI dev server runs with the flag off. `e2e/organize-api.spec.ts` probes the flag once and skips the branch that doesn't apply.
- The guard reads `process.env` on each call instead of reusing the module-scope `AI_ENABLED` from `lib/aiFlag.ts`. That keeps `vi.stubEnv` working. Next still inlines `NEXT_PUBLIC_*` at build time, so flipping the flag in a deployed environment needs a redeploy.
- Removing the flag later means deleting the guard call from each route and the flag-off tests. See also [[organize-e2ee-writeback]].
