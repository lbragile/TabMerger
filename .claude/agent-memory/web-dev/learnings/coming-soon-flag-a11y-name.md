---
name: coming-soon-flag-a11y-name
description: Injecting a "Coming soon" badge span as a child of an <h1-6> breaks getByRole('heading', {name: exact string}) queries because it changes the computed accessible name
metadata:
  type: project
---

When adding a feature-flag-conditional badge (e.g. `AI_COMING_SOON_LABEL`) next to a heading's text,
don't put the badge `<span>` *inside* the heading element (`<h3>{title}<span>Coming soon</span></h3>`).
The accessible name algorithm concatenates all descendant text content, so
`getByRole('heading', { name: 'AI files the mess for you' })` (exact match) stops matching once a
sibling "Coming soon" span is nested inside the same `<h3>` — the accessible name becomes
`"AI files the mess for you Coming soon"`.

**Why:** Existing RTL tests across this repo (`Features.test.tsx`, etc.) assert on exact heading
names. This is invisible until you actually run the test — type-check and lint won't catch it.

**How to apply:** Wrap the heading and the badge in a sibling `<div className="flex items-center gap-2">`
instead, keeping the badge as a sibling of the `<h3>`, not a child. Same pattern applies to any
`AI_ENABLED`/coming-soon rollout work touching marketing headings — see
`packages/web/components/marketing/Features.tsx`.

Related: this repo is mid-rollout on a `NEXT_PUBLIC_AI_ENABLED` flag (`packages/web/lib/aiFlag.ts`
exports `AI_ENABLED`, isomorphic client+server constant) — multiple agents (payments, ai-features,
web-dev) touch overlapping files (`PricingCard.tsx`, `PricingTeaser.tsx`, dashboard/account pages)
concurrently during this rollout, so always `git diff`/re-read a file immediately before editing it,
since another agent may have already applied the same guard.
