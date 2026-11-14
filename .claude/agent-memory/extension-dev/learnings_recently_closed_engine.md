---
name: learnings-recently-closed-engine
description: Recently-closed recording engine - closeTabs({record}) + ESLint ban, quiet-close marks per key, serial event queue, IDB v2 upgrade, marks + delayed delete, plan-aware pruning
metadata:
  type: reference
---

"Recently closed tabs" is recorded by the background worker from `chrome.tabs` events (no
`sessions` permission). Files: `lib/recentlyClosed.ts` (pure, worker-safe), `lib/recentlyClosedDb.ts`
(IDB), `lib/recentlyClosedRecorder.ts` (worker), `lib/recentlyClosedDays.ts` (popup only: reads the
catalog), `hooks/useRecentlyClosed.ts` (data API), `components/Settings/RecentlyClosedSettings.tsx`.

Non-obvious points:

- **Every tab/window close goes through `closeTabs` / `closeWindows` (lib/closeLiveTabs.ts) with
  `{ record }`.** ESLint bans `chrome|browser.tabs|windows.remove` elsewhere. `no-restricted-properties`
  can NOT express `chrome.tabs.remove` (its `object` only matches a bare identifier), so the ban is a
  `no-restricted-syntax` selector `MemberExpression[object.object.name='chrome'][object.property.name='tabs'][property.name='remove']`,
  plus `no-restricted-properties` for the destructured `tabs.remove`. A later config block's
  `no-restricted-syntax` REPLACES an earlier one for overlapping files, so the UI-copy block spreads
  `CLOSE_TABS_SYNTAX` into its own list.
- **`record: false` awaits a `chrome.storage.session` write before `tabs.remove`**, so the call is no
  longer synchronous: tests that asserted `tabs.remove` right after a trigger need `vi.waitFor`.
  `record: true` still calls remove synchronously (no await before it). `closeTabs(id)` keeps the
  single-id call shape (`remove(7)`, not `remove([7])`) because existing tests assert it.
- **Quiet-close marks are one storage key per id** (`tmQuietCloseIds:tab:<id>` /
  `:window:<id>`), never one shared map: the popup adding marks and the worker consuming them would
  otherwise lose each other's writes (read-modify-write race across contexts).
- **The recorder runs every event through ONE promise chain.** `onRemoved` handling awaits storage
  and IDB; without the chain, `windows.onRemoved` could flush a window before its last tab was
  buffered, giving two entries. Writes have a second chain so a slow plan lookup doesn't block events.
- **Window-entry tab order** needs the snapshot's `index` kept fresh: `tabs.onMoved`/`onCreated`/
  `onAttached` trigger a debounced per-window `tabs.query({ windowId })` re-index.
- **"Remember closed tabs" is re-read INSIDE the add transaction** (`['recentlyClosed','settings']`),
  so turning it off stops an in-flight recording too.
- **IDB v1 -> v2**: new store only in `oldVersion < 2`; a `blocking()` handler closes a stale
  connection (a popup left open across an update would otherwise block the upgrade forever). The
  integration test builds a real v1 DB with `idb.openDB` BEFORE dynamically importing `localDb`.
  `dbTestUtils.clearDb` lists stores explicitly: add new stores there.
- **Clears are marks** (`clearedAt`), deleted by the worker after `RECENTLY_CLOSED_CLEAR_DELAY_MS`
  (timer after the popup's `CLEARED` message, and a sweep at worker start). Undo = unmark. The UI
  toast is a second shorter than the delay (`RECENTLY_CLOSED_UNDO_TOAST_MS`).
- **Plan for pruning** reuses auto-save's remembered server answer (`AUTO_SAVE_TIER_SEEN_KEY`) and
  only calls `fetchTier` when there is none; unknown -> Pro limits. The popup's `useEntitlements`
  reports `free` when offline, so it is not a safe pruning signal.
- `RESTRICTED_URL_RE` moved to `lib/safeOpen.ts` (re-exported from `hooks/useGroups.ts`) so the worker
  can use it without importing a React hook module.
- `background.test.ts` mocks `@/lib/recentlyClosedRecorder`: the recorder's seed `tabs.query({})`
  otherwise breaks tests asserting `tabs.query` was never called.
- Auto-generated colours: `AUTO_ITEM_COLORS` / `pickAutoColor` / `colorForDay` in
  `@tabmerger/shared` (`utils/autoColor.ts`). `colorForDay` counts days on the calendar key via
  `Date.UTC`, so DST never shifts a day's colour.

Related: [[learnings-auto-save-open-tabs]], [[learnings-groups-rmw-lock]].
