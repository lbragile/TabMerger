---
name: plan-route-and-session-paths
description: /api/plan + lib/currentPlan.ts read only plaintext billing columns; proxy.ts needsSession list decides which paths get a cookie-session refresh
metadata:
  type: reference
---

- `GET /api/plan` -> `getCurrentPlan()` (lib/currentPlan.ts) reads `subscriptions` (id, tier, status, stripe_price_id, ai_mode, current_period_end, cancel_at_period_end) and `profiles.stripe_customer_id`, plus Stripe `subscriptions.retrieve`. All plaintext by design; no content table. Response is `private, no-store`.
- `proxy.ts` `needsSession()` / `SESSION_PATH_PREFIXES`: only listed paths (plus `/dashboard`, `/account`) get the Supabase session refresh. A new route that reads the cookie session must be added there. Not an encryption issue, but when auditing a new cookie-session route that reads content tables, check it is listed (otherwise it sees signed-out users, never leaks).
- The public `/share/[slug]` page reads `shared_bundles.groups_snapshot` with its own anon `@supabase/supabase-js` client (not the cookie client) and hands it to the client component; it is outside `needsSession` by design.
- `/api/track` and `/api/og-preview` parse the body with `readJsonBodyWithin` (lib/ai-validation.ts) whatever the content type; neither touches Supabase.

Related: [[ai-route-db-touchpoints]], [[server-page-to-client-provider]]
