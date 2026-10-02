---
name: keyboard-move-list-mode
description: Keyboard move mode key map v3 (wrap, group-list mode, Ctrl+Space select) and harness gotchas found while verifying it
metadata:
  type: project
---

Keyboard move mode now has two modes in `lib/keyboardMove.ts`: `main` (Up/Down walk shown-group slots, wrapping) and `list` (Left from main; Up/Down pick a group, which becomes the shown group; current target = END of the highlighted group; Right re-enters main). Group sources stay in `main` over the sidebar slots.

**Why:** this is the decided key map (2026-09-30). **How to apply:** do not reintroduce Left/Right group stepping or clamping.

- Now Open is a legitimate list stop for saved tabs (drop = opens in browser). Reaching "New group" from Work with Up takes TWO presses (Now Open first).
- Ctrl+Space lives in `lib/keyboardMoveEntry.ts` (`toggleSelectionOnCtrlSpace`), wired in Tab row+grip, Window header+grip, GroupItem grip + GroupContextMenu row (`selectGroupItem` prop). It announces via `announceDnd` ("Selected. 2 tabs selected."); SelectionAnnouncer's polite region also fires ("2 tabs selected."), assertive one wins.
- List-cursor ring is `data-tm-move-cursor` set/removed by the hook (CSS in globals.css), not React state.
- Several source files are CRLF (Tab.tsx, globals.css); scripted multi-line replaces must convert `\n` to `\r\n`. Bash heredocs containing backticks/quotes broke in this tool; use the Write tool for scripts.
- `Emulation.setDeviceMetricsOverride` is unsupported on the popup target; for a full 800x600 screenshot use `Page.captureScreenshot` with `captureBeyondViewport: true` and `clip: {x:0,y:0,width:800,height:600,scale:1}`.
- `e2e/kbdPopup.ts` `press()` now accepts `ctrl: true`.

## Always-visible moving copy (keyboard move)
- Place the docked ghost from LAYOUT rects (row rect minus its current translateY), not live rects: displaced rows animate ~200ms, so live rects put the copy in the wrong spot for 12 frames and `scrollIntoView` on a "before" row hides the gap above it. `lib/keyboardMoveDom.ts` owns dock rect + nearest-edge reveal across ALL scrollable ancestors (window tab list `max-h-52` is itself a scroller) + clamp.
- Empty window / window-append / lone-origin targets have no row marker: dock at the end of the list named by `gap.containerKey` (`data-tm-dnd-list` now carries the container key).
- Tab-row ghosts have no background: add `bg-card` or zone labels show through.
- Headless `chrome.action.openPopup` is capped ~670x510, so the 800px body scrolls sideways and fixed ghosts look offset. Layout checks: `KBD_AS_TAB=1` in `e2e/kbdPopup.ts` renders popup.html in a tab at exactly 800x600. Emulation.setDeviceMetricsOverride is unsupported on popup targets.
- The new-group stop is unreachable at the free group cap (>=5 saved groups): seed <=4 saved groups for walks that need it.
