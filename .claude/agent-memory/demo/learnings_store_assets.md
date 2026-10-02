---
name: learnings-store-assets
description: How Chrome Web Store screenshots/promo tiles were derived from the existing Playwright+Remotion demo pipeline
metadata:
  type: project
---

Chrome Web Store listing assets (screenshots, small 440x280 and marquee 1400x560
promo tiles) are generated from the existing demo pipeline without adding ffmpeg
or an image library:

- Screenshots come from a direct Playwright `page.screenshot()` (packages/demo/screenshots.ts),
  not a frame-grab from the recorded .webm — Playwright can already capture stills,
  no ffmpeg/frame-extraction step needed.
- Composing the raw 780x600 popup screenshot onto the required 1280x800 canvas, and
  building the static promo tiles, both go through Remotion `renderStill`
  (`@remotion/bundler` + `@remotion/renderer`, added as devDeps) — this is Remotion's
  own documented pattern for one-off image rendering, not a new tool.
- All three asset types are rendered as JPEG (`imageFormat: "jpeg"`) specifically to
  sidestep the store's "24-bit PNG, no alpha channel" requirement — JPEG has no alpha
  channel by construction, so there's nothing to accidentally ship with transparency.
- CORRECTION (verified 2026-07-09 by actually running the pipeline): `staticFile()`
  does NOT support `../` traversal — it throws `TypeError: staticFile() does not
  support relative paths`. Composition.tsx's `staticFile("../recordings/...")` was
  never actually exercised end-to-end before (record.ts's steps are still
  waitForTimeout placeholders, so nobody had rendered the real video yet) — it will
  break the same way if `pnpm render` is ever run for real. Needs the same fix as
  below if that pipeline gets exercised.
- Fix for the above: don't point `publicDir` at the whole package root either —
  Remotion's bundler tries to copy/symlink the *entire* dir including
  `node_modules`, and on Windows `EPERM: symlink` kills the bundle (pnpm's
  node_modules are junction/symlink-based). Instead, in the render script, copy just
  the needed files (raw screenshots, `extension/src/assets/logo.png`) into
  `packages/demo/public/...` before calling `bundle()`, and reference them with
  plain (non-relative) `staticFile("screenshots/raw/x.png")` paths. See
  `render-store-assets.ts`.
- Extracted the extension-load + demo-mode-entry boilerplate out of record.ts into
  `packages/demo/lib/launchDemoContext.ts` so screenshots.ts doesn't duplicate it.
- Promo tile tagline copy is a placeholder ("TabMerger" + logo only) — no real
  marketing tagline was supplied; swap in `remotion/stills/PromoTile.tsx` before
  publishing.

## Pipeline had never actually been run end-to-end before 2026-07-09

Three latent bugs were found only by executing the pipeline for real, not by reading
the code — worth remembering because it means "looks right" isn't enough for this
package:

1. `remotion/Root.tsx` never called `registerRoot()` — `bundle()` fails immediately
   with "does not contain registerRoot" for every composition, including the ones
   used by `render-store-assets.ts`. Must be present for both `pnpm demo:render` and
   `pnpm demo:store-assets` to work at all.
2. `enterDemoMode()` (packages/extension/src/lib/demo.ts) closes every browser
   window except a freshly created one — including the `--app=` popup window that
   `launchDemoContext.ts`'s Playwright `page` object points at. Clicking the "Demo
   Mode" button therefore kills `page` out from under the caller
   (`Target page, context or browser has been closed`). Fix: wait for the page
   `close` event after clicking, then `context.newPage()` + `page.goto()` back to
   `chrome-extension://<id>/popup.html` to get a live handle again. See
   `launchDemoContext.ts`.
3. Launching a fresh persistent-context browser process with `--app=chrome-extension://<id>/popup.html`
   in the args sometimes races the extension's own registration and lands on
   `chrome-error://chromewebdata/` instead of the popup. A single
   `page.goto("chrome-extension://<id>/popup.html")` retry after `domcontentloaded`
   reliably recovers. Also in `launchDemoContext.ts`.

