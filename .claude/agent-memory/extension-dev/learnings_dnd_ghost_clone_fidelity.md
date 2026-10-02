---
name: learnings-dnd-ghost-clone-fidelity
description: Replaced the synthesized DnD ghost card (hardcoded colors, generic chip) with a faithful `cloneNode(true)` of the actual dragged row — how sizing/sanitization/dimming were done safely inside the MV3 popup's native-drag-abort constraint.
metadata:
  type: project
---

# Ghost fidelity: `cloneNode(true)` instead of a synthesized card

Follow-up to [[learnings_mv3_popup_native_html5_dnd]]. User complaint: the
custom ghost (in `packages/extension/src/lib/dndHtml5Sensor.ts`) was visible
(prior round fixed that) but looked NOTHING like the real row — a generic
chip with hardcoded hex colors, its own padding/font, no group border/window
chrome. Fix: `makeGhostWrapper(row, rect)` now does `row.cloneNode(true)` into
an otherwise-unstyled positioning wrapper, instead of hand-building a card.

## Why a clone "just works" for styling
`cloneNode(true)` preserves every `class` attribute AND inline `style`
attribute. Tailwind/global CSS selectors match by class regardless of DOM
position (no shadow DOM), so classes resolve identically whether the clone
lives in `#root` or in `#tm-dnd-aux-host` (a `<body>` sibling, per
`dndGhostHost.ts`). Inline styles set by React (e.g. `GroupItem`'s
`borderLeft: 3px solid ${group.color}` on the ACTIVE group only) are literal
`style="..."` attributes on the DOM node and get cloned verbatim too. CSS
custom properties (`--card`, `.dark`) resolve because `document.documentElement`
is a genuine ancestor of the aux host even though `#tm-dnd-aux-host` sits
outside `#root`. **Net result: delete the entire `ghostPalette()` hardcoded-hex
class of bug — it cannot drift from the real design tokens again because
there's no independent palette to drift.**

## Non-obvious gotcha: most rows have NO background/border by default
A tab row (`Tab.tsx`) has no `bg-*`/`border` class at all (only
`hover:bg-accent/50`, irrelevant to a non-hovered clone). A group row
(`GroupItem.tsx`) only gets a real `borderLeft` color while `isActive` — the
default is `3px solid transparent`. **This means a "transparent tab ghost" or
a "transparent-border group ghost (when dragging a non-active group)" is
CORRECT fidelity, not a bug** — an earlier version of the E2E screenshot test
asserted `backgroundColor !== 'rgba(0,0,0,0)'` and `borderStyle === 'solid'`
unconditionally, which was tuned for the OLD synthesized-card design and had
to be rewritten. Only `WindowItem` rows have an unconditional `border
bg-card` class, so that's the right row kind to assert background-fidelity
against; only an ACTIVE group has a real border color, so that test must
`selectGroup()` the dragged group first.

