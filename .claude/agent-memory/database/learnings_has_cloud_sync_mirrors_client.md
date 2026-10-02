---
name: has-cloud-sync-function-notes
description: How to write an RLS entitlement-gate SQL function that matches client-side tier resolution exactly, not a guessed stricter version
metadata:
  type: project
---

When writing a Postgres RLS-policy helper function meant to mirror a client-side
entitlement check (e.g. `resolveTier()` in `packages/extension/src/hooks/useEntitlements.ts`),
read the exact client logic and copy its edge-case handling verbatim instead of writing
what "should" be more correct.

Concretely, for `has_cloud_sync(uid)` (migration 019): at the time it was written,
`resolveTier()` only demoted a subscription to `free` when `status === 'canceled'`, and
`current_period_end` was never consulted at all. A naive "more correct" version would check
`status = 'active'` and/or `current_period_end > now()`, but that would make the DB gate
*stricter* than the client, causing the client to render synced UI while the DB silently
rejects the write (or vice versa). An inconsistent gate between the two enforcement points
is itself a bug, not a hardening.

**Why:** the two enforcement layers must agree bit-for-bit, or the extension shows a
misleading sync state.

**Later change (same migration 019):** Decision: entitled statuses were tightened to exactly
`active`/`trialing`/`past_due` (dropping `incomplete`, `incomplete_expired`, `unpaid`, `paused`
from "still entitled"), landed together with an extension-side change reading a new shared
constant `ENTITLED_SUBSCRIPTION_STATUSES`. That doesn't contradict this rule: the rule is
"don't independently guess a stricter check," not "never tighten." A deliberate, coordinated
change that updates both sides together is how this should evolve. The failure mode this note
guards against is unilaterally "hardening" one side without the other moving too.

**How to apply:** anytime a DB-side gate is added to backstop a client-side entitlement
check, diff the SQL predicate against the TS resolver function (or `ENTITLED_SUBSCRIPTION_STATUSES`
in `packages/shared/src/constants/index.ts`) line by line before writing the migration, and note
in a migration comment exactly which TS symbol it mirrors so drift is easy to catch in review
later. If asked to change the predicate, confirm the client side is changing in the same
commit before applying it. A one-sided change here is the actual bug.
