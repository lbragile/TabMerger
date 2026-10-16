---
name: sync-write-scope-and-now-open-coalescing
description: Bulk actions stamp only changed groups (same reference otherwise); useCurrentTabs coalesces tab-event bursts into one Now Open pass (throttle, not debounce)
metadata:
  type: reference
---

**Write scope.** A mutation must set `updatedAt`/`pendingSync` only on groups whose content it
actually changed, and must return untouched groups by reference. Stamping an untouched group makes
the next push send this device's (possibly stale) copy over another device's newer edit; the
compare-and-swap then fails and the merge produces a "(conflict copy)". In `useBulkActions.ts`:
- `useBulkStar` copies a group only when a star flag really flips (`(x.starred ?? false) !== starred`),
  re-sorts only those, and returns `null` (no write, no undo step) when nothing flipped.
- `useBulkDelete` (tab branch) and `useBulkMoveToGroup` deep-clone only the source/target groups
  they mutate in place (`touched` set from the parsed ids + target), not every group.
- Keeping references does NOT narrow what is written: `writeGroupsState` stores every group on
  every write. It scopes the sync stamp and lets `savedDataChanged` skip groups by reference.
- Tests: assert `expect(saved.available[i]).toBe(originalGroup)` for untouched groups; a test that used to
  read `saveGroupsState.mock.calls[0]` after a no-op bulk star must now expect no call at all.

**Now Open coalescing** (`useCurrentTabs`, `NOW_OPEN_SYNC_DELAY_MS = 150`). Mount pass runs
immediately; tab/window events arm ONE timer (later events ride along, they do not reset it) and
a pass never runs twice at once (`running` + `rerun` loop). A reset-on-every-event debounce would
starve forever under a title changing every 40 ms. Each pass re-queries chrome.* and re-reads the
store inside `updateGroupsState`, so the last pass is the latest browser state and a user write
made meanwhile is kept. An in-app unmount clears the timer and flushes one pass (IDB only, no
cache set, no device push). Closing the popup runs no effect cleanups, so nothing flushes there;
the next mount's immediate pass rebuilds Now Open.
- Integration recipe (`syncWriteScope.integration.test.ts`): the integration `setup.ts` chrome stub
  lacks `windows.getAll`, `windows.onCreated`, `tabGroups` and `runtime.id`; add them per file before
  mounting `useCurrentTabs`. Use real timers + `waitFor` there. `fakeRemote.upserts` after
  `pushPendingChanges(session)` shows exactly which groups a write stamped.
- Test recipe: `vi.useFakeTimers()` + `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })`;
  stateful `getGroupsState`/`saveGroupsState` mocks (closure `stored`) to prove the mirror write keeps a
  concurrent saved-group change; hold a pass in flight with `tabs.query.mockImplementationOnce(() => new Promise(...))`.
- Existing tests that `await handleChange()` and expect an immediate write need to wait out the delay.

Related: [[groups-rmw-lock]], [[undo-one-step-per-mutation]].
