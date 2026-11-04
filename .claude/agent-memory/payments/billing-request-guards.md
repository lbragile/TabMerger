---
name: billing-request-guards
description: Same-origin check and Postgres per-user rate limit on every billing POST (lib/billingRequestGuard.ts, lib/rateLimit.ts, migration 025) - design choices, fail-open decision, how route tests must build requests and mock the limiter, and how it was verified locally
metadata:
  type: reference
---

**Origin check** (`rejectCrossOriginPost()`, cookie routes only, first thing in the handler):
`Sec-Fetch-Site` must be `same-origin`; when it is absent, `Origin` must equal
`request.nextUrl.origin`; otherwise 403 `forbidden_origin`. `same-site` is refused on purpose:
SameSite=Lax cookies ride along from another subdomain (a preview on `preview.<domain>`). Checked
on the real dev server: no headers → 403; `Origin: http://127.0.0.1:3000` against a server reached
as `localhost:3000` → 403 (different origin strings), so only open the app by the name it is
served on when testing in an old browser that omits Sec-Fetch-Site. Not for the webhook, Bearer
routes (`/api/portal`, `/api/ai/*`) or GETs.

**Rate limit** (`takeRateLimit(bucket, key, client?)`): generic so the AI routes can use it with
their own bucket (user id or `ip:` key, `onError: 'deny'` -> `{ kind: 'unavailable' }` -> 503).
`public.rate_limit_take()` is security definer, EXECUTE for service_role only (a signed-in user
could otherwise burn another user's allowance through PostgREST); one row per (bucket, key,
window) reset in place, so the table doesn't grow per window; windows aligned to the epoch; a
refused hit counts in no window (otherwise a burst would also fill the hour); a per-key
`pg_advisory_xact_lock` makes the check-and-increment exact. Verified locally: 20 concurrent calls
at max 10 → exactly 10 allowed; through PostgREST with the anon key the RPC and the table answer
42501. A 1% chance per call prunes rows older than two days (windows are capped at one day).
Billing bucket: 10/min and 60/hour per user across all billing routes, `onError: 'allow'`.
Decision: fail open for billing (auth and Stripe ownership checks still apply; failing closed would
block cancelling and invoices during a DB blip).

**Tests:** a `new NextRequest(...)` in a route test has no Sec-Fetch-Site, so every billing route
test sends `SAME_ORIGIN_HEADERS` (`__tests__/helpers/billingRequest.ts`) and mocks
`@/lib/rateLimit` (`takeRateLimit` → `{ kind: 'allowed' }`; the Supabase mocks have no `rpc`).
`billingRequestGuard.test.ts` runs 403/429/401 over all seven cookie routes plus `/api/portal`.
Mock variables used by `vi.mock` factories need `vi.hoisted()` when the file also has static
imports of the mocked modules' consumers. The counting itself is covered by pgTAP
(`supabase/tests/025_rate_limits.test.sql`).

Related: [[keep-current-plan-release]], [[checkout-stripe-guard]].
