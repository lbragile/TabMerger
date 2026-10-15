---
name: learnings-search-a11y-and-sync-numbering
description: Focus kept in lists when rows vanish (useKeepFocusInList), search overlay combobox wiring, live regions under the tour's inert root, reserved tour demo ids, practice-group-free position numbering, clearHistory vs tourHistory
metadata:
  type: learning
---

**Rows that vanish under focus.** `hooks/useKeepFocusInList.ts` is mounted on the windows panel's
scroll container (covers every window's tab list too, so `Window.tsx` needs nothing) and on the
sidebar's `data-tm-dnd-list="groups"` div. It records the focused row (`data-tm-dnd-id`) and its
list's ids on `focusCapture`, then in a dep-less `useLayoutEffect` (children's DOM is already
committed) checks: row disconnected AND `document.activeElement` is body. Next survivor after,
else before, else `[data-search-status-clear]`; announced through `announceDnd`. Tab ids are
positional, so a "Now Open" tab closing mid-list keeps the same keyed element and focus never
drops; only removing the LAST row does. Enabled only for hide-mode search, or the permanent group.
A removed focused element may or may not fire blur: the hook clears its record only on a blur
that has a `relatedTarget`.

**Search overlay is a combobox.** Input `role="combobox"` + `aria-activedescendant`; the option
rows are buttons with `role="option"` + `tabIndex={-1}` (arrows stay in the input). Section
headers live inside `role="group"` with `aria-labelledby`, never loose in the listbox; "No matches"
text sits outside the listbox. Tests that queried `getByRole('textbox')` for the search input break.

**Live regions and the tour.** `lockTourApp` inerts everything in the app root except allowed
controls and the toaster, which silences any live region inside it. `SearchAnnouncer` is portaled
into `getDndAuxHost()` (body-level sibling of the root). Do the same for any app-wide announcer.

**Header search opener focus.** One effect on `searchOpen` true -> false focuses the opener only
when focus fell to body; a picked tab's `revealTab` runs later (setTimeout) and moves it on.

**Tour demo ids are reserved.** `TOUR_DEMO_GROUP_IDS` / `isReservedTourDemoId` live in
`@tabmerger/shared` (re-exported from `lib/tourDemo.ts`); `sanitizeGroup` in `importExport.ts`
gives an imported group with such an id a fresh nanoid, because the tour removes groups by id.

**Position numbering excludes practice groups everywhere.** Pushed `position` = index among
non-practice groups (`syncEngine` push, `updateGroupsState`). `orderByPosition` and the
`claimsSynced` check use `syncedIndexMap` (same numbering) and sort practice groups last;
`markPushed` compares against the order filtered by the stored groups' `tourDemo` flag (a
`getAll` inside the same transaction).

**History clears must reach the set-aside history.** `clearHistory` also empties
`tourHistory`'s stacks (keeps it non-null so the tour stays in practice mode); otherwise
`endTourHistory` restores another account's or wiped data's snapshots. `useUndoRedo` reads the
stacks from `getState()` at the gesture and, on a refused write, restores only if undo, redo and
tourHistory are all still `===` to what they were right after the pop.

**Settings switches** need an explicit `aria-label`: the visible `<Label>` has no `htmlFor`.
