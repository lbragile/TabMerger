---
name: learnings-mv3-popup-native-html5-dnd
description: The MV3 toolbar-popup DnD saga — pointer stream withheld, so native HTML5 drag; but the popup ALSO aborts the native drag on any mutation of the drag source's ancestor chain. The shipped fix + the CDP harness that finally reproduced it.
metadata:
  type: project
---

# MV3 action-popup DnD: native HTML5 drag + an ancestor-chain-frozen tree

Supersedes [[learnings_mv3_popup_dnd_sensor]] (MouseSensor) and
[[learnings-mv3-popup-pointer-capture]] (setPointerCapture) — both DEAD ENDs,
`src/lib/dndPointerSensor.ts` kept inert (imported nowhere) as a record.

## Two independent popup constraints (both confirmed against the REAL popup)
1. **Pointer stream withheld.** After `pointerdown` the toolbar popup delivers
   ONE sub-5px `pointermove` then nothing until `pointerup`. No Pointer/Mouse
   sensor can ever start a drag. → use the native HTML5 Drag and Drop API
   (`Html5DragSensor`, activator `onDragStart`, `draggable` attr on each grip).
2. **The native drag aborts if the drag source's ANCESTOR CHAIN mutates.** In the
   real popup, ~1 frame after `dragstart` the React commit that flips
   `isDragging`/`active` mutates the dragged grip's ancestors, and Chrome kills
   the drag: `dragend {dropEffect:'none'}`, no `drop`, no commit, ~160ms total.
   A browser TAB tolerates the identical mutations — which is why NO tab-context
   repro (even paced) ever reproduced it.

   The offending mutations (caught by a `MutationObserver` on the source chain,
   `dndDebugLog('html5:mutation', …)`, debug-flag only, in `dndHtml5Sensor.ts`):
   - `<DragOverlay>` mounting its wrapper `<div>` INSIDE the `<DndContext>`
     subtree — an ancestor of every grip. **childList mutation → hard abort.**
   - "Add Window" / "Add Group" buttons unmounting on `dnd.isDragging`
     (`Windows/index.tsx`, `SidePanel/index.tsx`) — childList mutation on a
     `div.p-2` ancestor of the dragged row. **hard abort.**
   - `useSortable`'s `attributes` flipping `aria-pressed` on the grip; the
     `isDragging`/`isBeingDragged` className on the dragged row/window;
     `useSortable().transition` value churning (`transform linear` ↔
     `transform 200ms`) in the row/window `style`. Attribute mutations on the
     source/ancestors — contributory; on their own tolerated once the childList
     ones are fixed, but removed anyway for margin.

## The fix (all shipped)
- **Ghost, not `<DragOverlay>`** (`DndProvider.tsx`): a cursor-following card
  rendered via `createPortal` into `#tm-dnd-ghost-host` — a `<div>` appended to
  `document.body` ONCE at boot, a permanent sibling of `#root`, never
  added/removed. Mutating its subtree never touches a grip's ancestor chain.
  It tracks `dragstart`/`drag`/`dragover` (capture, passive) for position; in the
  popup those are throttled so it barely moves — acceptable, it just needs to
  exist. Keeps `data-testid="drag-overlay"` for tests (query off `document`, not
  the RTL container, and only present WHILE dragging).
- **Keep "Add Window"/"Add Group" mounted** during a drag — `invisible` +
  `disabled`, never unmounted.
- **`aria-pressed={undefined}`** pinned on all three grips (after the `{...listeners}`
  spread).
- Dragged **row/window/group**: `transform: isDragging ? undefined : …`,
  `transition: 'transform 200ms ease'` HARDCODED (stable string), and NO
  `isDragging`/`isBeingDragged` className. `GroupItem` also suppresses its
  `isOver` ring when `dndActive?.id === group.id` (dragging a group over itself).
- Sibling rows still animate (their strategy `transform` + the stable transition).
- `useDndHandlers.onDragOver` still applies NO reordering `overrideState` preview
  (`overrideState` is permanently `null`); commit-on-drop via `lastRealOverRef` /
  `e.over` against the pre-drag snapshot.
- `Html5DragSensor`: `dragenter` + `dragover` both `preventDefault()` +
  `dropEffect='move'` every call; `drop` AND `dragend` feed a final `onMove` from
  THEIR OWN client coords (the popup throttles intermediate `dragover`s, so the
  true release position only arrives on drop/dragend); `onEnd` deferred one
  macrotask (dnd-kit's `createHandler(DragEnd)` needs a `scrollAdjustedTranslate`
  flush or it silently drops the lifecycle call); 1×1 canvas transparent drag
  image; NO priming `onMove` at dragstart.

