---
name: learnings-dnd-rebase-identity
description: Pitfalls of re-identifying id:0 saved tabs/windows between a drag snapshot and the current cache (dndRebase.ts). Rank + a duplicate-only context check (since 2026-09-15) handles permutations relative to stable anchors, but is structurally blind to a pure transposition of two identity-equal items.
metadata:
  type: project
---

`rebaseMove` (packages/extension/src/lib/dndRebase.ts) re-finds snapshot items in the current cache.

**Design as of 2026-09-15 (verified):**
- live items (truthy `id`) → `live:<id>`; saved tabs → `[url, savedAt, customTitle, title, note, pinned]`; saved windows → shell `[name, starred, note]` + every tab's identity
- k-th snapshot item with identity X → k-th current item with identity X, counted over the WHOLE group in stored order
- count changed → AMBIGUOUS → whole drop cancels; count 0 → primary/target cancel, selection member dropped only if `looksDeleted`
- **when an identity is DUPLICATED**, the rank hit must also agree on `contextOf` = `[containing-window shell, nearest stable prev, nearest stable next]`, scanned within the same list only; "stable" = identity count unchanged between snapshot and current. Mismatch → AMBIGUOUS.
- one claim set for primary + selection + target; an unchanged group object (`===`) maps positionally

**What the context check does and does not buy:**
- Detects any permutation that moves a duplicate RELATIVE to a stable anchor (window reorder, cross-window tab move, boundary moves via the `^`/`$` sentinels). Inserts/removals are skipped by the stable() filter, so shift tolerance is preserved.
- **Structurally blind to a pure transposition of two identity-equal items**: context is attached to the POSITION, and a transposition leaves every position's context unchanged. It can never be fixed by widening the context — only by a stable per-item uid.
- Therefore the ONLY remaining mis-move is between tabs that differ solely in a field EXCLUDED from `tabIdentity`: `ogImage`, `favIconUrl`, `chromeGroup`. `reminder` was the one with user-visible consequences and has since been added to the identity, so a wrong pick among the rest is cosmetic.
- Deliberately OVER-EAGER: a reorder of a unique item past duplicates cancels a drop that rank would have resolved correctly. Codified as desired in the tests. Fail-safe.

**Widening did NOT create new spurious cancels:**
- `useCurrentTabs` only rebuilds Now Open, whose tabs have real ids → `live:` identity, immune to title/pinned churn.
- No background writer backfills `note`/`pinned`/window `name`/`starred` on SAVED items; those change only on user or remote edits, where cancelling is the point.
- `favIconUrl`/`ogImage` — the backfill-prone fields — are deliberately OUT of the identity.
- Pre-existing, unchanged: the `savedAt` migration write in the `useGroups` queryFn re-stamps every un-stamped saved tab; landing mid-drag it cancels the drop.
- `detachTab` (dndMove.ts) STRIPS `pinned` on a cross-group move, so `pinned` in the identity is near-inert in practice.

**`looksDeleted` (modified-vs-deleted, #17):** "no current identity exceeds its snapshot count" is a good proxy. It misclassifies only when an edit lands a member onto an identity whose snapshot slot was freed in the same window (edit B→C while C is deleted), or when the member was MOVED to another group. Both are announced as "N was removed elsewhere", not silent.

**Still true:** batch writers stamp ONE `savedAt` across many tabs; Replace/Merge with current JSON-clone Now Open so saved tabs keep real ids and match as `live:`; the rebase is cache-relative (it maps against the TanStack cache, not IDB).

**Why:** duplicate URLs within a group are common, and this is the only guard between a mid-drag remote update and a mis-move.
**How to apply:** when reviewing any positional-id → current-state mapping, test shift + duplicate, permutation relative to a stable anchor, pure transposition, and modify-vs-delete of selection members. Related: [[learnings-groups-write-queue-constraints]].
