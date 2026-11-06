---
name: proxy-session-and-client-plan
description: proxy.ts needsSession() allow-list (which routes read the cookie session and how it was derived), the browser-side account slot and plan fetch that let public pages skip it, zero-shift skeleton lifecycle (dynamic loading, preload, noscript, timeout, status, no remount), Stripe-read rate limit, text/plain bodies
metadata:
  type: reference
---

- **`needsSession(pathname)` in proxy.ts** decides whether the proxy creates the Supabase client
  and calls `auth.getUser()` (a network round trip to Supabase Auth). True for the protected pages
  (`/dashboard*`, `/account*`, any locale prefix, `startsWith` like the redirect), `/auth/*`,
  `/api/auth`, `/api/billing`, `/api/billing-portal`, `/api/checkout`, `/api/sessions`,
  `/api/plan`. Derived by grepping `createClient` from `lib/supabase/server` (directly or through
  `lib/currentPlan.ts` / `lib/planSwitch.ts`) under `app/`. The AI routes and `/api/portal` use a
  Bearer token (service-role `getUser(token)`), the webhook a signature: not listed. **A new route
  that reads the cookie session must be added**, or expired access tokens are never refreshed for
  it (the server client has `autoRefreshToken: false`) and it sees the visitor as signed out.
- **Public pages read no session on the server:** the Navbar's account slot is
  `components/layout/NavAccount.tsx` (browser `getSession()` + `onAuthStateChange`), and the plan
  listings use `useVisitorPlan` (`components/pricing/useVisitorPlan.ts`) → `GET /api/plan`.
  The hook calls `getSession()` first and returns the guest plan **without a request** when there
  is no session: a fetch per guest page view would cost a function invocation each.
- **Client hooks can't import `lib/currentPlan.ts` values:** it imports the server Supabase client
  and Stripe. Import its types only; the hook keeps its own `GUEST_VISITOR_PLAN` (a test pins it
  equal to `GUEST_PLAN`).
- **Zero layout shift for a resolving control:** size the skeleton from the real control, hidden
  (`invisible` + `aria-hidden`, same classes and label) with `Skeleton absolute inset-0` over it,
  so it fits every translation. For the signed-in case, a tiny inline `<script>` placed right after
  the skeleton runs during parsing, before paint, and sets `data-session="in"` when a
  `sb-<ref>-auth-token` (or `.0`/`.1` chunk) cookie exists; Tailwind `group-data-[session=in]:`
  swaps to an avatar-sized block. Needs `suppressHydrationWarning` on that element, and
  `String.raw` for the regex inside the script string (a plain string literal eats `\s`/`\d`).
  A `<noscript><style>[data-…]{display:none}</style>…buttons…</noscript>` covers no-JS visitors.
- **Keeping client state across the loading → resolved switch:** render the same component at the
  same position in both branches (the pricing interval toggle survives). Don't `key` a card on a
  late value: the remount drops focus and the visitor's choices. Seed late state while rendering
  instead (`useSeededAiMode`: follows the seed until the visitor touches the switch). Dates the
  server used to format go through `formatDate(…, locale, 'UTC')` so they don't shift by a day.
- **Every late-resolving control needs its whole lifecycle covered:** a `next/dynamic` chunk needs a
  `loading` placeholder of the same box (or the slot collapses after the skeleton unmounts) and a
  preload as soon as you know it will render (write the `import()` literally inside `dynamic()`;
  a separate `loadX()` with the same path shares the chunk). Skeletons need a `<noscript>`
  fallback (a real link) plus a `<noscript><style>` hiding them, a lookup timeout
  (`PLAN_LOOKUP_TIMEOUT_MS`, abort + guest fallback), and, when the result changes the page for
  the user, one polite `role="status"` mounted empty from the first render and filled once.
  Size a skeleton from every label it can turn into (stacked `invisible` in one grid cell via
  `[grid-area:1/1]`), not just the most common one.
- **Stripe reads behind a browser fetch need a limit:** `getCurrentPlan({ withPendingChange })`
  counts each Stripe read in its own fail-open bucket (`PENDING_CHANGE_RATE_LIMIT`, not the billing
  routes' bucket, so page reloads never use up checkout clicks) and degrades to
  `pendingChange: null` instead of an error.
- **Parallel Vitest coverage runs collide** on `coverage/.tmp` ("Something removed the coverage
  directory"). With another agent testing the same package, pass
  `--coverage.reportsDirectory=<scratch dir>`.
- **text/plain "simple requests":** `Request.json()` ignores `Content-Type`, so a route already
  parses a `text/plain` JSON body; what changes is that the browser sends no OPTIONS preflight
  (one invocation per event instead of two). Read the body with `readJsonBodyWithin`
  (`lib/ai-validation.ts`) for the same byte cap on every content type (413 / 408). The proxy
  still adds the extension CORS headers to the POST itself, which the simple request needs.

Related: [[cloud-sync-gating-helper]], [[plan-aware-listings]], [[navbar-streamed-data-and-width-budget]].
