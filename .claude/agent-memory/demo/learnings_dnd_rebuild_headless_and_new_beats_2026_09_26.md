---
name: learnings-dnd-rebuild-headless-and-new-beats-2026-09-26
description: Grip aria-label suffix break, new-window dropzone copy/testid drift, headless=new genuinely can't drive this popup's native drag, and how multi-select/cross-group drag beats were added and verified
metadata:
  type: project
---

Session: refreshed the promo/walkthrough video + store assets against the extension's
native-HTML5 DnD rebuild, added dedicated multi-select-drag and cross-group-drag
beats, and switched the recorder to headless by default (no visible Chrome windows
during a recording run).

## Selector drift from the DnD rebuild

- `Tab.tsx`'s drag grip aria-label grew a suffix: `"Drag to reorder tab"` →
  `"Drag to reorder tab: <tab title>"`. Every exact-match locator in `actions.ts`
  (`[aria-label="Drag to reorder tab"]`) silently matched ZERO elements after the
  rebuild — no error, just `boundingBox()` throwing later. Fixed to the `^=` prefix
  selector, the same pattern the extension's own `e2e/tests/popup-dnd.spec.ts` already
  uses. **Any future `aria-label` grip selector in this package should default to
  prefix match, never exact**, precisely because titles/suffixes get appended.
- `Windows/index.tsx`'s "new window" drop zone copy changed from
  `"Drop to create new window"` to `"Drop here for a new window"`, and it picked up a
  stable `data-testid="new-window-dropzone"` along the way. `moveTabToNewWindow`'s
  `getByText("Drop to create new window")` timed out on EVERY attempt (not
  intermittent — all 8 retry attempts failed identically, in both headed and headless
  runs), which is what actually revealed this wasn't a flake. Fixed to
  `getByTestId("new-window-dropzone")` — prefer test ids over copy for any zone whose
  text is directly product copy (more likely to get tuned by other agents than a
  structural id).
