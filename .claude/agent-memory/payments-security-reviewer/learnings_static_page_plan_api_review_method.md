---
name: static-page-plan-api-review-method
description: Review method when per-user plan data moves from server-rendered pages to a client-fetched GET route and the proxy's session refresh becomes a path allow-list
metadata:
  type: reference
---

Questions for a change that makes pricing/home pages static and has the browser fetch the plan
(`/api/plan`), plus a proxy that refreshes the Supabase session only on listed paths:

1. **Scoping of the plan read.** No user id from input; cookie client (RLS) plus an explicit
   `.eq('user_id', user.id)`; any Stripe read checks the subscription's customer matches the
   profile's `stripe_customer_id` (`getPendingPlanChange` does). Error bodies empty.
2. **Cache headers on every branch**, including the catch/500 path, plus `force-dynamic`. A
   static page that used to carry per-user data no longer can, which is a net win; grep the
   page files for `createClient`/`getCurrentPlan` to confirm nothing per-user remains in them.
3. **Who consumes the plan.** Grep the client for POST bodies: only the chosen target
   (tier/interval/aiMode) should be sent, never "current plan". Every billing route must
   re-read the subscription itself (checkout's 409 `already_subscribed`). A failed plan fetch
   showing the guest listing then just costs a 409, not a second subscription.
4. **Session allow-list completeness.** Grep `createClient` from `lib/supabase/server` and
   `auth.getUser()` across app/ and lib/, then map each caller (including lib helpers such as
   planSwitch/currentPlan) to its route. Each must be under a listed prefix. Bearer-token
   routes (AI, `/api/portal`) and the webhook don't need it.
5. **Path tricks.** The proxy is not the auth gate: API routes call `getUser()` themselves and
   the `(app)` layout redirects on no user. So an encoded, case-varied or double-locale path
   that skips the proxy check fails toward signed-out, not toward access. Note that
   `isUnderPath('/api/billing-portal', '/api/billing')` is false, which is why billing-portal
   needs its own entry.
6. **Abuse cost.** The GET route can now be hit without a page render. Count the network calls
   per request: proxy `getUser`, route `getUser`, PostgREST reads, and a Stripe retrieve for
   paid users with `pendingChange=1`. Then ask whether the billing rate limiter should apply.

Related: [[user-triggered-resync-review-method]], [[buy-button-visibility-review-method]].
