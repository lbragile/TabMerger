# Drag & Drop — Spec and Verification Guide (extension popup)

Status: living document. Last updated 2026-09-19, after fixing the spring-open cross-group WINDOW drop bug (C15, window→tab redirect).
Owner agent: `extension-dev`. Read this before touching any DnD code.

- **[BLOCKED]** — a requested behaviour a known constraint prevents.
- **[UNVERIFIED]** — only a human in headed Chrome can confirm.
- **[DECISION]** — an open product decision; the text describes the current behaviour.

---

## 1. Scope

Every drag and selection interaction in the popup (`packages/extension/src/entrypoints/popup/`):

- **Tab rows:** reorder within a window, across windows, across groups, into/out of Now Open.
- **Window rows:** reorder within a group, across groups, into/out of Now Open, including a group's **last** window.
- **Sidebar group rows:** reorder, **including multi-drag**.
- **Multi-item drag** of tabs, windows and groups (react-beautiful-dnd pattern).
- **Selection:** Ctrl/Cmd-click, Shift-click ranges, Shift+Space, Ctrl/Cmd+A, selection mode, click-away, overlay dismissal.
- **Drop zones:** "new window" (within a group) and "new group" (sidebar).
- **Keyboard and touch drags**, with screen-reader announcements and focus management.

Out of scope: drags on the web dashboard.

---

## 2. Hard environment constraints (read first)

