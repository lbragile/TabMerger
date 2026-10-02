---
name: learnings-dnd-ghost-prominence-and-cursor
description: Follow-up round on the clone-based DnD ghost — fully hiding (not dimming) the source row, making the ghost the unmistakable focal element, and a definitive finding that the native-HTML5-drag cursor glyph is a hard platform constraint, not fixable from app code.
metadata:
  type: project
---

# Ghost round 3: hide-not-dim, prominence, and the cursor dead end

Follow-up to [[learnings_dnd_ghost_clone_fidelity]]. User feedback after that
round: (1) the source row still visibly sits behind the ghost, (2)+(3) a
"strange dotted box" near the cursor / cursor should show "grabbing", (4) the
ghost itself should be more visible/prominent.

## (1) `visibility:hidden` beats `opacity` dim for "empty slot" feel
`hideSourceContent()` (renamed from `dimSourceContent`) now sets
`child.style.visibility = 'hidden'` instead of `opacity = '0.3'` on the same
safe-zone descendants (non-grip, non-grip-ancestor-chain) established in the
prior round. `visibility:hidden` fully removes the content from view while
preserving its layout box — no sibling reflow, reads as the standard sortable
"lifted out of an empty slot" affordance instead of a translucent duplicate.
Restored via `unhideSourceContent()` in `stopGhost()`, same as before.
CDP-verified in the real popup: `getComputedStyle(sourceContentEl).visibility`
is `'hidden'` mid-drag and back to `'visible'`/`''` after drop — added to
`popupRealDnd.repro.ts`'s `dragAndShoot()` helper as
`sourceVisibilityDuring`/`sourceVisibilityAfter` return fields, asserted in
the SCREENSHOT test.

## (4) Ghost prominence — full opacity + layered shadow + ring + scale
`makeGhostWrapper()`: `opacity: '1'` (was `0.95`), `boxShadow` is now three
layers (`0 0 0 1.5px hsla(193,90%,55%,0.7)` — an accent ring — plus two drop
shadows for depth). **Do not read `--primary`/`--ring` as a CSS var here** —
same trap as the `--card` postmortem in
[[learnings_mv3_popup_native_html5_dnd]]: those custom properties are bare
HSL triplets (`193 100% 40%`), only valid wrapped as `hsl(var(--primary))`.
Used a literal `hsla(193, 90%, 55%, 0.7)` function call instead (valid CSS on
its own, no `var()` involved, so the earlier failure mode can't recur) tuned
to roughly match the theme's primary hue. The subtle scale-up (~1.03x) is
composited into the SAME `transform` string the rAF tick already writes
(`translate3d(x,y,0) scale(1.03)`) — a second `style.transform` write per
frame would just overwrite the first, so position and scale must be one
string, not two separate style properties.

## (2)+(3) Cursor glyph — HARD PLATFORM CONSTRAINT, not fixable, don't reattempt
Investigated definitively rather than guessing:
- Confirmed `html5:dragimage` log is unchanged from the previous round
  (`{tagName:"IMG", complete:true, naturalWidth:1, isConnected:true}` in all
  three drag kinds) — **the drag-image suppression did NOT regress** during
  the clone-ghost refactor. Not the cause.
- Found the REAL cause is a browser/OS-level constraint: once a native HTML5
  drag session has started, the browser/OS owns cursor rendering for its
  entire duration. Neither CSS `cursor` (on any element, including
  `document.body`) nor JS can override or replace it — only
  `dataTransfer.effectAllowed`/`dropEffect` select among a small FIXED set of
  OS-drawn glyphs (move/copy/link/no-drop). `'none'` is not an option (it
  breaks the actual drop — already required to stay `'move'`). There is no
  "less intrusive" value to switch to; changing away from `'move'` only
  breaks functionality without changing the cursor problem.
- **This cannot be verified via our CDP screenshot pipeline either way** —
  headless `Page.captureScreenshot` does not render the OS mouse pointer
  sprite at all (it's compositor/OS-level chrome, not part of the rendered
  page), and CDP's synthetic `Input.dispatchMouseEvent` may not even drive the
  same OS-level drag-cursor rendering path a real physical mouse does. So this
  finding rests on documented HTML Drag-and-Drop spec / Chromium platform
  behavior, not a screenshot proof — stated explicitly rather than claiming a
  fix that can't be demonstrated.
- The Windows-specific "strange dotted box near cursor" the user describes is
  almost certainly this exact OS-drawn drag-feedback glyph (a small
  outlined/dashed rectangle Windows renders for many drag operations,
  including HTML5 DnD in Chrome) — not anything this codebase renders,
  positions, or can suppress.
- **Found and removed genuinely dead code while investigating**: `useDnd.ts`
  had its OWN unused, unexported-nowhere `setBodyDragCursor` (a leftover
  export from the pre-native-drag `<DragOverlay>` era) that nothing in
  production imported — only test mocks stubbed the whole `@/hooks/useDnd`
  module (safe to remove; mocks provide their own factory regardless of the
  real module's exports). The REAL, wired-up `setBodyDragCursor` is a private
  function inside `useDndHandlers.ts` (called from `onDragStart`/`reset`) —
  its doc comment was stale (referenced a `<DragOverlay>` that no longer
  exists) and has been corrected to state plainly that it's INERT for the
  native-HTML5-drag path (the primary sensor in this popup) but still
  meaningful for `KeyboardSensor`-driven (accessibility) drags, which have no
  native OS drag session and genuinely respect CSS `cursor`.
- **Recommendation: do not reattempt this.** Any future round chasing "make
  the native drag cursor look different" in the MV3 popup is chasing a
  platform limitation, not a bug in this codebase.

## Architectural question revisited: native `setDragImage(clone)` vs custom DOM ghost — STAYING with the custom ghost
Now that the `setDragImage` attachment requirement is understood (element
must be attached+laid-out, or be a decoded `<img>` — see
[[learnings_mv3_popup_native_html5_dnd]]'s canvas-vs-img postmortem), it was
worth re-evaluating whether passing the ATTACHED row clone directly to
`setDragImage()` (an OS-composited native drag image) beats the custom rAF
ghost. **Decision: keep the custom DOM ghost.** Reasoning:
- A native drag image is invisible to `Page.captureScreenshot` — CDP cannot
  observe OS-composited drag imagery at all. This entire DnD saga has been
  repeatedly bitten by "looks fine per property reads, actually invisible/
  wrong to a human" (see the ghost-palette invisible-card postmortem) —
  switching to a native drag image would throw away the ONE verification
  method that has actually caught real bugs here, for every future change.
- The custom ghost's smoothness is already excellent and CDP-measured (~2px
  delta from the cursor, ~54 distinct positions/sec) — there is no
  demonstrated smoothness problem a native image would fix.
- The custom ghost is what makes `hideSourceContent`, sizing/clamping for tall
  windows, id/testid sanitization, and the accent-ring/scale prominence
  treatment possible at all — a native drag image is a one-shot snapshot
  frozen at `dragstart` with none of that control.
- Not switching without saying why, per the ask: this is the explicit
  trade-off and reasoning for staying put.
