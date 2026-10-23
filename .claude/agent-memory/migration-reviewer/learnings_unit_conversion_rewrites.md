---
name: unit-conversion-rewrites
description: Review checklist for migrations that rewrite stored values into a new unit (credits, prices) - rerun guards, old app code writing the old unit after apply, and exactness of the inverse
metadata:
  type: reference
---

A migration that converts a column to a new unit (e.g. credit packs re-denominated) has three
failure modes beyond the arithmetic:

- **Rerun guard.** The history table stops the CLI from running a file twice, but a hand rerun
  converts again. A marker such as a column comment checked in a `do` block works; the rollback
  snippet needs the same guard (check the marker, then clear it), or a second rollback run
  converts back twice.
- **Old writers after apply.** The guard runs once. Any row the still-deployed old code inserts
  after the migration (webhook, route) is in the old unit and is never converted, and old readers
  misread the converted rows. The migration and every reader/writer of that column must ship
  together, or the migration must come after the code that writes the new unit. Ask for an audit
  query that tells old from new rows by value range or `created_at`, run after the deploy.
- **Inverse exactness.** For `new = floor(a*x - b)` the inverse `ceil((new + b) / a)` is exact
  only where the floor result was not clamped by `greatest(0, ...)`; clamped rows come back as
  the smallest unclamped value, not as their original. Verify with a `generate_series` over the
  real input range instead of trusting the comment.

Also check the cast back to `integer` cannot overflow for the largest stored value.

Related: [[cli-migration-atomicity]], [[privilege-revoke-review]].