| # | Constraint | Evidence | Consequence |
|---|---|---|---|
| C1 | **SUPERSEDED — the popup DOES deliver a pointer stream.** The original reading came from instrumentation that logged only the FIRST move and could not tell `pointercancel` from `pointerup`. | `path:pointer {movesSeen:4, dist:4}`, committed with no `html5:*` events. | The sensor is **dual-path** (§5): a fine-grained press takes the pointer path, a coarse one falls back to native. |
| C2 | **Native path only:** `dragover`/`drag` are throttled (~15 Hz / ~24 Hz, 100–220ms stalls); the popup paints nothing for ~210ms after `dragstart`. | Real-popup measurements. | Never depend on a steady stream; the drop target comes from the `drop`/`dragend` coordinates. |
| C3 | **Native path only:** `drop` fires only if every `dragenter`/`dragover` calls `preventDefault()` **and** sets `dropEffect='move'`. | `dragend {dropEffect:"none"}` with no `drop` until both were done. | Document capture listeners do both on every event. |
| C4 | **Native path only:** a layout mutation of the dragged row or its ancestors aborts the drag **only** inside the `dragstart` dispatch or a microtask queued from it. Attribute-only changes always survive. | `popupAbortWindow.repro.ts`, 82+ trials. | Defer visuals to the first rAF; never unmount a drop zone mid-drag, only hide it. |
| C5 | **Native path only:** the OS owns the cursor. | Confirmed. | **`grabbing` works on the pointer path** (`html[data-tm-dnd-grabbing]` + `!important`). On the native path the OS glyph is unavoidable. |
| C6 | `setDragImage(el)` silently ignores a **detached** non-`<img>`. | Log reads `{tagName:"IMG", complete:true, naturalWidth:1, isConnected:true}`. | Suppressed with a preloaded, decoded 1×1 transparent GIF `<img>` in `#tm-dnd-aux-host`. |
| **C7** | **Closing the ACTIVE tab of the popup's own window dismisses the popup.** Dragging out of Now Open is a **MOVE** (the real tabs close), so that one tab must never be closed while the popup is open. Tabs of any other window are safe to close, active or not: the popup watches only its own window's tab strip. | A real-popup test failed within 5s of the drop when actives were closed inline. | `runSideEffects` partitions via `chrome.tabs.query({active:true})` and `chrome.windows.getCurrent()` (the window containing the calling page — the anchor window for the toolbar popup, the tab's window when `popup.html` is opened as a tab): **only the active tab of the popup's own window is deferred** to the background worker over a `chrome.runtime.connect` port that closes it on `onDisconnect` (popup teardown); **every other tab closes immediately**, so a dragged window the popup is not attached to closes completely at the drop. **Fallback:** if the own window can't be identified (the call is missing or rejects, or it names a window that owns no active tab), every active tab is deferred. |
| C8 | No error boundary: an uncaught render/effect error unmounts everything. | The `measuring: Always` loop took the popup down. | `measuring.droppable.strategy` stays `BeforeDragging (1)`; drag-end code is defensive. |
| C9 | CDP screenshots can't see OS-composited things (native drag image, cursor); they **can** see in-page DOM. | Screenshots showed a correct ghost while a human tester saw the grey grip snapshot. | See §9 blind spots. |
| C10 | CDP key events never reach the **native drag loop**; keyboard drags have no native session, so CDP keys drive them fine. | Escape test: the drag continued and committed. | Native-drag Escape is human-only. |
| C11 | `useGroups` uses `staleTime: 0`, so any mounting component refetches; a read overlapping the drop's write would overwrite the committed cache. | Spring-open test: correct for 3 frames, then reverted ~150ms later. | Serialized groups writes; `getGroupsState` waits and re-reads (max 5). **Never `cancelQueries`**; every groups-key `invalidateQueries` passes `cancelRefetch:false`. |
| C12 | A focused new window doesn't dismiss the popup in *headless* Chrome. | Agent diagnostic. | Every DnD `windows.create` is `focused:false`; every `tabs.create` is `active:false`. |
| C13 | During a keyboard drag, ArrowLeft from a tab grip reaches its **window container** first; a second reaches the sidebar. | Real-popup keyboard case. | Keyboard-drag tests must step twice to reach the sidebar. |
| **C14** | For a discrete event, React flushes passive effects **inside its own root-container listener**, so a `document` listener added by that effect receives the very click that mounted it. | The click-away hook exited selection mode on the click that entered it. | Global dismiss listeners must arm on the **next macrotask**. Do not use an `Event.timeStamp` guard: jsdom's is epoch-based while Chrome's is time-origin based, so it is silently inert in tests. |
| **C15** | dnd-kit's own `over` **state** (not the collision result) is computed in a `useEffect` gated on `[overId]`, separately from `collisions` (computed inline during render). Right after a container-set change — `setActiveGroupIndex` swapping the windows panel to a sprung-open group — this can leave `over` resolved one render behind the live collision result for at least one drop. | `dndDebugLog` showed `unifiedCollision`'s own fallback branch (§6, window→tab redirect) never fired, yet `e.over` at drop was still a TAB nested in the correct destination window (`rawOverId` a tab id, not the window). Real-popup repro: `e2e/repro/popupRealDnd.repro.ts` "BUG REPRO variant" (~line 2345). | `onDragEnd` must re-derive the target from the **model**, never trust `over`/`over.data.current` alone, whenever the active type constrains what a valid target can be — see the window→tab redirect in `commitDrop` (`useDndHandlers.ts`). |

---

## 3. Architecture map

| File | Role |
|---|---|
| `src/components/dnd/DndProvider.tsx` | The single `<DndContext>`: `unifiedCollision`, `measuring`, `autoScroll`, announcements, `restoreFocus:false`. Exposes `{active, isDragging, gap}`. |
| `src/lib/dndPressTracker.ts` | Dual-path detection; publishes `path:pointer` / `path:native`. |
| `src/lib/dndHtml5Sensor.ts` | Native-path sensor, and drives the pointer path (capture, `preventDefault` on `dragstart`, `grabbing`). |
| `src/lib/dndDragVisuals.ts` | Ghost (row clone, stacked cards, top-left `+N`); collapse/restore rows. |
| `src/lib/dndMultiDrag.ts` | Live-drag selection registry, rows to collapse, `isDndDragLive()`. |
| `src/lib/dndInsertion.ts` | Insertion index from the dragged item's centre; returns rows to shift **and** the commit target. |
| `src/lib/dndRebase.ts` | `rebaseMove` (identity + occurrence rank + context check for duplicates), `isStructuralNoop`. |
| `src/lib/dndMove.ts` | Pure engine: `canDrop`, `applyMove`, `moveTabsMulti`, `moveWindowsMulti`, `moveGroupsMulti`, `moveToNewGroup`, `NEW_GROUP_ID`. Emits `{type:'tabs.remove', tabIds}` for Now Open moves. **No empty-window pruning.** |
| `src/lib/deferredTabClose.ts` | Hands the deferred tab id(s) — the active tab of the popup's own window — to the background worker over a `chrome.runtime.connect` port; closes them on `onDisconnect`. |
| `src/lib/dndAnnouncements.ts` | Announcement text incl. multi-group blocks and partial moves. |
| `src/lib/dndLiveRegion.ts` | App-owned assertive live region in `#tm-dnd-aux-host`. |
| `src/lib/dndFocus.ts` | Focus after a keyboard drop, by object identity. Grip-less window target is **`[data-window-header]`**. |
| `src/lib/selectionRange.ts` | Shift ranges for tabs, windows and groups. |
| `src/lib/selectionFocus.ts` | Moves focus out of selection controls before they unmount. |
| `src/hooks/useSelectionClickAway.ts` | Exits selection mode on a plain click outside a selection control. **Arms on the next macrotask** (C14). |
| `src/hooks/useCloseOnOverlayDismiss.ts` + `uiStore.overlayDismissNonce` | Closes open menus/pickers/editors when selection mode is entered. |
| `src/hooks/useRovingRow.ts` | One Tab stop per row; Left/Right/Home/End walk the row's controls. Inert during a drag. |
| `src/hooks/useKeyboardNav.ts` | Global keys; ignores everything while `isDndDragLive()` or `defaultPrevented`. |
| `src/lib/localDb.ts` | Serialized groups writes, write-generation re-read, shared empty-DB init. |
| `src/components/Windows/index.tsx` | Windows `SortableContext`; `NewWindowDropZone` as an absolute overlay. |
| `src/components/SidePanel/index.tsx` | Groups `SortableContext`; `NewGroupDropZone` — `dropZoneActive = (tab‖window drag) && !atGroupLimit`. `setNewGroupZoneGate(atLimit)` takes **no** `onBlocked` callback. |
| `src/components/Windows/Window.tsx` | Header is a single `role="toolbar"` stop (`aria-label="<title> controls"`); grip pinned `tabIndex={-1}` after the dnd-kit spread. |

---

## 4. Data model and ids

- **group:** `group.id` · **window:** `${groupId}::w${i}` · **tab:** `${groupId}::w${i}::t${j}`
- **new-window zone:** `${groupId}::new-window` · **new-group zone:** `::new-group` (fixed sentinel, resolved without a model lookup)

**Rebase identity:** tab = `url` + `savedAt` + `customTitle` + `title` + `note` + `pinned` + `reminder.fireAt`; window = `name` + `starred` + `note` + per-tab identities; live Now Open items by real `id`; groups by `group.id`.

**Constants trap:** `packages/extension/src/lib/types.ts` **redefines** `DEFAULT_GROUP_TITLE` (`'temp group'`) and `DEFAULT_GROUP_COLOR`, shadowing `@tabmerger/shared`'s different values (`'New'`). `createGroup` (`src/lib/utils.ts`) imports the **local** ones, so a new group is named **"temp group"**. Always check which module a constant came from.

---

## 5. Lifecycle

1. **Press** → `dndPressTracker` watches for real `pointermove`s.
2. **Path decision (per drag):** pointer path (capture, `preventDefault` the native `dragstart`, `grabbing`) or native path (synchronous `dataTransfer` setup, transparent drag image, capture listeners). Exactly one activation; `path:*` logged.
3. **First rAF:** ghost; collapse the source row **and every other visible selected row**; open the gap; group drags activate the dragged group.
4. **`onDragStart`:** snapshot the cache, resolve `active`, record `keyboard`, carry or clear the selection, set the live-drag flag **last**.
5. **Each move:** ghost; collision over virtual geometry; `dndInsertion` recomputes gap/target; `onDragOver` records `lastRealOverRef` and arms the 600ms spring-open (**never for keyboard drags**).
6. **End:** a final `onMove` from the event's own coordinates, then `scheduleEnd`.
7. **Drop frame (one paint):** `data-tm-dnd-instant` → notify dnd-kit inside `flushSync` → remove ghost, restore rows → clear the attribute.
8. **`onDragEnd`**, wrapped in `try/catch/finally { reset() }`:
   1. Resolve against the snapshot, then `canDrop`.
   2. `rebaseMove` onto the current cache; cancel if the item/target is gone, a duplicated identity was permuted, or a missing member may have been edited. Deleted members are excluded and reported via `removed`.
   3. `applyMove`; skip `isStructuralNoop`.
   4. `pushUndo(current)` when undoable.
   5. `const persist = saveGroupsState(next)` **before** the cache write.
   6. `setGroupsNow(next)`.
   7. Update the active index; remap the selection.
   8. `reset()` → `await persist` → `runSideEffects()`.
   9. **On failure:** `reset()` before `rollback()`; conditional on `cacheWritten` (no undo-pop or failure announce for an already-issued write, but still awaited).
   10. **Keyboard drops:** dnd-kit gets a token; `dndFocus` focuses the landed item by identity; the full outcome goes to the live region ~150ms later.
9. **Release in place** restores exactly; a non-contiguous selection gathers into a block **[DECISION]**.

`reset()` clears the live-drag flag and drag selection **first**; the unmount fallback is unconditional.

---

## 6. Behaviour rules

### Allowed targets
- **tab** → tab, window, group row, new-window zone, new-group zone
- **window** → window, group row, new-group zone — **including a group's last window**
- **group** → another non-permanent group row; multi-drag supported
- Rejected: mixed-type selections, a live Now Open item on the Now Open row, a selected item as its own target, any group block containing Now Open.

### Outcomes

| Drag | Result | Side effects | Undoable |
|---|---|---|---|
| Saved tab(s) → tab/window position | One contiguous block at the gap, original order | none | yes |
| Saved tab(s) → sidebar group row | One new last window in that group | none | yes |
| Saved tab(s) → new-window zone | One new last window | none | yes |
| Saved tab(s) → new-group zone | A new group holding one window with them | none | yes |
| Saved window(s) → window position / group row | Inserted at the gap / new last window(s), starred-first kept | none | yes |
| Saved window(s) → new-group zone | A new group holding them | none | yes |
| Group reorder (single or multi) | Contiguous block at the gap; **never index 0**; anchor stays active | none | yes |
| **Now Open tab(s)/window → saved group or new-group zone** | **MOVED.** Destination gains a detached copy (`id:0`, `savedAt`); the real tabs close | **`tabs.remove` — everything immediately, except the active tab of the popup's own window, which is deferred to popup teardown (C7)** | no |
| Now Open tab reorder within Now Open | Real tab(s) moved | `chrome.tabs.move` | no |
| Saved tab(s)/window(s) → Now Open row | Removed from sources; one new real window | `windows.create({focused:false})` | no |
| Saved tab → live Now Open tab/window | Removed from source; real tab opened there | `tabs.create({active:false})` | no |
| **Now Open tab(s) → Now Open's OWN new-window zone (2026-09-24, reverses the earlier "left out of scope")** | **REAL detach**, never a stored write (`next` is the same reference) | `tabs.detachToNewWindow` — `windows.create({tabId, focused:false})` then `tabs.move` for any further ids, order preserved | no |
| Saved tab(s) → Now Open's new-window zone | Removed from sources; one new real window (unchanged — this already worked via `resolveTabDest`'s `new-window` handling, just unreachable through the UI until the zone was rendered for `group.permanent`) | `windows.create({focused:false})` | no |

