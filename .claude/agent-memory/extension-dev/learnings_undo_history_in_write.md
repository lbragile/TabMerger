---
name: learnings-undo-history-in-write
description: Undo/redo history changes run in localDb afterWrite (inside the write's queue step); cursor check instead of expectedRev; effect promises; restore keeps current base; test-mock and harness gotchas
metadata:
  type: reference
---

**Design (docs/undo-redo-spec.md §3-§4).** The groups write queue (`enqueueGroupsWrite` + lock) IS the
history queue. `updateGroupsState(fn, { afterWrite(stored, base) })` and `saveGroupsState(state,
{ expectedRev, afterWrite })` run the hook inside the write's own step, after commit; skipped when
`fn` returns null or the write fails; a throwing hook is logged + re-thrown via `queueMicrotask`
(write still resolves). `recordStep({ push, skip, effect, revertsLastStep })` (lib/undoHistory.ts) is
the hook every action uses; Undo/Redo (`moveHistoryCursor`, hooks/useUndoRedo.ts) pop/push via
`uiStore.stepHistory(direction, entry, fresh)` (identity-checked) inside their own afterWrite. A
JS-level queue was rejected: drops issue their write synchronously outside any click queue, and an
in-write history is ordered like the writes by construction.

**Cursor instead of expectedRev.** The old Undo read the cache and wrote with `expectedRev`: any
write in between (Now Open mirror, the previous Undo still landing) refused it. Now a module-level
`cursor` = last state stored through the history; Undo refuses only if `userDataChanged(cursor,
fresh)` (lib/savedData.ts: saved groups, practice groups ignored). Every own saved-data write that
is not a step must keep the cursor in step or it refuses the next Undo / clears history (S1 rule in
recordStep): reminders/info go through recordStep with `skip`; the savedAt migration uses
`carryHistoryCursor` (and must not edit `fresh` in place, or base === result); an own-opened-tab
URL-rule save re-anchors via `reanchorHistoryCursor(saved)`: the message carries
`savedDataFingerprint(stored)` and the popup adopts the fresh state only if its fingerprint matches.
A `rev` gate was tried first and is wrong: useCurrentTabs writes Now Open (always, `updatedAt: now`)
on the same tab events the rule reacts to, so the rev has moved on before the queued re-anchor runs,
and `clearAll*` resets rev to 0.

**Restore keeps the current sync identity (M1).** `restoreSnapshotAsLocalChange` used to keep the
snapshot copy's `remoteUpdatedAt`; harmless while Undo used `saveGroupsState` (preserveBases), but via
`updateGroupsState` the old base was stored → CAS against a stale stamp → "(conflict copy)", or a
clean group adopted remotely → foreign → history cleared. Base now comes from `cur`; equal content
returns `cur` itself.

**Effects as promises.** `tagHistoryEntry(entry, effect | Promise)`; `settledEntryEffect` waits up to
`EFFECT_WAIT_MS`. DnD creates the promise at commit and MUST settle it on every exit
(`p.settleOpened([])`), else an Undo waits 10 s.

**Foreign emit inside the merge step (S3).** syncEngine emits `emitForeignGroupsChange` from the
merge's afterWrite, so a queued Undo sees an empty history instead of a refusal. syncEngine also runs
in the SW: anything it imports must be store-free (why savedData.ts exists, and why it uses
`isTourDemoGroup` from shared, not `isTourDemoEntry`: the syncEngine unit test mocks
`@tabmerger/shared` partially and tourDemo → utils needs FREE_TIER_LIMITS).

**Test gotchas.**
- In-memory localDb mocks must call `opts.afterWrite` or no step is ever recorded; the shared
  `_helpers/updateGroupsStateMock.ts` does. DnD tests' `saveGroupsState: vi.fn().mockResolvedValue`
  became `vi.fn(async (s, o) => { o?.afterWrite?.(s) })`; DnD falls back to `commitBase` when a mock
  passes no base.
- `cursor` and the effect WeakMap are module state: `forgetHistoryCursor()` in beforeEach, and use a
  fresh entry object per test when asserting effects.
- To queue a step behind a held lock in integration (jsdom has no `navigator.locks`): chain a held
  promise onto `globalThis[Symbol.for('tabmerger.groupsLockTail')]`.
- Old-code emulation for "must fail on the old code": copy the file to the scratchpad, patch, run, copy back.
- Rapid clicks in e2e: `page.evaluate` clicking `button[aria-label="Undo"]` several times in one task
  (a disabled button's click is ignored, so start from a state where both stacks are non-empty).
