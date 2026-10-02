---
name: keyboard-shortcuts-tab-actions
description: F2/N keyboard shortcuts for tab rename/note wired through uiStore signal fields since TabItem edit state is local
metadata:
  type: project
---

Added F2 (rename) and N (add/edit note) shortcuts to `useKeyboardNav.ts`, matching context-menu actions in `Tab.tsx`. Both require a focused tab row (read via `getFocusedTabInfo()` off `data-group-index`/`data-window-index`/`data-tab-index`).

**Wiring pattern**: `TabItem`'s `editingTitle`/`noteOpen` are local component state, not reachable from the global keydown handler. Extended `RenameTarget` in `uiStore.ts` (previously group/window-only, consumed by `GroupItem.tsx`) with a `'tab'` kind + `tabIndex` field, and added a parallel `noteTarget: TabPositionTarget | null` field for notes (no existing signal to reuse for notes). Both are "signal and clear" patterns: the global handler calls `setRenameTarget`/`setNoteTarget`, `TabItem` has a `useEffect` matching its own `{groupIndex, windowIndex, tabIndex}` against the store value, opens its local edit state, then immediately clears the store field back to null so it doesn't refire.

Skipped shortcuts for Move/Copy to group (needs a target group selection), Auto-save to matched rule (conditional/rare), Reset title (conditional), and Reminder (needs follow-up time-picker input) — none are clean single-keypress actions.

No shortcuts-help/legend UI exists anywhere in the popup (checked Header, Settings, Modal dirs) — did not invent one, out of scope per task instructions.