- **Emptied windows are KEPT.** No move ever prunes a window left with no tabs; it renders as an empty card, keeps its badges, stays a drop target, and accepts tabs dragged back in. `useGroups` agrees (`useDeleteTab` and both `useMoveTab` branches). Explicit bulk cleanups (`useDeduplicateTabs`, `useRemoveStaleTabs`, AI-apply) still prune — they are cleanups, not moves.
- **New-group zone at the free cap: HIDES.** `dropZoneActive = (tab‖window drag) && !atGroupLimit`; it renders exactly as when idle (`invisible`, `pointer-events-none`, `aria-hidden`, droppable disabled, still mounted per C4) and refuses silently. No toast. The Add Group button's own at-limit behaviour is unchanged.
- **New groups are named `"temp group"`** (the local `DEFAULT_GROUP_TITLE`, §4) and the zone does not open the rename input **[DECISION]**.

### 6.1 Multi-item ordering (normative)

Any move of more than one item — tabs, windows or groups — must follow these rules exactly. Getting this wrong produces "the block landed somewhere other than the gap", which is hard to spot because the common cases look right.

1. **Order by ORIGINAL position, never selection order.** The dragged set is sorted by its position in the model at drag start (sidebar order for groups; group → window → tab order for tabs). Click/selection order must never reach the commit — a `Set` or array in insertion order will silently produce click-order output.
2. **The anchor is an identity, not an index.** Express the target as *"immediately before item X"* or *"at the end of list L"*, where X is an item **not** in the dragged set. A raw numeric index into the pre-removal array is wrong the moment any dragged item sits above it — the classic off-by-N.
3. **Apply as remove-then-insert.** Remove every dragged item, then insert the whole block immediately before the anchor, preserving the block's relative order. Never splice items one at a time; each splice invalidates the indices of the rest.
4. **A normalisation sort must never be able to move the block.** Starred groups and starred windows are pinned to a zone, and re-running that sort after insertion can relocate or split the block. Therefore:
   - a drag may only target positions **within its own zone**;
   - a selection **spanning both zones is rejected** by `canDrop`, exactly like a mixed-type selection;
   - the gap is computed **within the zone**, so gap and commit agree by construction.
