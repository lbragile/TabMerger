# Undo / Redo — Spec (extension popup)

Status: living document. Last updated 2026-10-15.
Owner agent: `extension-dev`. Read this before touching any code that writes the groups store,
`stores/uiStore.ts` (history), `hooks/useUndoRedo.ts`, `lib/undoHistory.ts`, `lib/savedData.ts` or
`lib/undoLiveTabs.ts`.
Drag-and-drop specifics (which drops are steps, the Now Open side effects) are in
[`drag-and-drop-spec.md`](drag-and-drop-spec.md); this document is the general rule they follow.

---

## 1. The model: a timeline with a cursor, stored as two stacks

Think of the saved groups as a timeline of states, one per user action, with a cursor at "now":

```text
   S0 ──a1──▶ S1 ──a2──▶ S2 ──a3──▶ S3
                          ▲
                        cursor (what the user sees)

   Undo stack (newest first): [S1, S0]      ← states BEFORE the cursor
   Redo stack (newest first): [S3]          ← states AFTER the cursor
```

- **Undo** moves the cursor one step left: pop the top of the Undo stack, restore it, push the
  state being left onto the Redo stack.
- **Redo** moves it one step right: the exact mirror.
- **A new action** at the cursor pushes the state it started from onto the Undo stack and **empties
  the Redo stack** (the old future is a branch nobody can reach any more).

Both stacks are **LIFO** (the last step taken is the first one undone). The only first-in-first-out
part is the cap: each stack holds at most `UNDO_HISTORY_LIMIT` = **10** entries, and pushing an 11th
drops the **oldest**. A single stack cannot do both directions; two stacks are exactly a timeline
plus a cursor, with O(1) moves.

An entry is a full snapshot of the groups state (`GroupsState`) plus, optionally, a **live-tabs
effect** (§5). Snapshots exclude the guided tour's practice groups (they are not the user's).

### Invariant I1 — the cursor is always the current saved data

At every moment the saved groups on screen equal the cursor state. Everything below exists to keep
I1 true: each own change moves the cursor with exactly one entry, and anything that would change the
saved data **without** moving the cursor (another device, another extension context) clears the
history instead (§6), because an entry taken before that change would silently revert it.

---

## 2. What is a step

**One user action = at most one entry.** An action is what the user did once: a click, a drop, a
confirmed dialog, a committed edit (blur / Enter), one bulk action, one import. However many internal
writes, groups or side effects it involves, it is one entry, and one Undo reverts all of it.

**An action adds an entry only when the saved data changed.** The rule lives in one function,
`savedDataChanged(before, after)` (`lib/savedData.ts`, re-exported by `lib/undoHistory.ts`). It
compares the saved groups (every group except Now Open), their order and their content, ignoring:

- Now Open (it mirrors the live browser and is never restored from history);
- sync bookkeeping: `updatedAt`, `pendingSync`, `positionDirty`, `remoteUpdatedAt`;
- the derived `info` line.

So a no-op (a rename to the same name, a toggle on a group that is gone, a note saved unchanged), a
change only to Now Open, or a sync re-stamp adds nothing, and the step Undo offers is always the
user's last real change.

**The entry is recorded inside the write, once it is stored.** Every action writes through
`updateGroupsState` / `saveGroupsState` with an `afterWrite` hook (`recordStep`, `lib/undoHistory.ts`)
that runs in the write's own step of the groups write queue, right after the transaction commits.
So a failed write leaves no entry, and the history is ordered exactly like the writes (§4). The
entry is the state the write started from (the fresh read inside the lock, or for a drop the state
its transaction replaced), so it is exactly the previous cursor state.

**An action made of several mutations is folded into one step** with `asOneHistoryStep(action)`:
the first write that changes saved data pushes the entry, every later write while `action` runs
folds into it (while that entry is still the top one). Where one write can do it, the action uses
one write instead (bulk archive, bulk stale-tab removal).

### 2.1 Every action and its step