- **Lesson**: when a drag action fails identically on literally every retry attempt
  (`record.ts`'s built-in relaunch-and-resume loop), suspect a real selector/copy
  break in the extension, not sandbox flakiness — grep the current component for the
  literal string before assuming it's environmental. The existing retry loop is
  designed for genuine intermittent crashes, and it will burn all 8 attempts
  identically on a stale selector without ever succeeding.

## Headless (`--headless=new`) genuinely cannot drive this popup's drag

`lib/launchDemoContext.ts` now defaults headless (`--headless=new` raw CLI arg, with
Playwright's own `headless: false` so it doesn't inject a conflicting legacy flag —
same trick `e2e/fixtures.ts`/`popup-dnd.spec.ts` use for the extension's own e2e).
Opt-in headed via `TM_DEMO_HEADED=1` env var.

**Every step whose action performs a mouse-based drag failed 100% of attempts under
`--headless=new`**, specifically hanging on `getByText`/`getByTestId(dropzone)` never
becoming visible — i.e. the drag never even STARTS (the popup's dual pointer/native
sensor's `onDragStart` activator, `dndHtml5Sensor.ts`, never fires for Playwright's
synthetic `page.mouse.down/move` sequence in this Chrome mode). Re-ran the exact same
steps `TM_DEMO_HEADED=1` immediately after and every drag step succeeded first try —
so this is real, not a coincidence tied to the selector fix (the selector fix was
applied and verified independently under headed mode). The extension's OWN e2e DnD
spec (`popup-dnd.spec.ts`) sidesteps this entirely by never using Playwright's
`page.mouse` primitives for the drag itself — it drives the drag over **raw CDP**
(`RawCdp.drag`, dispatching `Input.dispatchMouseEvent` frames directly against the
popup's own debugger target) and only asserts via `cdp.evaluate`. `actions.ts`'s drag
helpers (`naturalMouseMove`, the down/move/up sequences in `moveTabToNewWindow`,
`crossWindowTabDrag`, `multiSelectTabDrag`, `dragTabToSidebarGroup`,
`dragTabBetweenGroups`) have NOT been ported to that pattern — porting them is the
real fix if fully-headless recording of drag beats is ever required; until then,
`TM_DEMO_HEADED=1` is load-bearing for any recording/screenshots run that touches a
drag step. All non-drag steps (renames, notes, color, popup open, etc.) recorded fine
headless.

## New beats: multi-select-drag / cross-group-drag

Decision: the promo/walkthrough SHOWCASES these two capabilities as their own beats,
not just exercising them incidentally:

- **multi-select-drag** — real multi-select is Ctrl/Cmd-click on the tab row text
  (`toggleSelection({type:'tab', id})`, `Tab.tsx` ~line 363-367), NOT
  `selectionMode`'s checkbox UI (a separate, exclusive selection surface — see the
  existing `toggleSelectionMode` action). Selected rows get a real
  `bg-primary/10 shadow-[inset...]` highlight; held it on screen 700ms before dragging
  so the pick reads as deliberate. Dragging by one selected row's grip carries every
  selected row (`dndMultiDrag.ts`'s live-drag registry) — confirmed visually via the
  "+1" stacked ghost badge in the recorded frame.
- **cross-group-drag** — by the DnD design's drop-outcome rules, "Saved tab(s) → sidebar
  group row" lands as a new LAST WINDOW in the target group (a real cross-group move,
  not a reorder). The droppable target is `[data-sidebar-group-index]` (rendered by
  `GroupContextMenu.tsx` around each `GroupItem`), not the group name text itself —
  filter by `.filter({has: getByText(name, {exact:true})})` to find the right one by
  name without hardcoding its numeric index (index shifts as groups get created
  earlier in the same script run).
- Both reuse `promoOnlySteps`'s `fromPromo()` sharing convention so the full
  walkthrough and the promo cut pull the identical recorded clip/duration — no
  separate recording pass needed per cut.
- **Verification method** (no system ffmpeg, and Playwright's bundled ffmpeg CANNOT
  open Remotion's rendered `.mp4` output at all — confirmed again this session, only
  the raw recorded `.webm` clips): used Playwright's bundled ffmpeg
  (`ms-playwright/ffmpeg-*/ffmpeg-win64.exe`, found via a plain filesystem search, NOT
  assumed to be on PATH) to grab a frame from each new `.webm` clip directly, AND used
  `remotion still remotion/Root.tsx <Composition> <out.png> --frame=<n>` to grab a
  frame from the actual rendered composition at an estimated cumulative-duration
  frame offset (sum each preceding step's `durationMs`, convert via `msToFrames`,
  subtract ~8 frames per crossfade transition already elapsed) — cheaper than
  rendering the whole video just to eyeball two beats, and it's the only way to
  inspect a specific moment of the FINAL composited/captioned output (crossfades,
  captions, zoom) rather than the raw source clip.

## Process-management gotchas (Windows / this sandbox)

- `pkill`/`kill` from git-bash do **not** touch real Windows `node.exe`/`chrome.exe`
  processes spawned by a detached `nohup ... &` — those are native Win32 processes,
  invisible to POSIX signal delivery from MSYS. Use `taskkill //F //IM node.exe //T`
  (and `chrome.exe`) instead when a background recording run needs to be killed.
- Manually killing Chrome/node mid-run while `record.ts`'s retry loop is active can
  corrupt its relaunch state (observed: it got stuck logging
  `attempt 2 crashed` → `relaunching (attempt 3/8)` in an infinite loop, never
  actually incrementing past 3, until the profile dir was wiped and the process
  fully killed and restarted clean). If a run needs to be aborted, kill everything
  AND `rm -rf .pw-user-data` before restarting, don't just let it "resume."
- A backgrounded `nohup ... &` launched via a plain (non-`run_in_background`) Bash
  call still returns control immediately in this harness (the shell line finishes
  once the subshell is spawned) — checking `tasklist` immediately after is a more
  reliable "is it actually running" signal than trusting the launcher command's own
  reported exit code.
