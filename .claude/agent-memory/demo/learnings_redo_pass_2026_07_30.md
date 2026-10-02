---
name: learnings-redo-pass-2026-07-30
description: Root causes found while adding click ripples, fixing theme/rename bugs, and adding new demo steps (tab-preview real image, stale-tabs) in the full record+render redo
metadata:
  type: project
---

Full redo pass (2026-07-30) covering click indicators, theme correctness, rename spacing, search syntax,
tab-preview realism, and a new stale-tabs step. Several bugs only surfaced by actually running the
pipeline and screenshotting/inspecting real output — code review alone missed all of them.

1. **`appSettings.theme` in IndexedDB, not `localStorage`, is the real theme source of truth —
   the storageState/localStorage seed only wins the FIRST paint.** `useTheme.ts`'s mount-time
   `useEffect` unconditionally calls `applyTheme(settings?.theme ?? 'system')` on every popup load,
   reading from `useAppSettings()` (IndexedDB via `getSetting('appSettings', ...)`). A fresh profile
   has no saved `appSettings` row, so this resolves to `'system'` and immediately overwrites the
   pre-mount `.dark` class that `theme-init.js` set from `localStorage['tabmerger-theme']` — so the
   dark recording rendered light after one un-rendered frame, every time. **Fix:** actually drive the
   real Settings > General theme `<Select>` and click "Save changes" (`lib/launchDemoContext.ts`) so
   `appSettings.theme` is persisted to IndexedDB before recording starts — that's what `useTheme()`
   reads, and it holds because `record.ts` reuses one context/profile across every step. Note
   `SettingsModal`'s `handleSave` only persists on an explicit "Save changes" click — closing the
   dialog without it (which is what the old `enableDarkMode()` helper in `actions.ts`, used only by
   `screenshots.ts`, does) silently discards the draft. That helper may have the same latent bug —
   not touched in this pass since it's a still-screenshot flow, not video, but worth revisiting.

2. **Playwright `Locator`s re-resolve their FULL selector chain lazily on every call — storing one in
   a variable does NOT freeze it to a DOM node.** A `Locator` built from `getByText("Shopping")`, even
   assigned to a const, re-queries by that text every time you call `.click()`/`.locator()`/`.waitFor()`
   on it. Once React swaps the "Shopping" text node out for a rename `<input>` (conditional render),
   any later use of a locator rooted at that vanished text throws "element not visible" — even though
   you captured the reference before the swap. Fix: use `.elementHandle()` to get a real bound handle
   *before* the DOM change, then query relative to that handle (`handle.waitForSelector(...)`) — handles
   do stay bound to the actual node.

3. **The dropped-space rename bug was a genuine race, not a one-off flake fixed by "wait a bit longer
   after Control+A".** `GroupItem.tsx`'s own `useEffect` (fires when `isRenaming` flips true) does
   `setTimeout(() => { el.focus(); el.setSelectionRange(len, len); }, 50)` — i.e. 50ms AFTER the input
   already mounted and became clickable, the component focuses it itself and force-moves the caret to
   the END, unconditionally, discarding any selection made in between. A `waitForSelector` → `click()`
   → `Control+a` sequence routinely finishes well under 50ms, so our select-all would win, then the
   component's own delayed effect would immediately collapse it back to a caret at the end — right
   before typing started. Result: typed text got appended after the old name instead of replacing it,
   non-deterministically (whichever side finished last on a given run — this is why the first "fix"
   *looked* like it worked in one isolated test but reappeared on a later run). **Fix:** explicitly
   wait *longer than the component's own internal timer* (250ms, comfortably >50ms) after focusing the
   input and *before* doing our own `Control+a`, so ours always runs last. General lesson: when a
   component has ANY internal `setTimeout`-deferred focus/selection logic, a demo/e2e script racing it
   needs to explicitly out-wait that timer, not just add an arbitrary "settle" delay in the wrong place
   in the sequence — the delay has to be positioned relative to the component's timer, not just present
   somewhere.

4. **Verify claimed fixes with an actual screenshot/DOM read, not just "the code looks right now."**
   Twice in this pass, a fix that looked complete on code review (and even passed one isolated manual
   test) turned out to still be racy/broken on repeat runs. Cheap verification pattern used
   repeatedly: a disposable one-off `tsx` script that calls `launchDemoContext()` + `runStepAction()`
   directly (no `record.ts`/full pipeline), then `page.screenshot()` or `page.evaluate(() =>
   el.textContent)` to read real state — much faster than re-rendering full video to check one step.
   Always run it 2-3 times when the bug is timing-shaped, since a single pass can pass by luck.

