---
name: learnings-search-recently-closed
description: Ctrl/Cmd+K "Recently closed" section and the closed: scope — parse shape, pure search lib, connected wrapper, mutateAsync after unmount, CRLF edits
metadata:
  type: reference
---

**Shape.** `parseSearchQuery` gained `closedOnly: boolean`. `closed:` is a scope, not a filter:
its text joins `tabQuery`, so `closed: stripe` → `{ closedOnly: true, tabQuery: 'stripe' }`. The
windows panel and the day view keep reading `tabQuery` and ignore the scope, so after a reopen the
saved tabs still highlight "stripe" instead of the panel going blank. Any hand-built
`SearchFilters` literal (tests passing `{ groupFilter, windowFilter, tagFilter, tabQuery }` to
`buildPanelSearchView`) needs `closedOnly` too; spread `NO_FILTERS` instead.

**Where things live.**
- `lib/recentlyClosedSearch.ts` (pure): `searchRecentlyClosed(entries, filters, limit)` uses the same
  `textMatches`/`matchRank`/`sortByRank` as saved results; a window entry gives ONE result (its best
  tab, `fromWindow`); `closed:` with no words lists window entries as whole windows
  (`tabIndex: undefined`, Enter restores the window). `group:`/`window:` give no closed results
  under the saved ones and are ignored with `closed:`. `tag:` matches the closed tab's
  `tabGroup.title`. `closedWhenLabel` reuses `dayLabel` + `formatClosedTime`.
- `SearchOverlay` takes optional `closed`/`onReopenClosed` props (no hooks), so its existing tests
  render without a QueryClient. Closed options come after the saved results in the same listbox
  (index = `results.length + i`), so the 12-result cap and order of saved results don't change.
- `Header/SearchOverlayWithClosed.tsx` is the connected wrapper (list, remember setting, tour gate,
  reopen + toast + Undo + `recently_closed_reopened { kind, from: 'search' }`). Header renders it in
  place of `SearchOverlay`.

**mutateAsync, not mutate.** Picking a result closes the overlay, which unmounts the wrapper. Per-call
`mutate(vars, { onSuccess })` callbacks never fire after their observer unmounts. `mutateAsync`
promises still resolve, so the toast and its Undo work.

**Editing CRLF files with Python.** The worktree checks out with `core.autocrlf=true`, so many
sources are CRLF. A Python `str.replace` on a multi-line LF needle silently misses. Normalise to
`\n`, replace, then write back with `\r\n`, or use the Edit tool.

Related: [[learnings-search-highlight-hide-dim]], [[learnings-recently-closed-engine]],
[[test-mocks-follow-hook-usage]].
