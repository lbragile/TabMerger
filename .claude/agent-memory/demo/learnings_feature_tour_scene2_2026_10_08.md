---
name: learnings-feature-tour-scene2
description: Why the tour records its own popup clip, popup-as-truth for drawn tab titles, bot-wall titles, z-index and stale-card gotchas
metadata:
  type: project
---

- The shared `open-popup`/`chaos-hook` clips are stale against the current chaos list (4th seed window, 18 tabs, older titles). The tour records `tour-open-popup` itself via `record-tour.ts` (separate output dir, never `record.ts`, which wipes `public/recordings/`).
- The popup's real titles differ from a plain headless visit: Google Calendar redirects to a sign-in page, Slack reads just "Slack", X has no title (popup shows the host). `record-tour.ts` writes the popup's titles into `lib/chaosTabs.json` (`fromPopup: true`; `capture-tour-assets.ts` then leaves them alone).
- The third window's LinkedIn and X tabs were swapped for Dribbble and Flickr: the extension recorder got a Cloudflare wall for LinkedIn and an empty title for x.com (the popup then shows just the host), while a plain headless visit looked fine. Medium also passed plain headless but hit Cloudflare in the extension recorder, so candidate sites must be checked in BOTH (open them with `chrome.windows.create` from the recorder's setup page and read `chrome.tabs.query` titles after ~15s).
- Slow pages set their `<title>` late; a popup read too early shows the bare host. `record-tour.ts` waits for real titles, reloads the popup if a host-only title appears, and rejects the attempt otherwise.
- Captions live in the registry and are drawn once by `TourVideo` (blank text for 6 frames around each cut); the toolbar icon is on every drawn window in every scene so it cannot pop in during a cross-fade (the logo looks like a second star icon when it does).
- After `chaosHook`, the setup window still hosts the demo seed tabs, so close all other tabs in it. A stale 4th "Now Open" card sometimes lingers after load; a page reload clears it.
- Sweeping the cursor across popup rows pops TabPreview tooltips over the cards, so the tour footage has no cursor movement; motion comes from the Remotion overlay.
- CSS `z-index` must be an integer: fractional values are ignored and the element falls back to DOM order.
- Card rects are measured from the real DOM (nearest bordered ancestor of each "N tabs" label), stored in `lib/tourPopupLayout.json`.
