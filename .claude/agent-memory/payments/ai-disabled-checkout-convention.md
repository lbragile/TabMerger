---
name: ai-disabled-checkout-convention
description: checkout routes must use lib/ai-guard.ts's AI_DISABLED_ERROR/503 convention, not inline 403 ai_disabled; their tests need vi.stubEnv to avoid tripping the guard
metadata:
  type: project
---

`packages/web/app/api/checkout/route.ts` (proAi tier only) and `packages/web/app/api/checkout/credits/route.ts` (unconditional) both gate on the `NEXT_PUBLIC_AI_ENABLED` "coming soon" flag before touching Stripe. They must import `AI_DISABLED_ERROR` from `@/lib/ai-guard` and return **503** (not 403) — this matches the convention used by all 7 `/api/ai/*` routes via `aiDisabledResponse()`/`AI_DISABLED_ERROR`, and is what `payments-security-reviewer` checks for.

**Why:** 503 signals "route exists, temporarily unavailable" (feature flag), not "forbidden" — see the doc comment on `aiDisabledResponse()` in `lib/ai-guard.ts`. A first draft used inline `{error:'ai_disabled'}` at 403 in both checkout routes; the security reviewer caught the mismatch.

**How to apply:** Any new payment/checkout route that gates on `NEXT_PUBLIC_AI_ENABLED` should import `AI_DISABLED_ERROR` (and `aiDisabledResponse()` if the guard placement fits its exact "first statement" shape — checkout routes gate mid-handler after auth/validation, so they inline the check with the imported constant rather than calling the helper directly). Also: `__tests__/checkout.test.ts` and `__tests__/checkout-credits-route.test.ts` don't stub `NEXT_PUBLIC_AI_ENABLED` by default, so any test exercising the proAi/credits path needs `vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')` in `beforeEach` (mirroring `ai-routes.test.ts`) or every request silently 503s regardless of the actual test intent — this bit the credits-route tests where the guard is unconditional and blocked *all* tests, not just an ai_disabled-specific one.