## The harness that finally reproduced it — `e2e/repro/popupRealDnd.repro.ts`
Launch persistent context w/ `--remote-debugging-port`, seed IDB (wait for the
app to boot FIRST — a bare `indexedDB.open('tabmerger',1)` before that makes a
store-less DB and the seed silently no-ops), `chrome.action.openPopup()` from the
SW (needs a focused normal window), then `RawCdp.attach(port,'/popup.html')`
(Playwright can't attach a Page to that target). Drive with
`Input.dispatchMouseEvent` press → paced `mouseMoved` (60ms apart) → release on a
grip — Chrome turns that into a native drag AND reproduces the abort. Read
`globalThis.__tmDndLog` (ring buffer added to `dndDebugLog`) back with one
`Runtime.evaluate`. Asserts `committed {undoable:true}` + the IDB structure
changed, for tab / window / group drags. All three green post-fix
(`dropEffect:'move'`, drop fires, ~700ms drags).

## Healthy stage sequence (real popup)
`html5:dragstart → onDragStart → onDragOver:first → html5:drop → html5:dragend
{dropEffect:'move'} → onDragEnd → committed {undoable:true}`. `onDragOver:first`'s
`over` is the SOURCE (dragover throttled); the real target comes from the
`html5:drop`/`dragend` coords. (ESLint was broken repo-wide at the time, `minimatch@3.1.5`; since fixed.)

## Follow-up round (drag visuals + drop-zone + flicker), all CDP-verified in the real popup
- **Drag visual = a custom imperative ghost CARD**, positioned by a
  `requestAnimationFrame` loop writing `style.transform` directly (NO React state).
  Measured popup event rates: `drag` ≈ 24 Hz, `dragover` ≈ 15 Hz, coords advance
  smoothly (~5px/event, occasional 90-220ms stalls). The OLD jank was the
  per-`dragover` React `useState` reconcile, NOT the rate. So: `Html5DragSensor`
  builds a compact card (favicon+title / "{name}·N tabs" / "{name}") from the
  dragged row's DOM on `dragstart`, appends it to `#tm-dnd-aux-host`
  (`@/lib/dndGhostHost` — a `<body>` sibling of `#root` created EAGERLY at module
  load so nothing is added to `<body>` mid-session; never a grip ancestor), and a
  rAF loop reads `this.coord` (updated by document-capture `drag` + `dragover`)
  and repaints the card at display rate. Removed on end/cancel. Native drag image
  hidden with a 1×1 transparent canvas. CDP-measured: ghost tracks the cursor
  within ~2px, moves through ~54 distinct positions/sec, zero `html5:mutation` on
  grip ancestors. `<DndGhost>`/`DndOverlayCard` (React) DELETED from `DndProvider.tsx`.
- **No mid-drag movement at all**: `noSortAnimation` (`@/lib/dndSortingStrategy`,
  `() => null`) replaces `verticalListSortingStrategy` in ALL 3 `SortableContext`s.
  Combined with the already-removed reflow, nothing shifts until the drop repaints
  the new order. Kills the post-drop flicker.
- **Deferred `onEnd` is now `requestAnimationFrame`, not `setTimeout(0)`** — rAF
  runs after React's post-event flush (dnd-kit's `scrollAdjustedTranslate` ready)
  but BEFORE paint, so `onDragEnd`'s `setQueryData(next)` + `reset()` land in the
  same paint as the drop. `onDragEnd` also does `setQueryData` + `reset()` BEFORE
  the awaited `saveGroupsState` (auto-batched → one commit). Measured
  drop→committed gap ≈ 15ms, DOM order == committed order next frame.
- **Group can't drop above "Now Open"**: `unifiedCollision` `sameTypeOnly` for
  `activeType === 'group'` filters out `d.index === 0` AND does NOT fall back to
  the unfiltered hits (empty result = "no target here", so no `isOver` ring on
  Now Open). `dndMove.canDrop`/`moveGroup` already clamp `index ≤ 0 → NOOP`.
- **"New window" drop zone** (`NewWindowDropZone` in `Windows/index.tsx`):
  ALWAYS mounted (unmounting mid-drag = abort), `invisible pointer-events-none`
  unless `dnd.active?.type === 'tab'`, `useDroppable({ disabled: !activeForTab })`.
  It sits AFTER the windows `SortableContext` → not an ancestor of any tab grip,
  so toggling its visibility / `isOver` class is safe. Droppable id
  `${group.id}${NEW_WINDOW_SUFFIX}` (`'::new-window'`, exported from
  `useDndHandlers`). `dndMove`: new `DndRefType` `'new-window'` (drop-only,
  carries `groupIndex` on the ref), `resolveTabDest` → `createdWindow:true` at the
  group's LAST window. `onDragEnd`/`onDragOver` special-case the suffix (not a
  model node) incl. a throttled-`drop` (`e.over===null`) fallback via
  `lastRealOverRef`.