5. **Clamping shifts, never truncates.** Keeping a block out of index 0 (Now Open) moves the whole block down; it must never drop members or reorder them.
6. **gap == commit, always.** The position the user sees and the position committed come from the same computation (`dndInsertion`). If a later sort can change the outcome, rule 4 has been violated.

**How this is enforced:** a property test enumerates every subset selection against every valid anchor and compares the result to a reference `removeThenInsertBefore(anchor)` implementation, asserting the committed index equals the index the gap was drawn at. Example-based tests alone missed the zone-sort defect for months — the failing shapes were "selection mixes starred and unstarred" and "dropped into the other zone", while every same-zone case passed because `Array.prototype.filter` is stable.

### Invariants
- Now Open is never reordered, deleted, drag-activated, or undoable; nothing lands above it.
- **No DnD move ever produces a saved tab with a nonzero id**, and no `tabs.remove` ever names a zero/negative id (sweep test).
- Commits apply to the **current** cache, never the snapshot.
- `applyMove` is pure; chrome calls only in `runSideEffects`.
- A cross-group drop updates the source list, both badges and a visible destination **in one paint**, with no revert.
- **A window drag whose resolved target is a tab is redirected to that tab's own window, never bailed.** A window can only ever legally target a window or a group row (§6 Allowed targets), so a raw `over`/collision hit naming a TAB while dragging a window can only mean the pointer landed on one of the destination window's rows rather than empty card space — never a real "drop on a tab". Two layers apply this, independently, for defense in depth (C15): `unifiedCollision`'s `sameTypeOnly` redirects a lone tab hit to its own window container when no window/group hit exists at all; `commitDrop` (`useDndHandlers.ts`) redirects again from the **model** (`model.tabs[overId].windowId`) whenever the fully-resolved `over` is still a tab, which is what actually fixes the spring-open case (C15 — dnd-kit's `over` can lag the collision layer by a render). Both redirects are keyed off real model identity, never `over.data.current`, so they can only turn a wrongly-rejected drop into the right one.

