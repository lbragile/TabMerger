---
name: module-scope-sdk-construction-crash
description: Bug class where an SDK client constructed at module scope (Stripe, Supabase browser/server/middleware clients) throws on a missing env var and takes down the whole `next build` or every request (including the RSC server client via Navbar), and how to degrade correctly for each.
metadata:
  type: project
---

Same bug class as the extension's `packages/extension/src/lib/supabase.ts` fix (commit
`d45989c`): an SDK constructor that throws synchronously on a missing/empty credential, called
somewhere that runs unconditionally regardless of whether the feature is actually used.

**Where this bites in `packages/web/`, and why the blast radius differs per site:**

- `lib/stripe.ts`'s `export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, ...)` is
  evaluated at *module* scope. `next build`'s "Collecting page data" phase evaluates every route
  module (including API routes) to statically analyze it, even though the handler itself never
  runs at build time. A missing `STRIPE_SECRET_KEY` killed the entire build with `Failed to
  collect configuration for /api/billing-portal` / `Neither apiKey nor config.authenticator
  provided` — one bad env var takes out the whole site, not just billing.
- `lib/supabase/client.ts`'s `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` is
  inside a function, but every `'use client'` page that calls it directly at render time
  (`auth/sign-in`, `auth/sign-up`, `auth/reset-password`, `auth/forgot-password`) gets statically
  prerendered by `next build` for its initial HTML *unless marked dynamic* — so this crashed the
  build too, just one route at a time (fixing one exposes the next one in the next build attempt).
  Function-scope alone does **not** mean build-time-safe; it depends on whether the calling
  component/route is actually prerendered.
- `lib/supabase/server.ts`'s `createClient()` (the RSC/route-handler client) calls `cookies()`
  internally, and using `cookies()` inside a Server Component forces that route to opt out of
  static generation entirely (Next.js docs: dynamic APIs make the route dynamic). Empirically
  confirmed: `/dashboard`, `/account`, etc. all render as `ƒ (Dynamic)` in the build output, never
  prerendered, so `server.ts`'s `!` assertions never execute during `next build`.
  **Correction — this WAS still a runtime 500, just not a build-time one:** the earlier note here
  ("lower blast radius, don't reflexively fix it") was wrong about *run*time. `Navbar`
  (`components/layout/Navbar.tsx`) is a Server Component in the shared marketing layout and calls
  `createClient()` unconditionally on **every** request — build-time safety says nothing about
  that. With env vars absent this 500'd `/` and every other page in production/CI (Playwright's
  E2E-gate dev server has no repo secrets). Fixed the same way as `client.ts`: `|| FALLBACK_URL` /
  `|| FALLBACK_KEY` (`.invalid` TLD placeholder, no `isSupabaseConfigured`-gated throw needed here
  because every caller already treats `!user` as signed-out) — applied to both `createClient` and
  `createServiceRoleClient` in that file, since both share the identical `!`-assertion bug class.
  **Why this still fails closed:** auth-js's `GoTrueClient._getUser` wraps the whole lookup in
  try/catch and `_handleRequest` (`lib/fetch.ts`) wraps the underlying `fetch()` too — a network
  failure against the unreachable `.invalid` host throws `AuthRetryableFetchError` (an `AuthError`
  subclass), which `_getUser`'s catch returns as `{ data: { user: null }, error }` rather than
  letting escape. Additionally, when there's no session cookie at all (the common case for an
  anonymous visitor), `_getUser` never even reaches the network — `_useSession` short-circuits to
  `{ data: { user: null }, error: AuthSessionMissingError }` before any fetch happens. Either path
  means `getUser()` degrades to "no user," never throws — verified by tracing every caller of
  `server.ts`'s `createClient` (Navbar, `app/(app)/layout.tsx`'s `redirect()`, and every API route
  under `app/api/`) and confirming each already does `if (!user) return/redirect/401` — none treat
  an auth error as "let the request through." Manually reproduced end-to-end against a live
  `next dev` server with `.env.local`/`.env.production` moved aside: before the fix, `/` and
  `/dashboard` both 500'd with the exact `createClient (lib/supabase/server.ts:12:28)` stack from
  the bug report; after, `/` returns 200 with the logged-out Navbar and `/dashboard`/`/account`
  redirect (307 → `/auth/sign-in`) via the `(app)` layout's own check — this happens even though
  `proxy.ts` fails *open* when unconfigured, i.e. the layout-level check is a real second line of
  defense, not just defense-in-depth theater.
  Regression test: `__tests__/supabaseServerEnvDegradation.test.ts` (unmocked `@supabase/ssr`,
  mirrors `supabaseClientEnvDegradation.test.ts`/`proxyEnvDegradation.test.ts`'s pattern — also
  asserts `auth.getUser()` resolves to `user: null` rather than throwing, not just that
  construction succeeds).