- **Window drag doesn't collapse tabs**: there was no `isDragging` collapse in
  `Window.tsx`; the "summary" was the old `DndOverlayCard` window card
  (`"{name} · N tabs"`). Gone now — the drag image is the full cloned window row
  (`height: min(rect.height, 440)`, not a hard 320 clamp).
- **Cross-group tab drop** was already correct in `dndMove.moveTab`; CDP-verified
  it writes both groups to IDB in the same drop.
- Harness `popupRealDnd.repro.ts` now has 7 tests (tab/window/group basics +
  item 2 / 3 / 4 / 6), all green against the real popup target.

## Reinstating `verticalListSortingStrategy` (classic sibling-slide reflow)
The earlier "kill the flicker" round replaced `verticalListSortingStrategy` with
`noSortAnimation` (`() => null`) in all 3 `SortableContext`s. That was WRONG scope
— it also killed the sibling-slide preview the user wanted. The two things are
independent:
- **DATA-model reflow** (`overrideState` mutating the actual `GroupsState` array
  mid-drag in `onDragOver`) — stays REMOVED, permanently. That's what caused the
  "Maximum update depth exceeded" infinite loop (reflow moves DOM → moves what's
  under the pointer → re-fires `onDragOver` → reflows again). Commit-on-drop
  against the pre-drag snapshot is unaffected by anything below.
- **dnd-kit's CSS-transform-only sort preview** (`verticalListSortingStrategy`)
  — safe to keep on. It only writes inline `style.transform`/`transition` onto
  SIBLING rows from the live `active`/`over` state already flowing through
  `DndContext`; it never touches the data array, never forces a layout
  re-measure (transform is compositor-only), and produces ZERO childList
  mutations (only attribute/style — "contributory not hard-abort", already fine).
  `noSortAnimation` deleted (`src/lib/dndSortingStrategy.ts`), reverted to
  `verticalListSortingStrategy` in `Window.tsx` (tabs), `Windows/index.tsx`
  (windows), `SidePanel/index.tsx` (groups).
- Real-popup CDP proof (new test in `popupRealDnd.repro.ts`, "reinstated
  verticalListSortingStrategy"): sampled `style.transform` on sibling rows across
  a slow drag — `translate3d(0,0,0)` → one sibling shifts to `translate3d(0,-24px,0)`
  as the dragged row passes it → both later siblings shift once the drag passes
  both (3 distinct snapshots across 5 samples = genuinely live, not one-shot).
  Zero `html5:mutation` childList entries, `#root` stays mounted, no "Maximum
  update depth exceeded" in console/page errors, and drop settles with DOM order
  exactly matching IDB (no flicker — the transform preview already showed the
  final slot, so the commit just removes the transforms with nothing to
  reconcile). Item 3's new-window zone (outside every `SortableContext`) and
  item 6 (window drag / no collapse) both still green.
- Unit regression guards added: `sidePanelUnifiedDnd.test.tsx` and
  `unifiedDnd.test.tsx` now `importOriginal()` `@dnd-kit/sortable` in their mocks
  (keeping the REAL `verticalListSortingStrategy` export) and capture the
  `strategy` prop passed to each mocked `SortableContext`, asserting it's
  reference-equal to the real function — catches a silent revert to a no-op.

## Ghost rendered as an invisible/near-blank box — screenshot caught what property reads couldn't
Prior round "proved" the ghost worked by reading `style.transform` over time via
CDP — that only proves position updates, NOT that anything is actually visible.
User reported "a small grey dotted box" instead of a real card. **A real
`Page.captureScreenshot` mid-drag (saved to a file, then actually opened with the
Read tool) was required to catch this** — computed-style property reads alone
looked plausible enough to miss it.

**Root cause:** `globals.css`'s shadcn tokens (`--card`, `--card-foreground`,
`--border`) are BARE HSL TRIPLETS (e.g. `--card: 0 0% 100%`), designed to be
consumed as `hsl(var(--card))` (see `@theme inline` in that file). The ghost's
`makeGhostCard()` used them directly — `background: 'var(--card, #fff)'`. This is
**invalid CSS**: `var(--card, #fff)` only falls back to `#fff` when `--card` is
UNDEFINED; since it IS defined (to an invalid-for-this-property value), the
declaration fails at computed-value time and resolves to the property's INITIAL
value instead — `background-color: transparent`, `border-style: none` (shorthand
`border: 1px solid var(--border,...)` failing resets ALL border sub-properties).
Confirmed via `getComputedStyle`: `backgroundColor: rgba(0,0,0,0)`, `borderStyle:
none`, `color: rgb(250,250,250)` (near-white, inherited from the dark-mode
`<html class="dark">` ancestor since the aux host is a body sibling, outside
`#root`'s own scoping). Net visual: near-white text + a soft box-shadow with NO
card frame at all, floating over a dark popup — visually reads as nothing/a
faint smudge, and combined with the seed data's fake favicon URLs 404ing (no
`onerror` fallback was wired on the ghost's `<img>`, unlike `Tab.tsx`'s own
`FALLBACK_FAVICON`), the only clearly-visible thing was the small broken-image
icon — exactly "a small grey box."

