---
name: saved-copies-and-positional-matching
description: Where the live-to-saved copy helpers (star kept for menu and button copies, dropped for drag) and the "may this delete close a tab" helper live, and how to match tabs by position with a URL check
metadata:
  type: reference
---

Three invariants and the single place each is implemented.

**Saved copies are detached.** Anything stored in a saved group from a live source goes
through `copyLiveTab` / `copyLiveWindow` in `src/lib/dndMove.ts` (tab: `id: 0`, no `pinned`,
`savedAt` stamped; window: `id: 0`, `focused: false`, name and incognito kept). Decision: one
helper pair for every writer, in the popup hooks and in the service worker alike. `dndMove.ts`
is safe to import from `background.ts` and `urlRuleEngine.ts`: it imports only types and
`createGroup` from `lib/utils`, no React or DOM.
How to apply: a new "save from Now Open" path calls the helper instead of spreading the live
object.

**The star depends on the gesture.** Decision: a menu or button copy keeps the live window's
star; a dragged window lands unstarred (drag-and-drop spec).

- `copyLiveWindow(w)` is the drag form (`starred: false`); only the DnD engine calls it.
- `copyLiveWindowKeepingStar(w)` (same file, the one place that passes `{ keepStar: true }`) is
  the menu and button form. Callers: `useReplaceWithCurrent`, `useMergeWithCurrent`,
  `useDuplicateGroup` (Now Open source), `useMoveWindow`'s copy branch, and the window branch
  of `useBulkMoveToGroup`.
- A tab's `pinned` is dropped by both forms.
- Every star-keeping caller runs the target's windows through `sortWindowsByStarred` (stable).
  Where a starred copy lands follows from how the caller builds the list: appended
  (`useMoveWindow`) puts it after the target's starred windows; prepended (bulk copy, Merge)
  puts it before them. Assert the full order in tests, not only the flag.
- `copyLiveWindow` takes an options object as its second parameter, so it cannot be passed
  straight to `Array.prototype.map` (the index would arrive as the options; `tsc` rejects it).
  `copyLiveWindowKeepingStar` takes one parameter and can.

**Only Now Open closes browser tabs.** `closableTabIds(group, tabs)` in
`src/hooks/useGroups.ts` returns ids only for a `permanent` group. Every delete that may call
`chrome.tabs.remove` takes its ids from it; liveness is decided by the source group, never by
whether an id is non-zero. The DnD engine follows the same rule (`isPerm(groupIndex)`).

**Tabs are matched by position.** Saved tabs share `id: 0`, so a mutation that selects tabs
uses `{windowIndex, tabIndex}`. `findDuplicateTabs(windows)` in `src/lib/deduplication.ts`
returns each duplicate with its position; `useDeduplicateGroup` takes
`{windowIndex, tabIndex, url}[]` and applies a position only while the tab there still has
the listed URL. Decision: the URL check is what keeps a list built on an earlier render from
selecting a different tab (Now Open can change between opening a confirm dialog and
confirming).

Test notes:
- A hook test that deletes from Now Open must seed the query cache (`qc.setQueryData`): the
  close decision reads the cached group, the write reads IndexedDB.
- `eslint` ignores `src/__tests__/**` in this package, so a clean lint run says nothing about
  test files; `tsc --noEmit` does cover them.
- Mock call tuples from `vi.fn()` are `any[]`; annotate the element you read
  (`call[0] as {...}`) instead of typing the callback parameter as a tuple.

Related: [[learnings_now_open_window_copy_to_group]], [[learnings_now_open_dnd_copy_semantics]].
