---
name: learnings-theme-pipeline-execution
description: What broke the first time the dark/light theme + crossfade pipeline was actually run end-to-end, and the fixes
metadata:
  type: project
---

The dark/light + crossfade pipeline (`record:dark/light`, `render:dark/light`) was written but never
executed before 2026-07-30. Running it for real surfaced several drift/bugs not caught by review:

1. **WXT's `-m demo` build outputs to `.output/chrome-mv3-demo`, not `.output/chrome-mv3`.**
   `lib/launchDemoContext.ts`'s `EXTENSION_PATH` is hardcoded to `.output/chrome-mv3` — the prior
   demo-agent memory claiming "same output path" was stale/wrong. Workaround used: after
   `pnpm --filter @tabmerger/extension build:extension:demo`, `rm -rf .output/chrome-mv3 && cp -r
   .output/chrome-mv3-demo .output/chrome-mv3` before recording. If this recurs, consider fixing
   `EXTENSION_PATH` to point at `chrome-mv3-demo` directly instead of copying. (Done since:
   `EXTENSION_PATH` now resolves `chrome-mv3-demo`, overridable via `TM_DEMO_EXT_DIR`.)

2. **Selector drift in `lib/launchDemoContext.ts` — Settings entry point moved.** Settings is no
   longer its own icon button; it's folded into the profile dropdown trigger
   (`aria-label="Settings menu"` signed-out / `"Account menu"` signed-in, `Header/index.tsx`
   ~line 305), with "Settings" as a `menuitem` inside the opened dropdown. Fixed the chain to:
   `getByRole('button', {name: /Settings menu|Account menu/})` → click →
   `getByRole('menuitem', {name: 'Settings'})` → click → then the Data tab as before.

3. **`enterDemoMode()` (`packages/extension/src/lib/demo.ts`) had NO UI entry point at all** —
   fully implemented + unit-tested, but never wired to a button. `git log -p -S "Demo Mode"` on
   `Settings.tsx` showed zero commits ever added it. Delegated to `extension-dev` to add a
   `VITE_DEMO_BUILD`/`DEV`-gated "Demo Mode" button in the Data tab calling `enterDemoMode()`. This
   is the kind of gap `demo`'s boundary rule exists for — don't patch extension code directly, but
   also don't assume a memory file's claimed "already fixed" state is still true; verify with grep/
   git log before trusting it.

4. **`lib/actions.ts` had two more stale selectors** found only by actually running steps in order:
   - `addGroupNote` clicked `getByText("Add/edit note", { exact: true })` — actual menu item text
     is "Add note" or "Edit note" (`GroupContextMenu.tsx`) depending on whether the group already
     has a note. Fixed to `getByText(/^(Add|Edit) note$/)`.
   - `searchTabs` tried to type directly into `getByPlaceholder(/search/i)` — the header search
     "bar" is actually a `<button aria-label="Open search">` showing placeholder-style text; the
     real `<input>` only exists once `SearchOverlay` is opened by clicking that button. Fixed to
     click `getByRole('button', {name: 'Open search'})` first.

   **Pattern:** every stale selector in this pass was a case where a UI element's *shape* changed
   (button → dropdown/menuitem, static text → conditional text, bare input → button-that-opens-an-
   overlay) rather than just wording. When `record.ts` fails mid-script, screenshot the exact step
   and read the real component before guessing at a text tweak.

5. **`remotion/Composition.tsx`'s manual crossfade `Fade` component threw at render time, not
   record time** — `interpolate()` requires a strictly-increasing `inputRange`, but the naive
   4-point range `[0, fadeIn?T:0, duration-(fadeOut?T:0), duration]` collapses to duplicate values
   whenever a step is first (`fadeIn=false` → points 0 and 0) or last (`fadeOut=false` and the
   fade-out-start lands exactly on `duration`). Both a plain non-fading first/last scene AND an
   ordinary interior scene where `durationInFrames` is small enough that `fadeOutStart` coincides
   with a prior breakpoint can trigger this. Fix: build the breakpoint array by only pushing points
   strictly greater than the last one pushed, rather than assuming exactly 4 fixed points. This is
   a general lesson for any hand-rolled Remotion `interpolate()` breakpoint list driven by
   conditional flags — always dedupe/guard, don't assume the flag combinations are safe.

6. **Debugging gotcha (environment, not code):** raw Windows-path string literals with single
   backslashes in a throwaway `.ts` debug script (e.g. `"C:\Users\...\pw-debug-data"`) silently
   lose their backslashes in JS — `\U`, `\A`, `\T` etc. aren't recognized escapes, so the backslash
   is dropped, not preserved. This produced mangled folders (e.g. `Users<name>AppDataLocal...`)
   relative to cwd when such a string was passed to `path.resolve`/`launchPersistentContext`. The
   real pipeline code doesn't do this (uses `path.resolve(__dirname, ...)` with forward slashes)
   — this only bit ad hoc debug scripts. Always use `path.resolve`/forward slashes even in
   throwaway Windows-path debug code, never raw backslash string literals.

See also [[selectors_and_app_mode]].