**Fix:** `ghostPalette()` — hardcode LITERAL hex colors (computed from the same
HSL values: light `#ffffff`/`#09090b`/`#e4e4e7`, dark `#09090b`/`#fafafa`/
`#27272a`), chosen once via `document.documentElement.classList.contains('dark')`
(the actual element `.dark` is toggled on, per `src/lib/theme.ts` — a genuine
ancestor of the aux host, so the CHECK is reliable even though direct CSS-var
consumption wasn't). Added an `img.onerror` fallback to a local
`GHOST_FALLBACK_FAVICON` SVG data URI (mirrors `Tab.tsx`'s `FALLBACK_FAVICON`).
Verified before/after via saved PNG screenshots (`e2e/test-results/repro/ghost-
mid-drag*.png`) — before: card invisible, only a faint doubled-text smudge +
broken-favicon box near the cursor; after: a clean dark card (bg `#09090b`,
border `#27272a`, text `#fafafa`) with the (correctly-falling-back) placeholder
favicon + title, clearly legible next to the cursor.

**Lesson:** for any future "does this actually look right" question, take a real
screenshot and open it — a property read (`style.transform`, `getComputedStyle`)
proves the DOM state changed, not that a human can see it. This is also the
`var(--x, fallback)` gotcha worth remembering generally: the fallback ONLY
covers "undefined", never "defined but invalid for this property."

## CRITICAL: a stray `wxt` dev server silently clobbers `.output/chrome-mv3-dev`
After TWO rounds of the user reporting "still showing the wrong ghost" despite
screenshot-verified fixes, found the real culprit: a `node .../wxt/bin/wxt.mjs`
process (spawned via `cmd /c wxt`, i.e. a `wxt`/dev-server invocation from
earlier in the session or another terminal) had been running the ENTIRE TIME,
listening on `localhost:3001`. WXT's dev/serve mode writes to the SAME
mode-suffixed output dir as `wxt build --mode development`
(`.output/chrome-mv3-dev`) — see [[learnings_seed_dev_manual_tool]]. Whenever
that live process touches the directory again (on its own watch cycle, unrelated
to my `build:dev` calls), it silently overwrites my standalone build's
`popup.html` back to the HMR-relative version:
`<script type="module" src="http://localhost:3001/src/entrypoints/popup/main.tsx">`
— a ~8KB "just the Vite/HMR client bootstrap" chunk instead of the real ~1.4MB
bundled app. **This directory depending on a live dev server to render at all is
itself the bug**, independent of whether that server happens to be reachable at
any given moment — the extension the user is told to load from
`.output/chrome-mv3-dev` is not what `build:dev` says it built moments earlier.

**How this was caught:** grepped the compiled bundle for fix-specific literal
strings (`ghostPalette`'s hex values, `drag-ghost`, `tm-dnd-aux-host`) — found
NONE, and the "popup" chunk was 8KB instead of ~1.4MB. `cat popup.html` showed
the `localhost:3001` script tags. `netstat -ano | grep 3001` + `wmic process ...
get CommandLine` identified the live `wxt` process.

**Fix applied:** killed the stray process, `rm -rf .output/chrome-mv3-dev`, fresh
`build:dev`, then verified (a) `grep -c localhost popup.html` → 0, (b) fix
strings present in the chunk, (c) bundle size back to ~1.4MB, (d) port 3001 free,
BEFORE re-running any verification. Re-ran the full `popupRealDnd.repro.ts` suite
+ fresh screenshots against this confirmed-standalone build.

**Lesson — verify the ARTIFACT, not just "the build command exited 0":** `wxt
build --mode development` exiting 0 and printing correct-looking chunk sizes at
that moment does NOT guarantee the directory still looks like that by the time a
test (or the user) loads it, if anything else is watching/writing that path
concurrently. Before trusting a `.output/chrome-mv3-dev` verification run again:
grep `popup.html` for `localhost` (must be absent) and confirm the popup chunk
size is the expected ~1.4MB, not a suspiciously small file. Also check
`netstat -ano | grep 3001` for a stray `wxt` dev server before every fresh
"prove it's fixed" pass in a long session — it can be started (by the user, in
another terminal, or a much earlier round) without ever appearing in this
agent's own command history.

**Item 7 — multi-item drag** (rbd multi-drag pattern) was done in its own later
pass, see `learnings_multi_drag_and_commit_rebase.md`.
