---
name: free-tier-import-and-urlrules-gating
description: Closing Free-plan limit gaps in import and URL-rules save paths — shared tierLimits.ts helper, counting convention, test-mocking gotchas
metadata:
  type: learnings
---

Implemented the entitlements-audit fixes for import (`ImportExport.tsx`, `Settings.tsx`
Data tab) and URL rules (`useUrlRules.ts`). New shared helper: `src/lib/tierLimits.ts`
(`exceedsFreeLimits`, `countSavedGroupsAndTabs`, `showFreeLimitToast`).

- **Counting convention had conflicting docs — trust the code, not the type comment.**
  `Group.archived`'s inline comment in `types.ts` says archived groups are "excluded from
  free-tier group count", but every actual UI gate (`SidePanel/index.tsx`, `Header/index.tsx`,
  `GroupContextMenu.tsx`, `CreateGroupMenuItem.tsx`, `UpgradeCTA.tsx`) counts
  `available.filter(g => !g.permanent).length` — i.e. archived groups DO count, only the
  permanent Now Open is excluded. `countSavedGroupsAndTabs` in `tierLimits.ts` matches the
  actual code, not the stale comment. If touching this area again, grep the UI call sites
  before trusting a doc comment.

- **`useEntitlements()` is expensive to pull into a hook used by narrowly-mocked tests.**
  It transitively needs `useAuth()` → Supabase, and several existing test files
  (`useGroups.test.ts`, `useUrlRules.test.ts`) don't mock either. Rather than calling
  `useEntitlements()` inside `useSaveUrlRules`, the hook now takes an optional
  `maxUrlRules = Infinity` parameter that the caller (`UrlRulesModal`, which already calls
  `useEntitlements()`) passes in. Existing callers that don't pass it are unaffected
  (no gating, same as before). Same reasoning is why group-creation mutations in
  `useGroups.ts` (`useAddGroup`, `useDuplicateGroup`) were NOT wired into the entitlements
  backstop in this pass — doing so would require mocking `useAuth`/Supabase in
  `useGroups.test.ts`, which wasn't in scope. The existing UI gates (`CreateGroupMenuItem`,
  `GroupContextMenu`, `Header`'s AI-group flow) remain the enforcement for group creation;
  only import and URL-rule saves got the data-layer backstop.

- **`useSaveUrlRules` growth check must compare against the QueryClient cache, not `getSetting`
  freshly re-read.** Read `qc.getQueryData<UrlRule[]>(URL_RULES_KEY)` first and only fall back
  to `loadRules()` if the cache is empty — this matches how `UrlRulesModal` actually seeds the
  draft (from the live query) and is what the tests seed via `qc.setQueryData`. Comparing
  `rules.length > prevRules.length` (not `>= maxUrlRules` unconditionally) is what lets
  reorder/delete succeed for a downgraded-to-Free user who's already over the limit — only
  net *growth* is gated.

