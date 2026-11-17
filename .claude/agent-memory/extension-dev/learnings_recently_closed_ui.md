---
name: learnings-recently-closed-ui
description: Recently closed sidebar section + day view + session colours - mainView closedDay, shared actions hook, Save to group through useGroups, test-mock fallout, Radix submenu clicks in jsdom
metadata:
  type: reference
---

The Recently closed UI is built on the section-view pattern ([[learnings-section-views-mainview]])
and the engine's data API ([[learnings-recently-closed-engine]]).

Shape:
- `mainView` `{ kind: 'closedDay', day: 'YYYY-MM-DD' }`. `MainPanel` finds the day in
  `useRecentlyClosed().days`; "gone" only once the query is not loading. `ClosedDayView` is keyed by
  the day so "Show more" starts over. Focus-on-close opener: `[data-closed-day-open]`, else the
  group row, else the section toggle inside `[data-recently-closed-section]`
  (`RECENTLY_CLOSED_SECTION_ATTR` lives in `lib/sidebarSections.ts`, NOT the component module:
  MainPanel importing the section component dragged its hooks into every MainPanel test).
- `uiStore.openSidebarSection` now defaults to `recentlyClosed` (not persisted, so every popup open).
- All list actions + toasts + status line + analytics live in ONE hook,
  `hooks/useRecentlyClosedActions.ts`; components get `true` back when the entry really left, and
  only then move focus (`useFocusAfterRowRemoval` gained a `fallbackSelector`, the day view uses
  the h2 marked `SECTION_VIEW_TITLE_ATTR`).
- Undo of a toast runs every token in order with `mutateAsync` (a "Reopen all" is a reopen of a
  synthetic, never-stored window entry PLUS a removal of the day; the reopen token's `entries` is
  emptied or Undo would store the synthetic entry).
- Reopening ONE tab of a window keeps the same entry id (rest of the window, or a 1-tab `tab`
  entry): never wait for the id to disappear there, the pending focus would fire much later.
- Analytics `kind` = what actually opened (`tab` for one tab of a window, `window` for a whole
  window and for "Reopen all"); same rule as the Ctrl+K search branch.
- Save to group: `useSaveClosedToGroup(caps)` in useGroups (one `mutate`, so one undo step,
  `pendingSync`, Free backstop via `assertWithinFreeLimits`); the pure part is
  `lib/recentlyClosedSave.ts`. Single tabs go into the group's last window; window entries become
  windows; mixing both puts the singles in their own new window.
- `SectionViewHeader`: primary button, Delete and banner are optional; `menuItems` go before Delete.

Session colours: `Session.color` validated on every read (`withValidSessionColor` in `getSessions`,
`validSessionColor` in the backup download and `sessionContent`), stored only inside the encrypted
blob, `colorForId` (FNV-1a mod palette) for old sessions, `updateSessionColor` in localDb is one
transaction that never re-creates a deleted session. The web dashboard's `toSavedItem` picks
fields explicitly, so the extra blob key is ignored there.

- **Undo toasts get NO shared Sonner `id`.** With one id for every action, Undo then a second
  action showed no toast at all in the real popup: clicking a toast's action dismisses it, and a
  new toast under the id of a toast Sonner is still dismissing never appears. Only plain
  confirmations (saved, link copied) share an id.

Session uploads after a sync-conflict audit (all in `lib/sessionUpload.ts`):
- `queueSessionUpload(id, task)`: one upload per session id at a time in this context; the sync's
  sessions pass, colour changes and the remote delete (`deleteRemoteSessionsQueued`) all go
  through it, so a delete always lands after an in-flight upsert and picks land in order.
- `uploadStoredSession(id, owner)` uploads the copy stored WHEN ITS TURN COMES. Stamped sessions
  (`uploadedAt`, now set on saved sessions too, not only backups) are update-only
  (`refreshUploadedSession`); `gone` = deleted on the dashboard: local stays, nothing re-inserted.
- After an upload, a session gone locally is deleted remotely ONLY if `noteSessionDeletedHere`
  recorded a user delete: "Clear all data" / account switch also empty the store and must never
  delete account data (same reason the sync pass checks its own in-progress marker).
- `Session.uploadPending` is a token (epoch ms), set in the same IDB write as the change;
  `markSessionUploaded(id, at, token)` clears it only if unchanged. `useSync` uploads marked
  sessions one by one when no full pass is due, so a popup closing mid-upload loses nothing
  without re-arming a full pass. idb writes that must survive a closing popup: `tx.commit()` in
  the same tick as the `put`.
- Save to group: the mutator decides "target gone" on the FRESH state and the mutation throws
  `ClosedSaveTargetGoneError` (in `lib/`, never re-exported from `hooks/`: WXT auto-import trap),
  so no success toast, analytics or `tabs_saved` fire for a write that did nothing.
- Two-number copy with proper plurals ("up to 50 from the last 7 days"): pluralise on the days
  (`count`), pass the other number pre-formatted (`formatNumber`) as a plain placeholder; split
  the Free and Pro halves into two keys so each day count gets its own plural form. Pick a
  sentence shape per language whose day phrase has one grammatical case (German "7 Tage lang").

Test gotchas:
- E2E submenus (real Chrome): moving the pointer from a SubTrigger to its items crosses the other
  menu items and closes the submenu ("html intercepts pointer events", item detached). Use
  `subTrigger.press('ArrowRight')`, check the first item is focused, then `keyboard.press('Enter')`.
- E2E toasts: find the Undo button through the toast's text
  (`[data-sonner-toast]` filtered `hasText`), toasts can stack.
- The unit `vitest run --coverage` excludes `src/__tests__/integration/**`; run
  `vitest.integration.config.ts` separately.
- Adding the section to `SidePanel` broke every SidePanel test (QueryClient missing, `useGroups`
  mock without `useSaveClosedToGroup`): mock the section module, like AutoSavedSection. MainPanel /
  App tests need `vi.mock('@/hooks/useRecentlyClosed', ...)` returning `{ days: [], isLoading: false }`.
- Radix submenu items in jsdom: open the sub with `{ArrowRight}` after clicking its trigger, then
  `fireEvent.click(item)`; `user.click` on the item closes the submenu without selecting.
- `logicalDirection.test.ts` fails on `text-ui-start` on an element without its own `dir`.
- A bash heredoc holding a Python script with many quotes failed to parse ("unexpected EOF") and a
  very long command hit ENAMETOOLONG: write scripts to the scratchpad with Write, run them with python.