---

## 7. Visual, keyboard and a11y spec

### Selection
- **Ctrl/Cmd+click** toggles and sets the Shift anchor; **Shift+click** / **Shift+Space** select a range; **Ctrl/Cmd+A** selects all in the panel, skipping filtered and locked tabs.
- **Entering selection mode closes any open overlay** — dropdowns, the group context menu, the colour picker, popovers, note/reminder editors — via `uiStore.overlayDismissNonce` + `useCloseOnOverlayDismiss`.
- **Exiting:** Escape, or **any plain left click outside a selection control**. Not on checkboxes, modifier/non-primary clicks, the `SelectionActionBar`, a live drag, menu triggers, menu/dialog/listbox/toast content, or the click that dismisses an open Radix menu. Focus is moved out of selection controls first. The listener **arms on the next macrotask** (C14).
- Selection mode shows the grip **and** checkbox on tab, window and group rows. Now Open has neither.

### Ghost, source rows and gap
A `cloneNode(true)` in `#tm-dnd-aux-host` (up to 2 stacked cards + top-left `+N`), positioned by a rAF loop within ~2px of the cursor. First-rAF collapse of the dragged row and all visible selected rows; a gap of the primary row's height opens at the insertion point. **Never hand-write token values** — a raw `var(--card)` is invalid and renders transparent.

