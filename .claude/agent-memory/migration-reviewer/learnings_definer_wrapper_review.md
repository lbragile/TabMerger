---
name: definer-wrapper-review
description: Reviewing a public no-argument "all counts" function that wraps an existing security definer per-key count - whether the wrapper itself needs definer, what behavioural tests can and cannot prove, end-state check strength
metadata:
  type: reference
---

Seen reviewing 032 `blog_helpful_counts()` (wraps 031's definer `blog_helpful_count(slug)`).

- **The wrapper does not need `security definer` when the inner function already is one and the
  caller can read the key table.** An invoker wrapper reads the key table under the caller's RLS
  and calls the definer inner for the hidden rows. A definer wrapper also bypasses RLS on the
  key table, so a later policy that hides rows there (drafts, unpublished) would not apply to
  it. Both are safe while the key table's policy is `using (true)`; invoker is the smaller grant.
- **Behavioural tests as anon cannot tell definer from invoker here**: the inner definer makes
  the counts right either way. Only `is_definer()` / `isnt_definer()` pins the attribute.
- **An end-state check that compares wrapper to inner only proves agreement**, not that the
  inner sees every row. Run as the migration role (table owner, RLS does not apply), a direct
  `count(*)` per key also proves the totals.
- `has_function_privilege('public', fn, 'EXECUTE')` accepts the `public` pseudo-role and is the
  right way to assert the PUBLIC revoke; per-role checks include PUBLIC grants, so both are needed.
- Cost: a no-arg function over a migration-managed key table is bounded by the key table; each
  inner count is a PK-prefix scan, so total work is O(total votes), and the hosted anon
  statement_timeout bounds a single call. No new abuse class versus the already-public inner.

Related: [[public-vote-table-review]], [[privilege-revoke-review]], [[cli-migration-atomicity]].
