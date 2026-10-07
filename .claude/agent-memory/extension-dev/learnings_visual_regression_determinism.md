---
name: learnings-visual-regression-determinism
description: How the popup visual regression spec (e2e/tests/visual.spec.ts) is kept deterministic - frozen clock on extension pages, blocked network, theme seeding, seeding under the groups write lock, per-file fixture options, and the selector traps met while writing it
metadata:
  type: learning
---

Technique notes for `e2e/tests/visual.spec.ts`, `e2e/visualSeed.ts` and the fixture options it uses.

**Which build.** The spec pins the production-mode build through a per-file fixture option
(`test.use({ extensionPath: PRODUCTION_EXTENSION_PATH, blockNetwork: true })`), because the suite
default prefers `.output/chrome-mv3-dev` and the dev build renders differently (Settings "Dev" tab).
The path constant does no existence check at import time: Playwright imports every spec file even
when `--grep-invert` filters its tests out, so a throw at module scope would break `test:e2e` on a
machine that only has the dev build. The fixture checks the folder when a test actually uses it.

**Viewport.** The fixture launches its own persistent context, so `use.viewport` in
`playwright.config.ts` does not reach it. The spec calls `page.setViewportSize({800, 600})` itself.

**Frozen time.** `context.clock.setFixedTime(t)` before the first page is created works on
`chrome-extension://` pages: `Date.now()` is fixed while timers keep running, so React, TanStack
Query, Radix and the Now Open sync all behave normally. Freeze at an instant in the PAST: the faked
session in `signInAsPro` gets its `expires_at` from Node's real clock, and a frozen page time later
than that makes the session look expired. The service worker is not affected by the page clock.

**Network.** Two layers: `context.route(/^https?:\/\//, abort)` for pages (a `page.route` stub, as
registered by `signInAsPro`, still wins over a context route) and the `--host-resolver-rules`
launch flag for everything else, since Playwright does not route service worker requests. Without
this the single `about:blank` tab in Now Open fetches a favicon from Google's s2 service
(`getFaviconUrl` falls back to it when Chrome reports no favicon), and the popup posts analytics.
A failed favicon swaps to the inline fallback through `onError`, so "images ready" must wait for
`complete && naturalWidth > 0`, not just `complete`.

**Now Open.** In the test browser it is always one window with one `about:blank` tab: the app
strips its own popup page. Seed Now Open with no windows and wait for the sidebar badge `1 ◆ 1`.

**Theme.** Stored in the `appSettings` settings record (`theme`), with a copy in localStorage
(`tabmerger-theme`) that `theme-init.js` reads before React mounts. `useTheme` first applies
`system` (settings not loaded yet) and then the stored value, so seed both, emulate the matching
`colorScheme`, and poll the localStorage copy: `applyTheme` writes back the value it applied.
`activeGroupIndex` is also a settings record, so the active group can be seeded instead of clicked
(no hover or focus left behind).

**Seeding under the lock.** `seedIdb` now holds the app's groups write lock (Web Lock
`tabmerger-groups-write`) while it writes. The open popup rewrites the groups state by itself (Now
Open sync on mount and on every tab event) as a read-modify-write under that lock; an unlocked
seed landing between its read and its write is overwritten and every seeded group disappears.

**Reduced motion.** The spec emulates `prefers-reduced-motion: reduce`. A Radix popover is
positioned against its trigger's bounding box, and the group colour swatch scales on hover
(`hover:scale-125`, disabled by `motion-reduce:`). With motion on, the picker landed one pixel
apart between runs depending on how far the hover transition had run when the click measured the
trigger, and on whether floating-ui's layout-shift observer re-measured after the pointer left.
`animations: 'disabled'` in `toHaveScreenshot` does not help: the position was computed earlier.
Turning reduced motion on changed no other baseline. General rule: anything anchored to an element
with a hover transform needs the transform gone before the anchor is measured.

**Pointer and overlays.** After the last click, park the pointer on the header logo (no hover
style, no tooltip) and assert no `[data-sonner-toast]` and no `role=tooltip` before the shot.

**Selector traps.**
- A dialog that opens on load (encryption setup / unlock) hides the rest of the page from the
  accessibility tree: `getByRole('button', { name: 'Now Open' })` finds nothing. Use attribute
  locators (`[data-sidebar-group-index]`) for anything behind a dialog.
- `getByText('2 tabs selected')` matches the action bar AND the `sr-only` live-region announcer:
  pass `exact: true`.
- URL rules whose group does not exist are dropped when the popup loads, so a "(deleted group)" row
  cannot be seeded.
- The Settings title carries a version badge that changes every release: the spec pins its text
  before the shot.
- Pass Playwright flags right after the pnpm script name (`test:visual --update-snapshots`); with a
  `--` in between Playwright reads the flag as a file filter.

**Tolerance.** One `maxDiffPixelRatio` for the whole spec. Same-platform runs are pixel-identical,
so the value only needs to stay below the smallest change worth catching (a one-pixel move of a
full-height line is about 1,200 pixels at 800x600).