- **Free-tier import gating needs different math depending on whether the path is additive or
  a full-state replace.** `ImportExport.tsx`'s Bookmarks/OneTab import and `Settings.tsx`'s
  Data-tab import both go through `useImportGroups` (additive — appends to existing groups),
  so gate on `current + imported`. `ImportExport.tsx`'s own JSON round-trip import
  (`handleImport`) calls `setGroupsState(parsed)` directly — a full REPLACE of `available`,
  including its own Now Open — so gate on the parsed file's own resulting counts, not
  `current + imported` (there's no "current" that survives).

- **Test fixtures with partial/malformed `Group` objects (missing `windows`) will crash a naive
  reducer.** `countSavedGroupsAndTabs` guards with `(g.windows ?? [])` and `(w.tabs?.length ?? 0)`
  specifically because `Settings.test.tsx`'s top-level `vi.mock('@/lib/importExport', ...)`
  returns `[{ name: 'g' }]` for the JSON import path (no `windows` key at all) — without the
  guard, the gate throws inside the `try` block and just shows "Invalid file format" instead
  of actually gating, silently breaking two pre-existing tests that wait for
  `globalThis.confirm` to be called.

## Round 2 (coordinator review, same day): DRY + group-creation backstop

- **`LimitCheckResult` as a discriminated union removes every `check.limit!` non-null
  assertion.** `{ exceeded: true; limit; maxAllowed } | { exceeded: false }` — TS narrows
  `limit`/`maxAllowed` as soon as `check.exceeded` is checked. Any code still doing
  `check.limit!` after this change is a sign the union got flattened back to
  `{ exceeded: boolean; limit: LimitName | null }` by mistake.

- **One `blockImportOverFreeLimit(caps, currentGroups, importedGroups, mode)` replaced two
  near-identical closures** (`ImportExport.tsx`'s `blockedByFreeLimit` and Settings.tsx's
  inline block) that both duplicated the "This file contains N groups, M tabs." string and a
  manual `tier !== 'free'` pre-check. The pre-check was always redundant — `exceedsFreeLimits`
  already passes any cap at `Infinity` (paid tier), so gating functions never need a `tier`
  input at all, only `caps`. `mode: 'append' | 'replace'` captures the one real difference
  between the two import paths (see round-1 note below) — everything else collapsed into a
  single call.

- **The `useSaveUrlRules(maxUrlRules)` pattern — a hook-level default param, not a
  mutation-payload field — is what let the group-creation backstop (`useAddGroup`,
  `useDuplicateGroup`, `useApplyAIGroups`) get wired up with ZERO breakage to existing
  tests/call sites.** All three took `caps: TierCaps = {}` as a hook argument. Because the
  cap lives at hook-instantiation time, not inside `mutationFn`'s parameter, every existing
  `mutateAsync(...)` call (including ones that pass a bare `number` for
  `useDuplicateGroup`, or an array for `useApplyAIGroups`) kept working unchanged — only the
  few UI call sites that HAVE a `useEntitlements()` in scope (`SidePanel/index.tsx`,
  `GroupContextMenu.tsx`, `Header/index.tsx`) needed a one-line hook-args change
  (`useAddGroup({ maxGroups, maxTabs })`). This is the general escape hatch for adding an
  entitlements backstop to any mutation hook whose test suite doesn't already mock
  `useAuth`/Supabase: never make the hook call `useEntitlements()` itself, always accept the
  caps as a param with an ungated default.

- **The backstop reads `qc.getQueryData(GROUPS_QUERY_KEY)` (the cache), not a fresh
  `fetchQuery`.** Same tradeoff `useDeleteGroup`/`useDeleteWindow` already make for their
  live-tab-closing prechecks elsewhere in this file — if the cache is empty/stale the check
  is skipped entirely (ungated), it never blocks on a false negative. Existing
  `useGroups.test.ts` tests that don't seed `qc.setQueryData` before calling `mutateAsync`
  keep passing for free because of this (cache is empty → precheck no-ops → default
  behavior).

- **`useApplyAIGroups`'s suggestion-processing logic had to be extracted into a pure
  `applyAiSuggestionsToState(prev, suggestions)` function** so the precheck (run once against
  the cached state to compute `appliedGroups`/`appliedTabs` for the cap check) and the real
  `mutate()` transform (run against fresh IDB state) share one implementation instead of two
  copies that could drift. `Header.tsx`'s AI-group flow already pre-clamps `suggestions` to
  the remaining group slots before calling this mutation, so in practice this backstop mostly
  guards the tab count, which isn't pre-clamped there.

- **Could NOT wire the caps backstop into `AddGroup.tsx`** (the modal's own `useAddGroup()`
  call, submitted via its Create button) — that file is owned by another agent mid-task
  (DnD/color-picker work in flight) per explicit coordinator instruction not to touch it. The
  hook itself supports it (`useAddGroup({ maxGroups, maxTabs })` would just work), it's a
  one-line change whenever that file is free — flagged back to the coordinator rather than
  forced.