Net effect: `record.ts` (never run for real, still placeholder `waitForTimeout` per
step per its own TODO comment) almost certainly has the same #2/#3 issues since it
shares `launchDemoContext`, but is fixed now that the shared helper is fixed.

## `pnpm demo:render` — fixed 2026-07-09, verified by running it

Two more bugs, only found by actually running `record.ts` then `demo:render`:

4. Same `staticFile()` traversal issue as store-assets, this time for
   `Composition.tsx`'s `staticFile("../recordings/...")`. Fix: `record.ts` now
   writes into `packages/demo/public/recordings/` (not a `recordings/` sibling of
   `remotion/`), and `Composition.tsx` references `staticFile("recordings/...")`
   with no `../`.
5. Playwright's `recordVideo` names output files by internal GUID
   (`page@<hash>.webm`), one file per **page**, not per demoScript step — but
   `Composition.tsx` needs `${step.id}.webm`. `record.ts` previously ran the whole
   script on one continuous page, producing a single randomly-named video that
   never matched any expected filename. Fixed by giving each step its own
   `context.newPage()` (still within the same recordVideo-enabled context, so each
   page gets its own video), closing it after the step's wait and
   `fs.renameSync`-ing `video.path()` to `${step.id}.webm`. `launchDemoContext`'s
   own setup pages (Settings navigation, the page killed by `enterDemoMode`'s
   window reset) also land in this dir as unnamed videos — `record.ts` sweeps
   anything not matching a known step id after the loop.

Recordings are `.webm` only (Playwright has no mp4 recording option) — that's fine,
`OffthreadVideo` consumes webm directly and the final `demo:render` output is
already mp4 (`out/tabmerger-demo.mp4`), so nothing downstream needs the raw clips
transcoded.

## Screenshot content caveat — RESOLVED 2026-07-09

Superseded: `packages/demo/lib/actions.ts` now maps every `demo-script.ts` step to a
real Playwright interaction (shared by `record.ts` and `screenshots.ts` via
`runStepAction`) — no more `waitForTimeout`-only placeholders. Verified visually
(screenshots are no longer byte-identical; each shows the labeled action's actual
resulting UI state).

## uiStore is NOT persisted — every fresh `page` starts at defaults

Zustand `uiStore` (`activeGroupIndex`, `selectionMode`, undo stack) has no `persist`
middleware. `record.ts` gives each step its own `context.newPage()` (needed for
per-step `.webm` files, see above) — so action handlers in `actions.ts` cannot assume
a prior step's UI state (active group, selection mode) carries over. Each handler
must be self-contained: activate its own group, exit selection mode if it might be
on, generate its own undoable action before trying to undo it, etc.

## Radix + accessible-name gotchas hit while scripting real interactions

- `SelectTrigger` has no accessible name — the `Label` is a visual sibling, not
  `htmlFor`-linked. Locate via `getByRole("combobox").first()`, not `{ name: ... }`.
- Escape on a nested `Select` popover does NOT propagate to close an outer `Dialog`
  (Radix nested-portal quirk). Click the dialog's real `sr-only "Close"` button
  instead — matters a lot for `screenshots.ts`, which reuses one page across all
  steps, so a left-open dialog blocks every later click.
- `DropdownMenuSub` submenu items can transiently detach/reattach right after the
  submenu opens — add a short (~300ms) settle wait before clicking, don't just retry
  the click.
- Buttons with only a `Tooltip` (no `aria-label`) have no accessible name at all —
  locate structurally instead, e.g. `button:has(svg.lucide-star)`.
- `<button aria-label="...">` with no `role="checkbox"` override exposes ARIA role
  `"button"`, not `"checkbox"` — `getByRole("checkbox", ...)` will silently find
  nothing; use `getByRole("button", { name: ... })`.
- `pressSequentially(text, { delay })` (not `fill()`) when a recording needs to show
  typing actually happen on screen.

## Duplicate seed groups across runs — profile reuse + fresh nanoid()s