### Drop zones
Both are absolute overlays over their "Add X" buttons, so layout is identical whether or not a drag is active and nothing is unmounted. The gap above "Add Window" is **8px**, matching "Add Group".

### Cursor
Pointer path: `grabbing`. Native path: OS-drawn (C5).

### Roving tabindex
Tab rows, sidebar group rows **and window headers** are each **one Tab stop**; Left/Right/Home/End walk the row's controls. The window header is a `role="toolbar"` with `aria-label="<title> controls"` — chosen because screen readers already describe toolbars as arrow-navigable, which is why **no `aria-describedby` hint** is added to tab/group rows (a shared hint would repeat on ~50 rows per Tab press, and rows are reached by Tab, not arrows). The grip needs an explicit `tabIndex={-1}` after the dnd-kit spread, since dnd-kit declares `tabIndex: 0` and React re-applies it.

### Contrast (light/dark)
Focus rings `ring-ring` **16.54 / 11.98**; tab row + grip on a selected row **15.90 / 11.85**; keyboard-lift ring **17.72 / 13.46**; group selection outline **14.46 / 14.02**; companion outline **17.86 / 16.77**; `+N` badge ~19:1.

### Focus
`restoreFocus:false`. After a keyboard drop, focus resolves **by object identity**: landed item → still-in-place source → nearest same-list sibling → sibling window → destination sidebar row. **Known limit:** focus cannot follow an **emptied** window — it no longer matches its own `before` identity and positional fallback is forbidden — so it goes to the sibling window.

### Reduced motion
`prefers-reduced-motion` disables row/list transitions, Radix animations, the switch thumb, the swatch hover scale, and smooth scrolling.

---

## 8. Never-do list

**Native path, inside `dragstart` / its microtask:** never mount/unmount inside `<DndContext>` or the grip's ancestor chain; never change layout, re-render the row subtree, or change the store selection synchronously (C4).

**Visuals/collision:** no live dnd-kit `transform` on a pointer-dragged row; no detached non-`<img>` drag image; never `measuring: Always`; no model-level mid-drag reflow; never let the gap and commit target diverge; never re-measure page rects mid-drag; never leave collapsed selected rows in the droppable map; no priming `onMove`; never use a raw `var(--token)` inline.

**Commit/persistence:** never tear down the ghost before the commit flushes; never `cancelQueries` on the groups query, and never `invalidateQueries` on the groups key without `cancelRefetch:false`; never commit from the snapshot alone; never `await` between issuing `saveGroupsState` and the cache write; never leave `onDragEnd` without `finally { reset() }`; never `rollback()` before `reset()`; never pop undo or announce failure for an already-issued write; never clear the live-drag flag late in `reset()`; never read/write groups outside `getGroupsState`/`saveGroupsState`.

**Side effects:** **never close the ACTIVE tab of the popup's own window while the popup is open** — defer it to the background port, and defer every active tab when the own window is unknown (C7); never `windows.remove` from DnD (it would also close tabs the drop never saved); always `focused:false` / `active:false`; never persist a DnD-produced saved tab with a nonzero id; never activate Now Open from a drag; **never prune an emptied window in a move**.

**Keyboard/a11y:** global key handlers check `isDndDragLive()` and `defaultPrevented`; never arm spring-open for a keyboard drag; never restore focus by positional slot; keep `restoreFocus:false`; grip selectors use `^=`; **arm global dismiss listeners on the next macrotask** (C14).

---

## 9. Testing strategy

| Layer | Run | Notes |
|---|---|---|
| Unit | `pnpm --filter @tabmerger/extension test` | **135 files / 1766 tests**; coverage **91.31 / 82.69 / 89.59 / 94.05** |
| Integration | `test:integration` | 13 passed, 4 skipped (Supabase self-skip) |
| Real-popup CDP | `repro:dnd` | **60 cases** in `popupRealDnd.repro.ts` (4 new: the spring-open window→tab BUG REPRO trio + a no-spring-open DIAGNOSTIC); plus `popupAbortWindow`, `dndMatrix`, `html5Diag`, `popupInstrumented` |
| **E2E** | `pnpm --filter @tabmerger/extension test:e2e` | **Runs locally — 38 passed.** Build `build:dev` first; the old "not runnable locally" note was wrong (the blank popup was the *production* build, whose placeholder `.env.production` makes supabase-js throw). `core.spec.ts:109` is flaky — it loads real github.com. |
| Audits | `sync-conflict-auditor`, `accessibility-auditor` | On commit-path and significant UI changes |

