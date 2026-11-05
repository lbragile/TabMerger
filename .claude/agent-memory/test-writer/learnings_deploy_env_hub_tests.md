---
name: deploy-env-hub-tests
description: How web tests exercise the deployment hub (DEPLOY_ENV/VERCEL_ENV, NEXT_PUBLIC_DEPLOY_ENV) and where each case lives
metadata:
  type: feedback
---

Server gates read `deployEnv()` per call (DEPLOY_ENV, then VERCEL_ENV, then build-time NEXT_PUBLIC_DEPLOY_ENV); client code reads only the literal NEXT_PUBLIC_DEPLOY_ENV. Stub `NEXT_PUBLIC_VERCEL_ENV` is dead: do not add it.

**How to apply:** gate tests cover both sources (DEPLOY_ENV wins, VERCEL_ENV fallback). Client-side checks: analytics-consent.test.ts (trackEvent), posthog-provider.test.tsx (register), instrumentationClient.test.ts (Sentry init; mock `@/components/DeferredOnLoad` whenPageIdle to run immediately, vi.resetModules + dynamic import per env). Client tests should also assert the server-side names are ignored.