5. **`GroupItem.tsx` truncates sidebar group names over 10 chars to `name.slice(0, 10) + "…"` in the
   ACTUAL rendered text — not CSS `text-overflow: ellipsis`.** `page.getByText("Reading List", {exact:
   true})` never matches groups with names longer than 10 chars; the real DOM text is literally
   `"Reading Li…"`. Any future action targeting a saved group with a name > 10 chars must match the
   truncated prefix (e.g. `getByText(/^Reading Li/)`), not the full name.

6. **`Tab.tsx` only fetches a real `ogImage` preview (via `chrome.tabs.sendMessage(GET_PAGE_META)` to
   content.ts) when `isLive` is true, which is only ever `true` for the "Now Open" group's tabs**
   (`TabPreview tab={tab} isLive={isNowOpen}`). Hovering a saved group's tab (Work/Research/etc.) always
   shows the "No preview" placeholder, even with `aiFeatures` on, since there's no live `tabId` to query.
   To actually demo the preview *image* feature (not just the empty-state), hover a "Now Open" tab
   instead — but `activeGroupIndex` is PERSISTED (`setActiveGroupIndex` calls `setSetting(...)`, unlike
   the rest of `uiStore`), and `record.ts` reuses one context/profile across all per-step pages, so a
   step that needs "Now Open" active must explicitly click it first — it will otherwise inherit
   whichever group the *previous* script step left active.

7. **`locator.hover()`'s actionability check can time out against a list that re-renders on its own
   cadence** (here: "Now Open"'s `useCurrentTabs` polling live browser tabs) — "element was detached
   from the DOM, retrying" loops for the full 30s default timeout even though the element is visually
   present and stable enough for a human. Bypass with `boundingBox()` + `page.mouse.move(x, y)` instead
   of `locator.hover()` when hovering something in a frequently-re-rendering list — that only needs the
   element to exist for a moment, not to stay stable through Playwright's whole hover-actionability
   window.

8. **Every per-step `context.newPage()` in `record.ts` starts `recordVideo` capture from an
   about:blank canvas before `goto()` resolves** — invisible for the light recording (white matches
   white) but a jarring white flash at the start of every dark-theme clip. Fixed by adding a
   `context.addInitScript` that paints `document.documentElement.style.backgroundColor` to the theme
   color immediately (synchronous, no dependency on the extension's own CSS having loaded) —
   `launchDemoContext.ts`'s existing addInitScript for the click-ripple overlay was the natural place to
   add a second one alongside it.

9. **Click indicators (ripple/dot at click coordinates) implemented via `context.addInitScript` +
   locator `boundingBox()`**, not by hooking Playwright's click internals — `window.__tmRipple(x, y)`
   injected once per page (context-wide init script persists across every `context.newPage()` call
   record.ts makes per step), called from `clickWithRipple()`/`dblclickWithRipple()` helpers in
   `actions.ts` right before the real `.click()`/`.dblclick()`. Simple CSS `@keyframes` pulse, no new
   dependency. This pattern (small helper wrapping every click site) is easy to retrofit onto an
   existing large `actions.ts` — just swap `.click(...)` → `clickWithRipple(locator, ...)`.

10. **`PRESET_COLORS[3]` (green) collided visually with `demoData.ts`'s seeded Shopping group color** —
    `changeGroupColor`'s hardcoded preset-grid index must be checked against every seeded group's real
    color (`packages/extension/src/lib/demoData.ts`), not picked arbitrarily; picked index 8 (pink)
    instead, which no seed group uses.

11. **To demo a feature that depends on data aging (stale tabs, `tab.savedAt` vs
    `staleThresholdDays`), seed the fixture data with an old timestamp rather than waiting on real
    wall-clock time** — delegated to `extension-dev` since `demoData.ts` lives under
    `packages/extension/`. `useCleanupSuggestions.ts`'s `MIN_STALE = 5` means you need at least 5 stale
    tabs across non-permanent groups for `CleanupSuggestionBanner` to render at all (the per-tab stale
    dot on `Tab.tsx` shows on any individual stale tab regardless of that threshold). The "Reading List"
    seed group conveniently already has exactly 5 tabs, so all 5 got `savedAt: Date.now() - 40 days`.

See also [[selectors_and_app_mode]], [[learnings_theme_pipeline_execution]].
