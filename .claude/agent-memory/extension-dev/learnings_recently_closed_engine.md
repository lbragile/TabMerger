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
- **The switch and the last full clear live in the store's own meta row** (`RECENTLY_CLOSED_META_ID`,
  `{ remember?, clearedBefore? }`), so a recording is ONE transaction on ONE store (a
  `['recentlyClosed','settings']` readwrite tx serialised recordings behind every settings/groups
  write). The old `appSettings.rememberClosedTabs` is copied once (`migrateRememberClosedTabs`, run
  at worker start); `useAppSettings` overlays the meta value (try/catch: many unit tests mock
  `localDb` without `getDb`). Every `getAll` consumer must skip the meta row: prune's "corrupt row"
  cleanup would otherwise delete it, and e2e helpers that read the store raw must filter it.
- **`clearedBefore` drops closes still queued from before a full clear** (window buffer, write
  queue) inside the add transaction. "Clear all data" clears the store and puts the meta row back
  with `clearedBefore`.
- **IDB versions**: new store only in `oldVersion < N`. `getDb` memoises the OPEN PROMISE (concurrent
  first calls used to open several connections), closes exactly the connection that got
  `versionchange` (`event.target` vs `unwrap(db)`), logs `blocked`, resets on `terminated`, and on
  `VersionError` (database newer than the build) reopens with no version. `DB_VERSION` must never go
  down: `localDbVersion.test.ts` holds a shipped floor. fake-indexeddb runs the whole
  blocking/versionchange dance (see `localDbConnection.integration.test.ts`, which uses
  `vi.resetModules()` + `deleteDB` per test for a fresh module and database).
- **Clears are marks** (`clearedAt`), deleted by the worker 60 s later (`RECENTLY_CLOSED_CLEAR_DELAY_MS`;
  timer after the popup's `CLEARED` message, and a sweep at worker start). The toast is 9 s:
  Sonner PAUSES a toast while hovered or the page is hidden, so the delete delay must be far longer
  than the toast. Undo compares what came back with the ids and reports `{ complete }`.
- **Recording never waits on the network**: entries are written with the Pro limits; a KNOWN Free
  plan trims in a separate queued step afterwards; the plan lookup has a 3 s timeout (a timed-out
  answer is not memoised). Plan source: auto-save's remembered server answer
  (`AUTO_SAVE_TIER_SEEN_KEY`, a "free" only while `recentlyFree`), else `fetchTier`; unknown -> Pro
  limits. The popup's `useEntitlements` reports `free` when offline, so it is not a pruning signal.
- **Chrome un-pins a window's pinned tabs (`onUpdated { pinned: false }`) just before closing the
  window** (seen in the worker's event log): the snapshot keeps `unpinnedAt`, and a close within
  `RECENTLY_CLOSED_UNPIN_GRACE_MS` (1.5 s) counts the tab as pinned.
- **`tabs.onRemoved` can arrive after `windows.onRemoved`**: a window's quiet mark is left to expire
  (30 s), never removed at `windows.onRemoved`.
- **A quiet close awaits a storage write, so anything that focuses a new window first loses the
  popup before the close**: create the window `focused: false`, close the old one, then
  `windows.update(id, { focused: true })` (incognito toggle, `useOpenWindow`).
- Private tabs are never snapshotted (nothing about them reaches `storage.session`), and snapshot
  favicons are capped like stored ones.
- `RESTRICTED_URL_RE` moved to `lib/safeOpen.ts` (re-exported from `hooks/useGroups.ts`) so the worker
  can use it without importing a React hook module.
- `background.test.ts` mocks `@/lib/recentlyClosedRecorder`: the recorder's seed `tabs.query({})`
  otherwise breaks tests asserting `tabs.query` was never called.
- Auto-generated colours: `AUTO_ITEM_COLORS` / `pickAutoColor` / `colorForDay` in
  `@tabmerger/shared` (`utils/autoColor.ts`). `colorForDay` counts days on the calendar key via
  `Date.UTC`, so DST never shifts a day's colour.

Related: [[learnings-auto-save-open-tabs]], [[learnings-groups-rmw-lock]].