**Harness notes:** the headless popup is **670×510** — the `SelectionActionBar` (y≈578) and the panel's right-edge buttons (x≈764) are **unreachable**, and `elementFromPoint` returns `null` there, so a click would read as a *background* click and invert a test. `[data-window-index]` is **not unique** (tab row and window card) — use `.bg-card`. Group-row queries need `exact: true` (row and grip are both `role="button"` and the grip label embeds the group name); checkbox queries need scoping to `[role="listitem"]` (group rows and window headers now have checkboxes too). `[data-radix-popper-content-wrapper]` is shared with tooltips. `e2e/repro/harness.ts` needs a ~1500ms settle before seeding, or the popup's own empty-DB init races it and every seeded group is lost. The seeded `now-open` id is replaced by a fresh nanoid at boot. The screencast clock lags ~100ms; the 10-minute Bash cap forces chunking.

### Blind spots (human-only)
Native drag image and cursor (C9); **whether `grabbing` renders for a human and whether a hardware-mouse drag takes the pointer path** — all evidence is headless; native-drag Escape (C10); the true 800px layout; real screen-reader output; the new-group zone at the free cap (no free-tier fixture).

### Stale builds
`pnpm dev:extension` writes the same `.output/chrome-mv3-dev` as `build:dev` and swaps in a ~1KB `popup.html`. Before **and** after any verification: port 3001 free, no `localhost` in `popup.html`, chunk ~1.4MB. Whoever loads it must **Remove + Load unpacked**.

---

## 10. Manual verification (human, headed Chrome)

**Load:** no `pnpm dev:extension` running → `build:dev` → verify as in §9 → `chrome://extensions` → Remove → Load unpacked.

**Which path did my drag take?** `localStorage.setItem('tm_dnd_debug','1')`, reopen, drag; the chip shows `path:pointer` or `path:native`. Force with `tm_dnd_force_path`.

**Checklist**
- Pointer drags: ghost matches the row, source collapses, gap follows, no flash or revert, **cursor is `grabbing`**.
- **Now Open → saved group MOVES:** the copy lands and the real tabs close at the drop. A dragged window the popup is **not** attached to closes completely straight away. Dragging the window the popup **is** attached to closes every tab but its active one, which closes once you close the popup. The popup must never be dismissed by the drop.
- New-group zone appears for tab/window drags and creates a group; at the free cap it does not appear.
- Group multi-drag: Ctrl-click several, drag by a grip, block moves, never above Now Open.
- A group's last window can be dragged out; the emptied window and the emptied group both stay and stay usable.
- Selection: entering it closes any open menu/picker; a plain click anywhere outside a selection control exits.
- Keyboard: each row and window header is one Tab stop; Left/Right walk the controls; Space → ↓↓ → Space moves a row with focus following.
- Escape mid-drag **[UNVERIFIED] [DECISION]**.

---

## 11. Definition of done

- [ ] Unit tests + a regression guard for the bug class.
- [ ] Integration test if persistence changed; `sync-conflict-auditor` if the commit path or `localDb.ts` changed; `accessibility-auditor` after significant UI changes.
- [ ] A real-popup case for any user-visible change, against a **verified standalone build**.
- [ ] In-page visuals: a screenshot actually opened; sampling ≥300ms past the drop.
- [ ] OS-composited, hardware-input, Escape, focus, 800px or screen-reader behaviour: reported unverified with the human check.
- [ ] `tsc`, `vitest run`, `test:integration`, `build:dev`, both repro suites **and `test:e2e`** green.
- [ ] Coverage ≥80% on all four.
- [ ] Port 3001 free and bundle verified before reporting.

---

## 12. Known gaps, risks, decisions and doc debt

