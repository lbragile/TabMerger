---
name: ai-auto-group-apply
description: Fixed handleAIGroup discarding useAutoGroup's result; new useApplyAIGroups hook + Now Open tab-id matching
metadata:
  type: project
---

`useAutoGroup` (useAI.ts) returns `{ groups: { name, color, tabIds: number[] }[] }` where
`tabIds` are the real Chrome tab ids of the Now Open (group 0, permanent) tabs sent in the
request — NOT the `id:0` sentinel used for saved-tab copies. That sentinel only applies to
tabs already living inside a saved group; Now Open's live tabs always carry real ids (see
`useMoveTab`'s `sourceTab.id > 0` check, which is the existing precedent for this
distinction).

Added `useApplyAIGroups` in `useGroups.ts` — single `useGroupsMutation()` transaction that,
per suggestion, filters Now Open's `windows[].tabs` by id, builds a new saved group from the
matches (`createGroup` + `createWindow`, tabs re-stamped with `id: 0` and `savedAt`), and
drops matched tabs from Now Open. Browser tabs are intentionally left open — `useCurrentTabs`
re-syncs them back into Now Open next tick, matching the existing (undocumented) behavior of
`useMoveTab`'s Now-Open-to-saved branch, which also never closes the live tab.

Guard: Now Open must never end up with zero windows (breaks other code paths that assume
`windows[0]` exists) — if every window empties out, keep one with an empty `tabs` array
rather than filtering it away entirely.

`Header/index.tsx`'s `handleAIGroup` caps `result.groups` to the free-tier `maxGroups`
remaining slots (mirrors `SidePanel/index.tsx`'s `handleNewGroup` limit-check pattern) before
calling `applyAIGroups`, and surfaces a toast description when suggestions were skipped due
to the cap.

**Follow-up fix (same day):** the first pass toasted "AI created N groups" using
`suggestions.length` (the raw AI response count) instead of what was actually applied — if
zero `tabIds` matched a live Now Open tab, the toast still claimed success with nothing on
screen. Fixed by having `useApplyAIGroups`'s `mutationFn` return `{ appliedGroups,
appliedTabs }`: it pre-checks `qc.getQueryData(GROUPS_QUERY_KEY)` for any id overlap *before*
calling `mutate()` at all (skips the undo-snapshot + IndexedDB write entirely on a full miss,
not just a "toast the wrong number" fix), and `Header` uses the returned count for the toast,
with a distinct `toast.info("No matching tabs found for AI's suggestion")` on the
zero-applied path instead of a false-positive success.

**Dev-mode root cause**: `src/mocks/handlers.ts`'s `group-tabs` fixture was a static object
with hardcoded `tabIds: [1, 2]`, which will essentially never match a real Now Open tab's
Chrome tab id — so Auto-group silently no-op'd in dev mode 100% of the time. Fixed by making
`aiFixtures[path]` optionally a function of the parsed request body; `group-tabs`'s fixture
now echoes back up to 2 real ids from `body.tabs`. `devFetchMock.ts` checks
`typeof fixture === 'function'` and parses `init.body` before calling it. If you add more
route-shaped mocks that need to reference request data, follow this same function-fixture
pattern rather than hardcoding ids/values that must line up with caller state.
