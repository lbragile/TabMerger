---
name: learnings-now-open-new-window-dropzone
description: Enabling the "drop here for a new window" zone for Now Open — real chrome.windows.create({tabId})/tabs.move detach instead of a stored mutation, and why almost none of the saved-tab-into-Now-Open path needed to change
metadata:
  type: project
---

# Now Open's own "new window" drop zone (2026-09-24)

**Supersedes** the note in `learnings_archive_above_and_now_open_add_window.md` that says
`NewWindowDropZone` "was deliberately left hidden for Now Open" — it is now enabled there
too. `Windows/index.tsx`'s `group.permanent` branch renders `<NewWindowDropZone>` exactly
like the saved-group branch (same absolute-overlay-over-the-button pattern, C4-safe).

**The only genuinely new code path is Now Open → Now Open's OWN zone.** Saved tab(s) →
Now Open's new-window zone (single AND multi) already worked in `dndMove.ts` before this
task — `resolveTabDest` treats `o.type === 'new-window'` as "append a brand-new window",
and the existing `!srcIsPerm && destIsPerm` / `moveTabsMulti`'s "INTO Now Open" branch
already special-case `dest.createdWindow` (`targetWin` is `undefined` → `windows.create`
with the real url(s)). It was simply unreachable through the UI because the zone wasn't
rendered for `group.permanent`. Don't re-derive this path from scratch next time — check
what's already there before assuming a whole new branch is needed.

**Now Open → Now Open's zone is a real chrome move, never a stored write.** New
`DndSideEffect`: `{ type: 'tabs.detachToNewWindow', tabIds: number[] }`. Executor
(`runSideEffects` in `useDndHandlers.ts`): `chrome.windows.create({ tabId: tabIds[0],
focused: false })`, then (if more ids) `chrome.tabs.move(rest, { windowId: created.id,
index: -1 })`. `dndMove.ts`'s `moveTab` (single) and `moveTabsMulti` (multi) both return
`next: s` (identity, no stored mutation) with this side effect — Now Open re-syncs itself
via `useCurrentTabs` once the real browser catches up, same pattern as the existing
Now Open reorder (`tabs.move`) case.

**Edge cases resolved, what's verified vs. inferred:**
- **Sole tab of its window → skip entirely** (no side effect, no chrome call): checked
  `srcWin.tabs.filter(Boolean).length <= 1` before emitting the effect. Chosen over
  letting `windows.create({tabId})` run anyway, since that would fire a real chrome call
  for something that changes nothing observable (the "window" already only has this tab)
  and risks an empty leftover if Chrome's actual behavior here ever differs from assumed.
  **Only checked for the single-tab drag** — a multi-select that happens to drag every
  tab out of a multi-tab window is NOT special-cased (spec only asked about "the ONLY
  tab", singular); it goes through the normal multi-tab detach path and creates a
  genuinely new window+id, which is a real (if arguably redundant) action.
- **Pinned tabs: NOT specially handled, and NOT empirically verified against real
  Chrome.** Reasoning (inferred from the Chrome extension docs, not tested live): `tabId`
  in `windows.create` moves the SAME tab object rather than creating a new one, so its
  `pinned` flag should travel with it; `tabs.move`'s documented pinned-tab index
  constraints only bite when mixing pinned/unpinned within one `move` call at an
  explicit index — this uses `index: -1` (append) into a window whose only occupant so
  far is the just-detached first tab, so no ordering conflict was anticipated. Flagged
  **[UNVERIFIED]** per the DnD design notes' convention — needs a real headed-Chrome check.
- **Incognito: not handled explicitly, reasoned to be a non-issue.** All tab ids in one
  `tabs.detachToNewWindow` batch come from ONE selection, which per `canDrop`/`applyMove`
  can only be tabs the user multi-selected together — and a real Chrome window (and every
  tab in it) is uniformly incognito or not, so there is no way for a same-selection batch
  to straddle the boundary. `windows.create({tabId})` with no explicit `incognito` field
  inherits the tab's own window's profile automatically. Not empirically verified either.
- **Multi-select order**: `tabIds` preserves ORIGINAL (sorted by group/window/tab index)
  order via `moveTabsMulti`'s existing `sel.sort(...)`, not click/selection order — this
  is the same ordering guarantee spec §6.1 already requires elsewhere, just threaded
  through to the new side effect's `tabIds` array.
- **Mixed selection (some Now Open + some saved tabs) dropped on the Now Open zone**:
  deliberately rejected (`NOOP`, no side effect) — there's no single well-defined real
  action (open the saved ones as tabs in the SAME just-detached window? a second window?
  spec didn't ask for this and it's genuinely ambiguous), so it's refused rather than
  guessed at. Window drags still can't target the new-window zone at all (`canDrop`
  already restricted `oKind === 'new-window'` to `aKind === 'tab'` before this task).

**E2E not added.** A real Now Open detach needs an actual second live Chrome window and a
native HTML5 drag session — the existing coverage for exactly this class of behavior is
the CDP-based `popupRealDnd.repro.ts` harness, not standard
Playwright `test:e2e`. Writing a new CDP repro case was out of scope for this task's
effort budget; flagging it as the follow-up rather than faking coverage. Unit-level
coverage (`dndMove.test.ts`, `dndNowOpenMoveOut.test.ts`) covers the pure-layer decisions
and the `runSideEffects` executor calls exhaustively; only the OS-composited drag/drop
gesture itself and live pinned/incognito behavior remain human-verify items.