### Decisions pending
- **New-group naming:** groups are created as `"temp group"` with no rename prompt. Random/derived names were raised — a generator is easy, but `GroupItem.tsx:125` detects an unnamed group by comparing to the default literal, so it needs an explicit `autoNamed` flag or rename behaviour breaks quietly.
- **Escape on the native path:** the intended behaviour is a cancel. It can only be checked by a human in headed Chrome (C10).
- **Non-contiguous selection released in place** gathers into a block.

### Open work
- **Focus cannot follow an emptied window** after a keyboard drop (identity no longer matches); it lands on the sibling window.
- The `SelectionActionBar` click-away case and the toolbar's "More group options" menu are **unreachable in the headless popup** — unit-covered only.
- The new-group zone at the free cap is unit-covered only (no free-tier fixture).
- `core.spec.ts:109` is network-flaky (loads real github.com).
- Keyboard multi-drag visuals beyond the companion outline; multi-drag spring-open into another group's window list untested in the real popup.

### Risks
- Shift+Space on a checkbox relies on the synthesized click carrying `shiftKey` (true in Chromium; unverified in Firefox).

### Tooling
- `e2e/` isn't type-checked. `e2e/repro/seedData.ts` is in `.secretsignore`.

### Doc debt
- `e2e/repro/README.md` still says the bug was "fixed in `dndPointerSensor.ts`" and that repro runs "cannot prove the fix" — outdated.
- List semantics: `Tab.tsx` renders a fragment inside `role="list"`; the row is a focusable `listitem` with interactive children. Any role change must update the `[role="listitem"]` selectors in `dndHtml5Sensor.ts`, `dndDragVisuals.ts` and the repro's `ROW_BY_TITLE`.

---

## 13. History (why things are the way they are)

| Approach | Outcome |
|---|---|
| `closestCenter` fallback | Fixed drop resolution only; drags still never started. |
| `MouseSensor` / `setPointerCapture` sensors | Appeared never to activate — later shown to be a `pointercancel` artefact (C1). |
| Native HTML5 sensor | Made dragging work; aborted by `<DragOverlay>` mount, Add-button unmount and transform churn at pickup (C4). |
| Detached canvas / row-clone drag image | Silently ignored → grey grip box (C6). Now a decoded `<img>`. |
| React-state ghost → rAF direct-DOM ghost | Jank was the per-event reconcile, not the event rate. |
| Now Open drag-out emitting `tabs.remove` inline | Dismissed the popup (C7) → switched to a **copy** → **reversed again to a move**, with active tabs deferred to a background port → narrowed to the active tab of the popup's own window, so a dragged window closes at the drop. |
| `visibility:hidden` source slot | Looked like a duplicate; replaced by rAF-deferred collapse + `dndInsertion` gap. |
| Teardown before `onEnd` / default scheduler / row transitions | Old-order frame + slide; fixed with the instant attribute, `flushSync`, sync notify. |
| Cache write then `await saveGroupsState` | A mounting refetch reverted the drop (C11); fixed with the write queue. |
| `cancelQueries` / `invalidateQueries` defaults | Both reject mutations joined to the in-flight fetch. |
| Commit from the drag-start snapshot | Overwrote mid-drag updates and resurrected deleted groups; fixed with `dndRebase`. |
| Rebase by URL + nearest position | Moved the wrong duplicate; now identity + occurrence rank + a context check. |
| Checkbox replacing the grip | Selections couldn't be dragged — tabs, windows, then groups. Both are shown now. |
| Pruning emptied windows | **Reversed** — emptied windows are kept, and `useGroups` was aligned to match. |
| New-group zone show-then-warn at the cap | **Reversed** — it hides. |
| Click-away armed synchronously | React flushes passive effects inside its own root listener, so it exited on its own entering click (C14); now armed on the next macrotask. |
| "E2E not runnable locally" | Wrong — it was the production build being loaded. The suite runs; 38 pass. |
| Chased the spring-open cross-group window-drop bug at the geometry/measurement layer (missing `droppableRects` entry) | Real cause was **dnd-kit's own `over` state** lagging the collision result by a render (C15) — geometry was a red herring; a lone tab hit reaching `onDragEnd` untouched was reproducible either way, so the fix redirects at BOTH the collision layer and (the one that actually matters) `commitDrop`, from the model rather than from `over`. |
