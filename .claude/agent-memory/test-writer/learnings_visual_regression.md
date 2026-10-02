---
name: feedback-visual-regression
description: How visual regression tests (Playwright toHaveScreenshot) are wired in this repo, and the flakiness sources hit while building them
metadata:
  type: feedback
---

Visual regression uses Playwright's built-in `toHaveScreenshot()` only — no Percy/Chromatic/Storybook.
Web: `packages/web/e2e/visual.spec.ts`. Extension: `packages/extension/e2e/tests/visual.spec.ts`.
Both reuse the existing Playwright config/fixtures for their package (no separate config file).

**Separation from functional e2e**: visual tests are tagged `@visual` in the `describe` title, not put
in a separate file glob. `test:e2e` runs `--grep-invert @visual`, `test:visual` runs `--grep @visual`.
This lets visual specs live in the same `testDir`/config as functional e2e without a second Playwright
config, and keeps `pnpm test:e2e` fast/stable in CI while `test:visual` stays a separate, slower job.

**Baselines are NOT covered by the root-level `*.png` gitignore rule** — this repo blanket-ignores
`*.png` with `!` exceptions for `public/**`. Had to add
`!packages/web/e2e/**/*-snapshots/**/*.png` and `!packages/extension/e2e/**/*-snapshots/**/*.png` or
committed baselines silently never get tracked (git status shows nothing wrong, `git add` just no-ops).
Always `git check-ignore -v` a snapshot path after generating baselines to confirm it isn't swallowed.

**Video flakiness (packages/web/components/marketing/DemoVideo.tsx, an autoplay/loop/muted `<video>`)**:
1. `pause()` + `currentTime = 0` alone is not enough — if `readyState < 2` when you set `currentTime`,
   the seek is a no-op and the *previously playing* frame stays on screen, producing a different frame
   every run. Must wait for `loadeddata` before seeking, then wait for the `seeked` event before
   screenshotting.
2. Native `<video controls>` scrubber/timestamp UI is browser chrome, not app content — its thumb
   renders at a very slightly different subpixel position run to run and fails a `toHaveScreenshot`
   diff even with the frame otherwise pixel-identical. Fix: `video.controls = false` via `evaluate()`
   right before the screenshot (do this in a dedicated video-focused test, not by trying to mask a
   dynamic control region).
3. When a video is present elsewhere on a page you're also snapshotting whole-page (e.g. a hero
   section that embeds the same video), mask the whole `video` locator with `toHaveScreenshot`'s
   `mask` option rather than trying to make it stable in every context — give the video its own
   dedicated screenshot test instead.

**Theme seeding for visual tests**: this app (packages/web) uses a hand-rolled theme-provider that
reads `localStorage.getItem('theme')` synchronously in a `<head>` script before hydration (see
`app/layout.tsx`). Seed it with `page.addInitScript((t) => localStorage.setItem('theme', t), theme)`
registered *before* `page.goto()` — same pattern as `packages/demo/lib/launchDemoContext.ts` uses for
recording. Registering after navigation loses the race against the head script.

**Signed-in dashboard visual coverage**: runs only under the `authenticated` Playwright project
(`storageState: e2e/.auth/user.json`, minted by `e2e/auth.setup.ts`); the describe block in
`visual.spec.ts` skips itself under any other project. Never fake a signed-in state in a visual
test; use that project's real session.

**Verification protocol**: generate baselines with `--update-snapshots`, then rerun the SAME command
(no update flag) at least 2-3 times before considering a visual test done — a single clean rerun can
hide 1-in-3 flakiness (this happened with the video controls issue above, which passed once and then
failed on rerun 2 of 3).
