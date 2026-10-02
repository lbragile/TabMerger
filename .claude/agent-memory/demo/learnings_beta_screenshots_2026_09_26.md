---
name: learnings-beta-screenshots-2026-09-26
description: Building packages/demo/beta-screenshots.ts for the beta tester guide — CDP webp capture resolution bug, demoData.ts direct-drive vs demoScript reuse, and two real product/docs discrepancies found along the way
metadata:
  type: project
---

Context: built `packages/demo/beta-screenshots.ts` (npm script `beta-shots`) to capture
popup screenshots for `packages/web/app/(marketing)/beta/page.tsx`'s TEST_AREAS, driving
the real `demoData.ts` seed groups directly (Work/Research/Shopping/Reading List + Now Open)
rather than the scripted demoScript storyboard — the beta guide needs real everyday
features (search, undo, archive, sessions, multi-select, drag, settings), not the one
"chaos → organized" walkthrough. `enterDemoMode()` (Settings > Dev > Enter) seeds
`demoData.ts` into IndexedDB immediately — no chaosHook/createGroup pipeline needed for
these shots, only for the 3 store-listing assets that specifically depend on a "Q4 Launch"
group (see below).

**CDP webp capture at deviceScaleFactor is silently ignored — use `clip.scale` instead.**
`launchDemoContext(undefined, 2, "light")`'s `deviceScaleFactor: 2` context option does
NOT propagate to `Page.captureScreenshot` under `--headless=new` — captured webp stayed a
flat 800×600 regardless. Confirmed via a manual WebP VP8X-chunk dimension read (the same
family of bug as demo-learnings' "headless recordVideo ignores deviceScaleFactor entirely").
Tried `Emulation.setDeviceMetricsOverride({deviceScaleFactor: 2, ...})` on the page's own
CDP session first — also had zero effect. What actually works: pass an explicit `clip` with
its own `scale` field directly on `Page.captureScreenshot` itself —
`clip: {x:0, y:0, width:800, height:600, scale:2}` reliably produces a real 1600×1200 image.
`clip.scale` is independent of any device-metrics state.

**CDP's own `Page.captureScreenshot` supports `format:"webp"` directly** — no sharp/cwebp/
ffmpeg dependency needed anywhere in this repo for one-off screenshot scripts. `quality`
(0-100) only applies to jpeg/webp. This is a much simpler path than screenshots.ts's
PNG-then-Remotion-composite pipeline when you just need standalone stills.

**Two product/docs discrepancies found while writing "realistic" screenshot steps**
(both since corrected in the beta page copy; the lesson is to script against the real code, not the docs):
1. `SearchOverlay.tsx`'s real `getResults()` filter is plain substring (`.includes()`), NOT
   `lib/utils.ts`'s `fuzzyMatch` (that helper exists but isn't wired into search). The beta
   page's own copy says search is fuzzy ("ghub" matching "GitHub" by letters-in-order) —
   that's false against the real code; "ghub" returns zero results. Had to use "hub" (a
   real substring) instead to get a non-empty screenshot.
2. Toggling "Show page images in previews" ON does NOT save instantly the way the same
   beta page's copy claims ("the switch itself saves right away, no confirmation dialog")
   — it opens a real "Turn on page images?" confirm dialog (Cancel/"Turn on" buttons) on
   top of Settings first. Screenshotting right after the switch click (before handling that
   dialog) captures the confirm dialog instead of the General tab — had to reorder: shoot
   the General tab BEFORE touching the switch, then separately click switch → "Turn on" →
   Save changes for the hover-preview-on attempt.

**`enterDemoMode()`'s seed groups have no archived group and no saved session** —
`demoData.ts` never sets `archived: true` anywhere and defines no `Session` records. A
screenshot of the sidebar's "Archived"/"Sessions" sections with real content requires
performing those actions in-script first (archive a group via its context menu's "Archive
group" item, save a session via the sidebar's "Save current session" button) — both
sections are collapsed by default (`useState(false)`).

**Hovering a tab row for `TabPreview`'s tooltip must target the TITLE `<span>`
specifically** (`Tab.tsx` ~line 644-652, wrapped directly in `TooltipTrigger`), not the
row's outer container or the drag-handle's parent — hovering the wrong element never opens
the Radix tooltip at all (no error, just nothing happens).

**Reused `getCdpMouse`/`naturalMouseMove`-style raw CDP dragging (from `lib/actions.ts`)
for drags this script needed that weren't already demoScript actions** — `[data-sidebar-
group-index]` filtered by group name text is the real droppable row for a tab-onto-sidebar-
group drop (matches `dragTabToSidebarGroup`'s own selector). A plain multi-step
`Input.dispatchMouseEvent` walk (10 intermediate points, no easing needed for a one-off
screenshot) is enough to register `dragover` on the target under `--headless=new` — the
easing/wobble in `naturalMouseMove` is cosmetic for video, not required for a still.

**Re-capturing the 3 existing store-listing assets** (`color-new-group`,
`cross-window-tab-drag`, `multi-window`) for consistency reused `runStepAction` +
`lib/actions.ts`'s real action names directly (`createGroup`, `colorNewGroup`,
`copyWindowToGroup`, `moveTabToNewWindow`, `crossWindowTabDrag` — all need to run in that
exact order since each depends on the previous step's state) plus the same "Research →
right-click → Split windows" sequence screenshots.ts's dark-only promo capture uses. Ran
this in a SEPARATE fresh `launchDemoContext` call (separate profile) from the main beta
screenshots, not chained onto the beta-data mutations (archived Shopping, deleted tab,
etc.) — keeps the group/tab state identical to what screenshots.ts itself would produce.

**Windows profile lock gotcha**: if a script run doesn't fully close its Chrome
`context.close()` (e.g. process killed/still running), the NEXT run's
`fs.rmSync(USER_DATA_DIR, {recursive:true, force:true})` throws `EPERM`/`EBUSY` — `force`
only suppresses "path doesn't exist", not a live lock. Find the orphan via
`wmic process where "name='chrome.exe'" get ProcessId,CommandLine` filtered to the exact
`--user-data-dir=...` path, then `taskkill //F //PID <parent-chrome-pid>` — killing the
main `--app=` process took its child processes (renderer/gpu/utility/crashpad) down with
it. Do NOT blindly kill all `chrome.exe` — a real interactive desktop can have the user's
own Chrome running simultaneously.