`demoData.ts` assigns fresh `nanoid()` ids on every extension load, and
`saveGroupsState()` `put()`s groups by id rather than replacing the whole IndexedDB
table. Reusing the same Playwright `USER_DATA_DIR` profile across multiple
`demo:record`/`demo:screenshots` runs therefore silently accumulates duplicate
groups instead of overwriting them (root cause of a user-reported "duplicated
groups" bug). Fix: `launchDemoContext()` now does
`fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })` at the very top, before
any browser launch, so every run starts from a genuinely clean profile.

## "Now Open" tab hygiene

- Modern Chrome's built-in New Tab Page resolves to `chrome://new-tab-page/`, not
  the older `chrome://newtab/` — match both (plus `about:blank`) when closing
  leftover blank tabs after `enterDemoMode()`'s window reset, or a stray
  faviconless "New Tab" entry survives into the recording.
- The extension's own popup tab must be filtered out of "Now Open" on the
  extension side (`useCurrentTabs.ts`, owned by extension-dev) — otherwise it shows
  up as a tab with a broken/missing favicon since users normally only see it as a
  popup, never a real tab.
- Seed "Now Open" with real, generic, non-PII sites (github.com,
  developer.mozilla.org, news.ycombinator.com) via `context.newPage()` +
  `page.goto()` in `launchDemoContext.ts` — gives the group real content and
  working favicons without depending on any account/personal data.

## Stale build cache can silently corrupt a WXT/Vite bundle

A rebuilt extension can fail at runtime with `require is not defined` even though
the source only uses ESM `import` — caused by a stale `.wxt` / `node_modules/.vite`
cache baking a CJS `require(...)` into the minified `popup-*.js` chunk. Not
reproducible by reading source; only shows up by actually loading the built
extension and reading `page.on("pageerror")`. Fix: `rm -rf .wxt node_modules/.vite
.output` in `packages/extension` before rebuilding, if a demo-mode build starts
failing on selectors that used to work with no source changes to explain it.

## Screenshot source resolution — `deviceScaleFactor` matters for store assets

`launchDemoContext()` defaulted to `deviceScaleFactor: 1`, so `screenshots.ts`'s raw
780x600 PNGs had only 780x600 physical pixels. `ScreenshotFrame.tsx`/`PromoTile.tsx`
composite/downscale those onto larger canvases (1280x800, 1400x560) via CSS, and a
1x-DPI source is what read as soft/low-res in the rendered store assets even though
there's no actual upscale in the CSS math — a higher-density source just resamples
sharper. Fix: `launchDemoContext()` now takes an optional `deviceScaleFactor` param
(default 1, unchanged for `record.ts`'s video capture — bigger backing buffer there is
pure cost for zero visual gain since the video Sequence plays at 780x600 1:1);
`screenshots.ts` passes `2`. If store/promo assets look muddy again, check this before
touching PromoTile.tsx's actual layout/design.

## Recorded-video transition claims need verifying against the actual code

Got a report that the dark-mode↔light-mode cut in the *rendered video* had a
"peaked/triangular" transition shape, presumably confused with `PromoTile.tsx`'s
sine-sampled "droop" seam (used for the marquee split promo tile, a **still image**,
not part of `Composition.tsx`/the video at all). Grepped the whole `packages/demo`
tree for `transition|wipe|crossfade|clip-path` — the only hit is in `PromoTile.tsx`.
`Composition.tsx` has no transition logic whatsoever between `Sequence`s (hard cuts
only). Lesson: when a report describes a *shape* (peak, curve, wipe) in the video,
grep for that shape's implementation before touching anything — don't assume the
report is accurate just because it's specific. If no such code exists, say so instead
of inventing a fix for a problem that isn't there.

## Demo scripting must track upstream extension UI changes, not just add around them

When "Change color" was removed from the group's right-click dropdown
(`GroupContextMenu.tsx`, an explicit product decision, implemented by
`extension-dev`), the color-change *feature* wasn't gone — it just moved to the
small color-swatch dot already rendered on each `GroupItem.tsx` sidebar row (a
`Popover`+`ColorPicker` independent of the context menu). Before assuming a demo step
needs deleting because its entry point vanished, check whether the same user-facing
capability still exists somewhere else in the component tree — `grep` for the hook
(`useUpdateGroupColor`) or component (`ColorPicker`) it depends on across all callers,
not just the file that changed.

## Chained clicks need a settle pause even when each locator individually resolves fine

`screenshots.ts` reuses one `page` across all steps sequentially (unlike `record.ts`,
which gives each step a fresh page) — this surfaces timing races that a fresh-page
recording won't: a right-click immediately following a left-click on the same element
intermittently failed with "`<html>` intercepts pointer events" (a prior step's
Popover/Dialog overlay still animating shut). Any action handler with 2+ sequential
clicks should have a short `waitForTimeout` (200-400ms) between them, not just at the
very end — cheap insurance, and it's what actually fixed the `screenshots.ts` failure
here (root cause was the missing gap, not the selectors, which were already correct).

## Verify search demo queries actually match seed data

`searchTabs`'s original query ("react") happened to match a real tab title by
coincidence (`demoData.ts`'s Research group has "React Docs — useEffect"), but that
was never checked when the step was written — an easy way to accidentally demo an
empty results list. Also worth showing the `in:"Group Name"` scoped-search syntax
(see `parseSearchQuery` in `packages/extension/src/lib/utils.ts`, hinted at in the
Header's search placeholder) instead of a bare keyword — it's a real feature that a
plain keyword search doesn't demonstrate at all.

## Screenshot artifacts can leak from an earlier step's real mouse hover

`screenshots.ts` reuses one `page` across the whole run (see "Chained clicks" above)
— this also means the OS-level cursor position from an earlier step's genuine
interaction (e.g. `dragTabBetweenGroups` hovering a tab to drag it) is still sitting
there when a much later, unrelated step takes its screenshot, and can trigger that
tab's hover-preview tooltip in the captured image. Fix: `page.mouse.move(0, 0)` +
short settle wait immediately before every `page.screenshot()` call, not just the
last one — cheap and eliminates a whole class of "why is there a random tooltip in
this screenshot" reports.

## Pairing two screenshots of the same underlying app state reads as "one duplicated window," not "two scenes"

`PromoTile.tsx`'s marquee split originally paired `dark-mode` and `view-groups` —
both happened to be captured with the Research group active showing the identical
tab list, just re-themed. Split down the curvy seam, it visually read as one window
awkwardly mirrored in half rather than two distinct product scenes. Fix: pick two
screenshots with genuinely different foreground content (`dark-mode` = Research
group vs `open-popup` = Now Open group) so each side of the split reads as its own
scene. When designing any side-by-side/split composite from existing screenshots,
check what's actually *in* each shot, not just its theme/color — same-content shots
in different themes still look like a duplicate.

## A cropped/truncated note preview in a promo screenshot is app behavior, not a bug

Inspecting `small-tile.jpg` showed the Research group's note preview text
("Flights booked — check visa docs before Friday...") ellipsis-truncated near the
top edge, alongside a "temp window" entry (1 Gmail tab). Before treating this as a
compositing bug, read the raw source screenshot
(`packages/demo/screenshots/raw/dark-mode.png`) directly — it confirmed both are
genuine, correct product state carried over from earlier demo-script steps
(`dragTabBetweenGroups` created the second window, `addGroupNote` added the note;
the app itself truncates long note previews with an ellipsis in the header). No
extension-side fix needed — this is exactly what the real UI looks like at that
point in the script, not an artifact introduced by the promo pipeline.

## Output-directory staleness

`screenshots.ts` and `render-store-assets.ts` used to write into their output dirs
without clearing them first — removing/renaming a `demo-script.ts` step left its old
`.png`/`.jpg` behind forever (`render-store-assets.ts` globs whatever's in
`screenshots/raw/`, not just current step ids). Both scripts now
`fs.rmSync(dir, { recursive: true, force: true })` + `mkdirSync` at the top before
writing anything.
