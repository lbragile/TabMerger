---
name: pricing-guest-vs-free-cta
description: The pricing page gives guests and free accounts the same currentTier ('free'); the `signedIn` prop is the only way PricingCard can tell them apart ("Get Pro" vs "Upgrade to Pro")
metadata:
  type: reference
---

`app/[locale]/(marketing)/pricing/page.tsx` starts with `currentTier = 'free'` and only replaces it
for an entitled paid subscription, so a signed-out visitor and a signed-in free account reach
`PricingTable`/`PricingCard` with identical tier props. The old comment in PricingCard ("a
signed-out visitor has no currentTier") describes the unit tests, not the page.

Decision: the page passes `signedIn={!!user}` down through PricingTable to PricingCard (default
`false`). The card treats a visitor as a guest only when `!signedIn && !hasPaidPlan`: a paid
`currentTier` can only come from a signed-in account, so subscriber tests that omit the prop keep
their "Upgrade to"/"Switch to"/"Downgrade to" wording.

- Guest paid CTA: `pricing.getPlan` ("Get {name}"); signed-in free: `pricing.upgradeTo`. Same click
  path for both (checkout POST, 401 sends a guest to sign-in).
- Card-level tests that render without `currentTier` now represent a guest and expect "Get …";
  tests meant as a signed-in free account must pass `currentTier="free" signedIn`.
- Do not "fix" this by passing `currentTier={undefined}` for guests: it also removes the Free
  card's "Current" badge and border for guests, a visible change.
- The home page's `PricingTeaser` has no per-plan buy button (only "See full pricing") and does not
  read the session, so it needs no guest wording. `__tests__/pricing-guest-cta.test.tsx` guards that.
- `e2e/pricing.spec.ts` can run under the signed-out and the `authenticated` Playwright projects,
  so its Pro AI CTA matcher accepts both labels (see [[playwright-authenticated-project-leak]]).