| Action | Step |
|---|---|
| Add / duplicate / delete group, archive / restore group | one |
| Add a group with the sidebar "+" then cancel its name (the X) | none: the cancel takes the add's step back with it (`useDeleteGroup({ cancelsAdd })`) |
| Add a group with the sidebar "+" then name it | two (the add, the rename) |
| "Create new group…" in a move / copy menu (add the group + move the item into it) | one (`asOneHistoryStep` in `AddGroupModal`) |
| Rename group, window or tab; change group colour | one (no-op = none; Now Open = none) |
| Group / window / tab note | one per committed edit (blur / Enter), never per keystroke |
| Star group or window, toggle window incognito | one for a saved window; none for a Now Open window (it reopens the real window) |
| Reorder groups (menu or drag) | one |
| Add / delete window, delete all windows, unite / split windows, sort tabs | one for a saved group; none for Now Open (it only closes real tabs) |
| Delete tab, deduplicate group, remove stale tabs | one for a saved group; none for Now Open |
| "Archive all" stale groups (AI suggestion), "Remove all" stale tabs (cleanup banner) | one for all of them (one write) |
| Replace with / merge with current (Now Open) | one |
| Copy a Now Open tab or window to a group (menu) | one (a copy; nothing is closed) |
| Any drop (tab, window, group, multi-item), keyboard move | one per drop, none mid-drag (see the DnD spec) |
| Drag **out of** Now Open into a saved group | one, with a `reopen` effect for the tabs it closed (§5) |
| Drop or menu-move saved items **into** Now Open | one, with a `close` effect for the tabs it opened (§5) |
| Bulk delete / move / star | one per bulk action; none when only Now Open items were selected |
| Apply AI groups, save shortcut tabs | one |
| Import JSON (append) / restore backup (replace) | one |
| Undo / Redo themselves | none (they move the cursor) |

### 2.2 Never a step

- **Reminders** (set / clear): their alarms stay scheduled, so an undo could not take them back.
- **Now Open-only changes**, including the live-tab mirror (`useCurrentTabs`).
- **Restoring a saved session**: it only opens browser windows (Now Open).
- **AI Organize**: it runs on the server; its result arrives by sync, as a change from elsewhere (§6).
- **Settings, theme, sign-in, sessions**: not part of the groups state.
- **Maintenance writes**: `savedAt` migration (it carries the cursor along, §3), `info` recounts,
  sync pulls and pushes.
- **Practice data during the guided tour** goes to the tour's own history (§7), never the user's.

---

## 3. Undo

An Undo is ONE step of the groups write queue (`moveHistoryCursor`, `hooks/useUndoRedo.ts`):

1. Inside the step (`updateGroupsState`: after every write issued before it, including an action
   still saving when Undo was clicked): take the top Undo entry **as the stack is now**. Nothing on
   it: no write.
2. Refuse only if the **saved data** changed without going through the history
   (`changedOutsideHistory(fresh)`, below). A change to Now Open alone never refuses.
3. Restore the entry onto the fresh state as a **new local change** (`restoreSnapshotAsLocalChange`):
   fresh sync stamps for the groups it changes, the **current** Now Open kept, practice groups kept.
   A group that still exists keeps its **current** sync identity: its server base
   (`remoteUpdatedAt`) is the current one, not the snapshot's older stamp, and `positionDirty` is
   derived by the write. An unchanged group is kept exactly as it is. A group the current state
   lacks is re-inserted without a base. It is pushed like any edit, never overwritten by the next pull.
4. Once stored (`afterWrite`, still in the step): move the entry to the Redo stack with the fresh
   state as its counterpart (`uiStore.stepHistory`, only if the entry is still on top: a history
   cleared meanwhile stays cleared, and the restore stands).
5. After the step: groups the restore removed are deleted remotely exactly as the forward action
   would (§8), then the entry's live-tabs effect runs, waiting for one still being collected (§5).

**The cursor check.** `lib/undoHistory.ts` keeps the stored state after the last write this popup
made through the history (every action, also the ones that are no step, every undo, redo and drop).
An Undo is refused, with "Your groups changed elsewhere, so nothing was undone." and the entry kept,
when the fresh saved data differs from it: something wrote the saved groups without going through
the history and its history clear has not arrived yet. Compared with `userDataChanged` (saved data,
practice groups ignored). Kept in step by: the `savedAt` migration (carries the cursor when it was
at the migration's base), a URL rule saving a tab this popup opened (re-anchors the cursor on the
saved data that write left, §6). During the tour's practice chapters the check is skipped (a practice restore
never touches the user's groups).

## Redo

The mirror of Undo: pop the top Redo entry, push the current state onto Undo, restore, run the
entry's effect. A new action after an Undo empties Redo (§1).

---

## 4. Ordering: one queue, nothing overlaps

Actions, Undo and Redo are applied **one at a time, in the order they were issued**. The queue is
the groups write queue (`localDb.ts`: in-context promise chain + cross-context lock), and every
history change happens inside the write it belongs to (`afterWrite`). So:

- an Undo clicked while an action's write is in flight is queued behind it and undoes **that**
  action (the action's step is on the stack before the Undo runs, and its Redo survives);
- a second Undo (or a Redo) clicked before the first one's write landed finds the history the first
  one left: no stale state, no "changed elsewhere";
- extra clicks on an empty stack do nothing. Buttons reflect the stacks: Undo is enabled exactly
  when the Undo stack is non-empty, Redo when the Redo stack is non-empty.

**A step is complete only when both its write and its live-tabs effect are recorded.** The effect
of an action that opened tabs is known only once Chrome returns their ids, after the write: the
entry is tagged with the **promise** of the effect when it is recorded, and an Undo that pops it
waits for it (at most `EFFECT_WAIT_MS` = 10 s), so it never restores the saved data and leaves the
tabs behind. Undo and Redo tag their counterpart the same way with the promise of the inverse
effect, so Undo, Redo clicked in a row run their tab effects in order too.

A drop issues its write synchronously at the drop (DnD spec); its step is recorded inside that write.

---

## 5. Live browser tabs (Now Open side effects)

A snapshot never restores Now Open, so an action that closed or opened **real tabs** carries an
effect on its entry (`lib/undoLiveTabs.ts`, a `WeakMap` keyed by the entry, so it follows the entry
through moves and the cap; the value is the effect or the promise of it):

| Effect | Attached by | Undo does | Then attached to the opposite entry |
|---|---|---|---|
| `reopen` | drag out of Now Open (the tabs it closed) | reopens them, unfocused and inactive, in the same window and position when that window still exists, else a new unfocused window; a tab whose close was deferred (C7) is kept open instead | `close` with the ids Chrome returned |
| `close` | a drop or (bulk) menu move into Now Open (the tabs it opened, as a promise until Chrome returns the ids) | closes exactly those ids | `reopen` with what it closed |

Rules:

- A tab is **only ever closed by its id**, never by URL. A tab already closed is skipped; a tab that
  no longer shows the URL it was opened with (the user navigated it) is theirs and is left open.
- Never close the active tab of the popup's own window while the popup is open (DnD spec C7).
- A reopened tab is a new tab at the same URL: its history, scroll position and form contents are
  gone.
- The effect runs **after** the saved data is restored. It is best effort: if the browser refuses,
  or the effect never arrives within `EFFECT_WAIT_MS`, the saved-data part of the Undo still stands.
- During the tour's practice chapters no effect runs (practice data has no real tabs).

---

## 6. When the history is cleared

| Event | Why |
|---|---|
| Another context wrote the groups (service worker context-menu save, URL rule, a second popup or page) | its change would be reverted by restoring an older snapshot (I1) |
| A sync pull or realtime event applied a **foreign** change (another device): new, changed or deleted rows, conflict copies, or any other change to the saved data (e.g. another device's reorder) | same. Announced from the merge write's own queue step, so no later queued write (an Undo) runs before the history is gone |
| An action whose write starts from saved data the history has not seen (a foreign write whose clear message is still on its way) | its older entries predate that write; the action's step becomes the first of a history that matches the data |
| A history hook throws (`recordStep`, Undo/Redo) | history out of step with the data is worse than none (the write stands) |
| Sign out, account switch, data wipe (Settings) | the snapshots belong to data that is gone |
| The popup closes | history lives in memory only (`uiStore`, not persisted) |

Clearing removes both stacks, and also the user's history set aside during the tour.

**Not** a clear (these are the user's own action, so the step survives):

- this device's own sync push, its realtime echo and later pulls that bring nothing foreign;
- a URL rule saving a tab **this popup just opened** (a drop into Now Open, an Undo reopening tabs):
  one-shot, within 10 s, at the URL it was opened with (`lib/ownOpenedTabs.ts`). Undoing the action
  takes that save back too. The rule's message carries `saved`, a fingerprint of the saved data the
  write left (`savedDataFingerprint`, `lib/savedData.ts`: saved groups in order with their content,
  Now Open, practice groups and bookkeeping left out). The popup re-anchors its cursor
  (`reanchorHistoryCursor`, queued) only while the store still has exactly that saved data, so the
  next Undo is not refused for it. Now Open writes in between (the live-tab mirror reacts to the
  same tab events as the rule) do not matter; any other saved-data change blocks the re-anchor. A
  missing or malformed `saved` means no re-anchor. Not gated on `rev`: every Now Open write moves
  it, and a data wipe resets it to 0.

---

## 7. Guided tour

While the tour's practice chapters run, the user's own stacks are set aside and an empty practice
history takes their place (`beginTourHistory`). Practice snapshots keep the practice groups; restoring
one changes nothing else. `endTourHistory` puts the user's history back unchanged. A clear during the
tour empties both.

---

## 8. Sync

- Undo and Redo writes are new local changes: they are pushed, and win last-write-wins on
  `updatedAt` like any edit. A restored group keeps the server base it has now (§3), so its push is
  a compare-and-swap on the row's current stamp: no "(conflict copy)", and the next pull does not
  take it for a foreign change.
- Groups the restore removed (Redo of a delete or a replace, Undo of an add or an import) are deleted
  remotely with the same call the forward action uses (`deleteRemoteGroups`), regardless of whether
  the `cloudSyncActive` setting has loaded yet. Practice groups are never deleted remotely.
- Remote-delete markers are recorded inside the groups write queue, and only for groups still
  absent, so an Undo racing a delete cannot lose either side.

---

## 9. Edge cases

| Case | Expected |
|---|---|
| Undo with an empty stack | button disabled; nothing happens |
| 11 actions | the oldest entry is gone; 10 Undos reach the state after action 1 |
| Undo ×3, new action | Redo empties; Undo continues from the new action |
| Undo, Redo, Undo, Redo quickly | each applies in order; ends where Redo puts it; no conflict message |
| Undo while an action is still saving | waits, then undoes that action; its Redo survives |
| Undo of a drop into Now Open right after the drop | the saved item comes back **and** the opened tabs close, even before Chrome returned their ids |
| Redo after the user closed one of the reopened tabs | that tab is skipped; the rest close |
| Redo after the user navigated a reopened tab | that tab stays open |
| A tab opens or closes in the browser between actions, or between two quick Undos | Now Open updates; history unchanged; Undo still works and keeps the current Now Open |
| Another device edits a group | history cleared; buttons disabled |
| An Undo queued behind a pull that applies another device's change | the history is cleared first; the Undo does nothing (no message) |
| Popup closed and reopened | history empty |
| Action refused (its group was deleted elsewhere) | no write, no entry |
| A drop or action whose write fails | no entry; no other entry is touched |

### 9.1 Known limits (accepted, safe direction)

- **Undo before a URL rule's message arrives.** A drop into Now Open opens a tab; a URL rule saves it
  in the worker. An Undo issued after that save but before its message reached the popup is
  refused ("changed elsewhere"); a retry works once the message re-anchored the cursor. Likewise an
  action recorded in that gap clears the older history (§6). Nothing is lost either way.
- **Re-anchor is skipped when the saved data changed after the rule's write** (another context's
  change whose message has not arrived yet): the cursor stays, so the next Undo is refused rather
  than adopting that other change.
- **`asOneHistoryStep` is a window, not a token**: a write of another action landing while the folded
  action runs (milliseconds: the add, then the move) would fold into the same step.
- **A copy from a live tab** (`useMoveTab` with a live source) asks the page for its preview image
  before its write is issued; an Undo clicked within those milliseconds undoes the step before it.
- **Practice groups without the `tourDemo` flag** (data from before the flag) count as the user's
  saved data in the cursor check.
- **A partial write** (a synchronous `put` throw inside `writeGroupsState` after earlier requests
  were queued) can commit part of a write without recording a step; the next Undo is then refused.
  No known trigger.

---

## 10. Test matrix

Every row of §2.1, §6 and §9 has a test at the cheapest layer that can see it:

- **Unit:** `savedDataChanged`, `recordStep`, the cursor, `asOneHistoryStep`
  (`lib/undoHistory.test.ts`); the stacks (push clears Redo, cap drops oldest, `stepHistory` /
  `dropUndoEntry` by identity, tour set-aside); pending effects (`lib/undoLiveTabs.test.ts`); the
  restore's sync identity (`lib/syncDirty.test.ts`); `useUndoRedo` (refusal, failure, mid-write
  clear, tour, effects); every hook is one entry or none and the ordering cases G1–G5
  (`hooks/useGroupsUndo.test.tsx`); drops (`hooks/useDndHandlersUndo.test.tsx`).
- **Integration (real IndexedDB):** `undoOrdering.integration.test.tsx` (rapid Undo/Redo, Undo
  during an action, Now Open writes between Undos, outside-history refusal and S1, the restore's
  base through two sync cycles, Undo behind a foreign pull, URL-rule re-anchor, `afterWrite`);
  cross-group drop into a new window → Undo → Redo; own sync keeps the step, a foreign edit clears
  it; Undo racing a remote delete.
- **E2E (real popup):** a drag out of Now Open → Undo reopens → Redo closes; saved items into Now
  Open → Undo closes the opened tabs; rapid Undo/Redo applies in order with no conflict
  (`undo-rapid.spec.ts`).

---

## Decisions

- **2026-10-15 — every mutating action is exactly one step, Now Open drops included (owner).**
  Undo of a drag out of Now Open removes the saved copy and reopens the closed tabs; Redo closes
  them again, by id.
- **2026-10-15 — two LIFO stacks, applied through one queue (owner).** A step is complete only when
  its write and its live-tabs effect are recorded; a Now Open-only change never refuses an Undo.
- **2026-10-15 — the queue is the groups write queue.** History changes run in `afterWrite`, inside
  the write's own step, instead of a second JS-level queue: the history order is the write order by
  construction, also for writes issued outside any click handler (drops, the service worker).