- `proxy.ts` (this repo's Next 16 `middleware.ts` replacement — file is literally named
  `proxy.ts`, exports `proxy()` + `config.matcher`, same runtime contract as classic middleware)
  constructs a `createServerClient` on **every request**. A missing env var here doesn't just fail
  one build step, it 500s every request through the matcher — including the E2E gate's dev server
  in an environment with no repo secrets configured.

**Fix pattern, and the fail-loud-vs-degrade line drawn:**

- Module-scope construction must never throw for missing config — construct with a safe
  placeholder (`stripe.ts`: `process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured'`;
  `supabase/client.ts`: the same `.invalid`-TLD fallback host `supabase.ts` in the extension
  uses) and export an `isXConfigured` boolean.
- The actual *operation* (creating a real Checkout/Billing Portal session, a real Supabase auth
  call) is where you decide fail-loud vs silently-degrade — for Stripe specifically, every
  exported operation in `lib/stripe.ts` (`createCheckoutSession`, `createCreditPackCheckoutSession`,
  `createBillingPortalSession`) now does `if (!isStripeConfigured) throw new Error(...)` as its
  first line, *before* touching the network — a client constructed with a placeholder key must
  never be allowed to actually reach Stripe with it (silently no-op-ing a charge would be worse
  than a crash). This is deliberately a hard refusal, not a network round-trip against a garbage
  key — cheaper, and produces a clear message instead of a confusing Stripe-side auth error.
- `proxy.ts` (per-request middleware, no caller to check a configured flag before use) fails
  **open**: passes the request through unauthenticated with a `console.warn`, rather than
  crashing or force-redirecting to sign-in. Rationale: with no working auth backend there is no
  way to actually authenticate anyone anyway, so hard-blocking every route (including public
  marketing pages under the same matcher) would take the whole site down for what's fundamentally
  a config gap, not a security bypass in a properly configured deployment.
- Route handlers should call through the guarded `lib/stripe.ts` helpers, never construct/call the
  raw `stripe` object directly — `app/api/billing-portal/route.ts` was doing the latter (a
  pre-existing convention violation per CLAUDE.md) and bypassed the `isStripeConfigured` guard
  entirely; refactored it to call `createBillingPortalSession` so the guard actually applies. This
  required updating `__tests__/stripeWebhook.test.ts`'s `vi.mock('@/lib/stripe', ...)` to also
  export a `createBillingPortalSession` mock (it previously only mocked the raw `stripe` object).

**Reproducing the CI failure locally (Windows, no shell `unset` trick works):** Next.js loads
`.env.local`/`.env.production` itself regardless of shell env, so `unset VAR; next build` does
NOT reproduce a missing-var build — the `.env*` file still supplies it. Must `mv .env.local
.env.local.bak && mv .env.production .env.production.bak` (both — `.env.production` here is an
untracked local file with placeholder-empty values, easy to forget) before running `next build`,
then restore both afterward regardless of outcome.

**Test pattern:** a mocked SDK constructor can never throw, so existing tests that
`vi.mock('stripe')` / `vi.mock('@supabase/ssr')` structurally cannot catch this regression class.
Needs a dedicated test file per module that does **not** mock the SDK, stubs the env var empty via
`vi.stubEnv` + `vi.resetModules()` + fresh `await import(...)`, and asserts the module imports
without throwing and `isXConfigured === false`. See `__tests__/stripeEnvDegradation.test.ts`,
`__tests__/supabaseClientEnvDegradation.test.ts`, `__tests__/proxyEnvDegradation.test.ts` — mirrors
the extension's `supabaseEnvDegradation.test.ts` (commit `d45989c`) pattern exactly.
