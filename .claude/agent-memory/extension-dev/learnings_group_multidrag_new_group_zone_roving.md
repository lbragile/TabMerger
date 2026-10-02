---
name: group-multidrag-new-group-zone-roving
description: Group multi-drag + sidebar "new group" drop zone + roving tabindex + the C4-safe overlay trick for always-mounted drop zones; plus the data-window-index / bash-heredoc traps that cost time
metadata:
  type: project
---

# Group multi-drag, the "new group" zone, roving tabindex (2026-09-16)

## The overlay trick: an always-mounted drop zone that costs ZERO layout

**Why:** spec C4 forbids unmounting anything on a dragged row's ancestor chain, so the
`NewWindowDropZone` was kept mounted-but-`invisible` — which meant a permanent 36px+4px
dead band above "Add Window" (the user's 2c complaint). Collapsing it to `h-0` when idle
would move layout at `dragstart`, which is exactly the abort condition.

**How to apply:** put the zone and the "Add X" button in ONE `relative` box and make the
zone `absolute inset-0 z-10`. They are never wanted at the same time (the button is
`invisible` for the whole drag), so overlaying costs nothing and the layout is byte
identical in both states. Used for both `NewWindowDropZone` and the new sidebar
`NewGroupDropZone`. Give the visible zone an opaque `bg-*` or the button shows through.

## Entitlement gating for a pure move engine

`applyMove` is pure and can't read the subscription, and `onDragEnd` frequently resolves
the drop target from `lastRealOverRef` (the popup throttles `dragover`, C2) where dnd-kit's
`over.data` is NOT available. So `over.data.atLimit` is not a reliable gate.
Pattern that works: the zone component mirrors its own state into module scope
(`setNewGroupZoneGate(atLimit, onBlocked)` in `useDndHandlers`, same shape as
`dndMultiDrag`'s registry) and `onDragEnd` reads it there. **Decision taken:** the zone
shows-then-warns at the free-group cap rather than hiding — a target that silently
vanishes explains nothing, and it reuses the exact "Add Group" upgrade toast. (Reversed later: the zone now HIDES at the cap, see `learnings_dnd_finishing_pass.md`.)

## `moveToNewGroup` — reuse, don't reimplement

Creating the group and then replaying the ordinary "dropped on a group ROW" move into it
(synthesise a `HydratedRef` of `type:'group'` pointing at the appended group) gets every
existing rule for free: tab → one new window, window → the group's window, multi → one
group, Now Open → detached copy + `undoable:false`. Guard with
`if (res.next === withNew) return NOOP(s)` so a no-op never strands an empty group.
The new group must ALSO be set active from `useDndHandlers` (`next.active` alone only
persists to IDB; `uiStore.activeGroupIndex` drives the visible panel).

## Group multi-drag: the insertion index must be shift-invariant

`moveGroupsMulti` computes "how many NON-moved groups sat before the gap" rather than
pulling the block out first — otherwise the target slot slides by however many selected
groups were above it. Clamp `insertAt` to ≥1 so nothing lands above Now Open, then re-run
the starred/unstarred zone sort. `promoteStoreSelection` already worked for groups; the
only blocker was an explicit `if (resolved.type === 'group') selectionIds = undefined`.

## Traps that cost real time

- **`data-window-index` is on BOTH the window card and every tab row** (Window.tsx:203 and
  Tab.tsx:378). Even `[data-tm-dnd-list] > [data-window-index]` matches both, because the
  tab row is a descendant of the card. Select the card with `.bg-card`.
- **`rovingControls`-style "which stop am I on" lookups must search the CONTROLS first.**
  `stops.findIndex(el => el.contains(target))` always matches the row at index 0 (the row
  contains every control), so the cursor can never leave it.
- **The Bash tool mangles Python heredocs**: `\\b` inside a `"""…"""` came out as a literal
  0x08 backspace in the written file, and backticks inside a `python -c "…"` get
  shell-expanded. Use the Edit/Write tools for anything containing regex escapes or
  backticks, and scan for control chars afterwards.
- **A repro assertion on the Now Open group's id must not use the seeded id.**
  `useCurrentTabs` replaces the seeded `now-open` with a fresh `nanoid` at boot; assert on
  slot 0 / permanence instead.
- **A `deferred()` write in a commit-safety test now HANGS the handler** — `onDragEnd`'s
  throw path awaits `p.persist`. Settle the deferred inside the same `act()`.

## Roving tabindex without touching every control

`useRovingRow` attaches to the row and, in a dependency-free `useEffect`, sets
`tabIndex = -1` on every focusable descendant. That is attribute-only (C4-safe) and keeps
the row components untouched — with ONE exception: dnd-kit's `{...attributes}` DECLARES
`tabIndex: 0` on the grip and React re-applies a declared prop every render, so the grip
needs an explicit `tabIndex={-1}` after the spread. The hook is inert while
`isDndDragLive()` so a keyboard drag's ArrowLeft still reaches dnd-kit (C13), never touches
Up/Down (the group switcher), and bails inside inputs/textareas.
**Scoped to tab rows + sidebar group rows only** — the window HEADER has no
`tabIndex={0}` container, so making it a single stop is a separate change that would move
`dndFocus`'s `[data-window-header] button` target.
Measured in the real popup: 1 stop per row (was 3–6), in normal AND selection mode.
