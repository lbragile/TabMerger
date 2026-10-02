---
name: learnings-dnd-followups-commit-a11y
description: 2026-09-14 follow-ups to the DnD re-audits (#15–#19, A1–A5, contrast, low a11y) — non-obvious gotchas in rank-rebase context checks, TanStack cancelRefetch joins, keyboard-drop announcements, optional-call argument skipping, and test-harness traps
metadata:
  type: project
---

Implemented sync-conflict-auditor #15–#19 and accessibility-auditor A1–A5 + contrast + low items (Group 5 roving tabindex was done later, see `learnings_group_multidrag_new_group_zone_roving.md`).

**Commit path**
- `invalidateQueries` defaults `cancelRefetch: true` → a `fetchQuery` JOINED to the in-flight groups fetch (`useGroupsMutation`, `useBulkActions`) rejects with `CancelledError`. Rollback now passes `{ cancelRefetch: false }` (2nd arg). **Test trap:** without a MOUNTED `useQuery` observer, `invalidateQueries` doesn't refetch at all, so a control test "proves" nothing — mount an observer whose queryFn is a held deferred, then join with `fetchQuery` (`useDndHandlersCommitSafety`).
- `onDragEnd` = `try { commitDrop } catch { rollback } finally { reset() }`; `onDragStart` sets the live-drag flag LAST (a throw in pickup must not leave it set). `useDndHandlers` unmount cleanup clears the module flag/selection. A stuck flag silently kills every `useKeyboardNav` shortcut.
- Rollback restores selection/active group only if the store still holds the drop's values AND no drag is live; pops undo only if `undoStack[0] === commitBase` and restores the redo stack `pushUndo` wiped.

**Rebase (#15/#17) — design that stays shift-tolerant**
- Identity widened (window: name/starred/note + tab identities; tab: + note/pinned). A context check runs ONLY when the identity is DUPLICATED (a unique identity can only be that item): shell of the containing window + nearest STABLE neighbours in the same list, where stable = identity count unchanged snapshot→current (skips inserted/removed/edited items so shifts don't cancel). Full containing-window identity as context would cancel every insert into that window.
- Gone selection member: "deleted" only if the current group has no item with a novel/increased identity (nothing could be its edited form); otherwise cancel the drop. `rebaseMove` now returns `removed` for "Moved 2 of 3 tabs … 1 was removed elsewhere."

**Keyboard a11y**
- A1: keyboard drops give dnd-kit a token ("Dropped."/"Cancelled."); the full outcome goes to `#tm-dnd-live-region` (inside `#tm-dnd-aux-host`, `lib/dndLiveRegion.ts`) 150ms after `focusAfterDrop`'s new `onDone`. Pointer drops still announce via dnd-kit. The real-popup repro reads the APP region now.
- **JS gotcha that shipped a bug for one run:** `onDone?.(focusFirst(sel))` does NOT evaluate `focusFirst` when `onDone` is undefined (optional call short-circuits its arguments). Hoist side-effecting args.
- A3: `SelectionAnnouncer` only stays silent for a same-size change when `consumeDropSelectionRemap` matches (marked by the drop); a same-size non-drop change (Ctrl+A elsewhere) now says "N selected".
- A5 focus is by object IDENTITY in `next` (`applyMove` keeps untouched tab object refs; windows found via a tab ref): landed (only if visible) → still-in-place (Now Open copy) → nearest same-list sibling → sibling window → source/destination sidebar rows. A lone window has no grip → `[data-window-header] button:not([aria-hidden="true"])` (NOT `:not([tabindex="-1"])` — `dndFocus.test` rejects any selector containing `-1`).
- A4: Now Open keyboard reorder follows the real tab id via `qc.getQueryCache().subscribe`, 3s cap, never steals moved focus.
- Grip Shift+Space: literal `onKeyDown` AFTER the `{...listeners}` spread, delegating to `listeners.onKeyDown` for every other key (clobber trap from the MouseSensor learning).

**Contrast (computed)**: `ring-ring` light 16.5:1 on sidebar / 15.9:1 on a selected tab row; dark 12.0 / 11.9. Group selection outline `var(--sidebar-text-active)` 14.5:1 light / 14.0:1 dark vs the selected tint (was 2.04:1). `outline-foreground` 17.9 / 16.8 on a selected row.

**Harness/tooling traps**
- Bash tool heredocs containing backticks/`${}` fail to parse — write multi-line node scripts with Write, then `node file`.
- jsdom: React inline `outline: '2px solid var(--x)'` — assert via `getAttribute('style')`, not `style.outline`.
- Reduced motion for shared `ui/` primitives went into `globals.css` (`.animate-in/.animate-out`, popper wrapper children, `[role="switch"] > *`) — no primitive edits.

**Why:** these were the remaining lost-write / wrong-move / stuck-shortcut and SR-talk-over classes after the DnD rebuild.
**How to apply:** reuse the stable-neighbour context check for any positional→current mapping; reuse `announceOutcome` for any outcome that follows a focus move. Related: [[learnings-dnd-rebase-identity]], [[learnings_dnd_keyboard_a11y_rebase_rank]].