## Sizing / clamping
Wrapper gets an explicit `width` from `row.getBoundingClientRect()` (falls
back to `row.offsetWidth || 200` if the rect is 0 — jsdom always returns a
zeroed rect, real Chrome doesn't). For `kind === 'window'`:
`maxHeight = min(rect.height, 440)` + `overflow:hidden`, plus a bottom
gradient-fade `<div>` appended as a SECOND child of the wrapper (not inside
the clone) only if the real height actually exceeds 440 — added a
`ghost.children.length` check in tests to distinguish "clamped, not clipped"
(1 child) from "clipped, fade added" (2 children).

## Sanitization (avoiding DOM collisions from the clone)
`sanitizeGhostClone()` strips `id`, `data-testid`, `draggable`, and every
positional `data-window-index`/`data-tab-index`/`data-group-index`/
`data-sidebar-group-index` attribute from the clone AND all its descendants
— both from the top node and recursively, since a naive top-only strip misses
nested elements carrying the same attrs (e.g. a window row clone contains
nested tab rows, each with their own `data-tab-index`). Also zeroes
`clone.style.margin` (a `mb-2` on the real row would otherwise add invisible
dead space / fight the `overflow:hidden` clamp via margin collapsing). Wrapper
itself gets `aria-hidden="true"` + `inert` (Chrome 102+, always available in
an MV3 extension) instead of manually stripping every interactive attribute —
one attribute disables focus/pointer/AT for the whole subtree.

## Broken favicon in a detached clone: React's onError never fires
`cloneNode` never copies JS listeners, and React's `onError` on the real
`<img>` (`Tab.tsx`'s favicon fallback) is a DELEGATED listener rooted at
`#root` — it doesn't fire for a clone living outside `#root`, even though the
event still bubbles (there's no listener up that chain to catch it). Fix:
`sanitizeGhostClone` attaches a real `addEventListener('error', ...)` on every
cloned `<img>` that hides it (`visibility:hidden`) — cheap, and prevents a
broken-image icon flash in the ghost independent of what the source row does.

## Overlap dimming — safe zone is narrower than "not the row itself"
Task's ask: dim the SOURCE row's content (not the ghost) so the dragged
title doesn't double-render under the ghost. The established constraint from
[[learnings_mv3_popup_native_html5_dnd]] is "mutating the grip or any of its
ANCESTORS aborts the native drag; siblings are fine." Implemented as: walk
`row`'s subtree, treating the grip **and everything inside the grip's own
subtree** as an untouchable leaf (skip entirely, no recursion), treating the
chain of ancestors between the grip and `row` (exclusive of the grip, inclusive
of `row`) as safe-to-walk-through-but-never-dim, and dimming (`opacity:'0.3'`
inline style, direct DOM, no React) every other child encountered — dimming a
container fades its whole subtree via CSS `opacity` so there's no need to
recurse into a non-chain child. Restored in `stopGhost()`/`undimSourceContent()`
unconditionally on every end/cancel path. **CDP-verified in the real popup**:
zero new `childList`-on-ancestor-chain mutations, all three drag kinds
(tab/window/group) still reach `committed`. One PRE-EXISTING (not a
regression) `attr:style` mutation on the group ROW itself still logs during a
GROUP drag — it's `GroupItem`'s `onMouseLeave` clearing the hover background,
fires ~9ms AFTER `dragend`/`html5:drop` already happened, so it's harmless;
confirmed present in the pre-fix baseline run too.

## Screenshot verification is still the only trustworthy check
Per [[learnings_mv3_popup_native_html5_dnd]]'s "ghost rendered invisible"
lesson — repeated here: `getComputedStyle`/property reads only prove the DOM
changed, not that it LOOKS right. Verified this round by actually reading
saved PNGs (`Page.captureScreenshot` via CDP) for a tab, a window (light
mode), and an active group drag — all three visually show the real chrome
(favicon+title+URL grid for tabs, white `bg-card` bordered box for windows,
a visible grey/colored left border strip for the group) with a drop shadow,
not a generic pill. `e2e/repro/popupRealDnd.repro.ts` now has 12 tests (was
11); the "SCREENSHOT the ghost card" test's `backgroundColor`/`borderStyle`
assertions had to be REWRITTEN for the clone-based architecture — the old
ones encoded assumptions about the deleted synthesized-card design, not new
regressions; ghostInfo() now reads `wrapper.firstElementChild`'s computed
style for background/border/color and the WRAPPER's own computed style for
opacity/boxShadow/position/transform, since those two concerns now live on
different elements.

## Stray dev server bit again — third occurrence
Before every "prove it's fixed" build+CDP pass, `netstat -ano | grep 3001`
turned up a live `wxt` dev-server process from earlier in the session (found
via `wmic process where "ProcessId=<pid>" get CommandLine`). Killed it
(`Stop-Process -Id <pid> -Force`), `rm -rf .output/chrome-mv3-dev`, rebuilt,
re-verified `grep -c localhost popup.html` → 0 and chunk size ~1.4MB BEFORE
trusting the run. This is now the third time this exact trap has bitten in
this DnD saga — worth checking unprompted at the START of any DnD
verification session, not just when a run looks suspicious.
