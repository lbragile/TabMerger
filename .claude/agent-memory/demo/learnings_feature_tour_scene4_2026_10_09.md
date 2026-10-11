---
name: learnings-feature-tour-scene4
description: Feature tour drag scene (scene 3) tooling - click-marker sync of drawn windows, timed captions, open-windows record, and how a drag of a Now Open window behaves while the popup is open
metadata:
  type: project
---

- To sync drawn elements to real clicks, the pointer hook (called by every click helper after the glide, ~120ms before the click) logs `performance.now()`; the frame grabber stamps frames with the same clock, so `frameAt(t, t0)` gives the footage frame. DOM waits (header text such as `2 Windows`) give "list changed" frames the same way.
- Footage frames are 1-based; scene frame = (footageFrame - 1) / playback speed.
- The tour layer shows a scene's caption using `frame - from` (content-local frame), not `frame - cut`: the scene content starts TRANSITION_FRAMES before the cut.
- Timed captions: registry `caption` may be `{from, text}[]`; text blanks for 6 frames centred on each change. Em dashes are avoided in new caption text.
- Which drawn windows are open per scene lives in `remotion/tour/openWindows.ts`; scenes must read it instead of assuming three windows.
- The grabber loop must swallow errors when the page goes away, otherwise a failed recording shows only an unhandled CDP rejection.
- Headless drags work together with the 2x frame grabber: `dragWindowToNewGroup` (raw CDP mouse) recorded sharp frames of the ghost card, the dashed "Drop for a new group" target (a `data-testid="new-group-dropzone"` overlay that only appears while a tab/window drag is live) and the drop.
- Dropping a Now Open window on the new-group target (docs/drag-and-drop-spec.md, Outcomes table): a group named "temp group" is created and selected (no rename input opens) and holds a copy of the window. Every dragged tab closes at the drop except the active tab of the window the TabMerger page itself is in (asked from the page via `chrome.windows.getCurrent()`); that one waits for the popup to close. For a window TabMerger is not in, the whole real window is gone a few hundred ms after release (measured 220-300ms). To make that match the story, the recorder moves the popup page into the third window with `chrome.tabs.move` and activates it.
- A group created by that drop needs an explicit rename gesture (double-click the row); `renameGroup` takes `pace.renameGroup = {from, to}` for this.
- Settings tabs in the demo build: General, Account, Data, Devices (non-free tier only), AI (only when AI features are on), Dev (demo or dev builds only).

## Recorder notes
- During a native drag the page gets `dragover` events, not `mousemove`: a DOM cursor must listen to both or it stays at the pick-up point. After a drag, tell the glide helper where the pointer really is (`glide.setPos`), or the next travel starts from the wrong place.
- Release at the right end of the drop target so the carried card's left edge clears the "Drop for a new group" label.
- Prove a window closed from the browser, not the footage: poll `chrome.windows.get(id)` from a second extension page and log `performance.now()` on the same clock as the frame grabber.
