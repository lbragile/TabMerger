# Extension E2E test cases

Playwright suite in `packages/extension/e2e/tests/`, run via `pnpm --filter @tabmerger/extension test:e2e`.
Each file loads the real built extension in a persistent Chromium context — no mocking. Which build: the dev build
(`.output/chrome-mv3-dev`) when it exists, else the production build (`.output/chrome-mv3`, the only one CI has).
Set `TM_E2E_EXT_DIR=.output/chrome-mv3` to run locally against the production-mode build, and `TM_E2E_CPU_THROTTLE=4`
to slow the popup down like a busy CI runner (see `extensionPath.ts`).

**Reload/close rule:** a test that reloads, closes or reopens the popup after a UI action must first wait for the
change in IndexedDB with `waitForStoredGroup` / `waitForStoredGroups` (`helpers.ts`). The write is asynchronous and
the screen can show the change before it is stored, so neither the UI nor a fixed sleep is a valid wait.

## core.spec.ts — sidebar and basic invariants
- popup shows seeded groups in the sidebar
- Now Open is first in sidebar and has no delete option
- creating a new group adds it to the sidebar
- Now Open sidebar badge is visible
- dragging a sidebar group reorders it
- selection mode bulk delete then undo restores tabs
- right-click "Rename tab" allows renaming it (double-click no longer triggers rename)
- URL rule auto-assigns a new tab to the matching group

## groups.spec.ts — group management + DnD starring
- rename group via double-click — space bar works in input
- rename group — Cancel button restores original name
- rename group to empty string reverts to original name
- delete group without confirmOnDelete — immediate, no modal
- delete group with confirmOnDelete — modal appears and confirms deletion
- starring a group moves it above non-starred groups
- dropping a group above a starred group auto-stars the dragged group
- dropping a group below a non-starred group auto-unstars it

## windows.spec.ts — window management
- deleting a window removes it and its tabs
- delete window with confirmOnDelete — modal appears

## removeAllWindows.spec.ts — "Remove all windows" honours confirmOnDelete
- sidebar context menu and windows panel menu, confirmOnDelete on: dialog appears, Cancel keeps the windows
- sidebar context menu and windows panel menu, confirmOnDelete on: Confirm removes all windows
- confirmOnDelete off: removes immediately, no dialog

## tabs.spec.ts — tab management
- rename tab custom title — space bar works in input
- rename tab — Cancel button restores original title
- rename tab to empty string reverts to original title
- tab custom title persists after popup reload
- delete tab is always direct — no modal even when confirmOnDelete is on

## undo-redo.spec.ts
- undo after tab delete restores it, redo removes it again

## search.spec.ts
- search with space character filters correctly
- clearing search restores all tabs to full opacity

## selection.spec.ts
- entering selection mode shows tab checkboxes
- bulk delete selected tabs then undo restores them

## settings.spec.ts — Import / Export
- export produces a JSON file containing all group names

## settings.spec.ts — Import validation
- JSON backup: script URLs and malformed entries are left out, the rest is saved, the toast counts them
- bookmarks file: bookmarklets are left out and counted, ordinary bookmarks are saved
- a file with nothing importable shows the error toast and saves nothing

## misc.spec.ts — Notes
- group note text persists after popup reload

## persistence.spec.ts — a change survives the popup going away
- a colour change is on disk when the popup is destroyed the instant its write was handed to IndexedDB
  (the popup runs in an iframe that removes itself in the microtask after the write's last request)

## a11y.spec.ts — axe-core
- popup with seeded groups has no serious/critical a11y violations
- selection mode has no serious/critical a11y violations
- (`nested-interactive` rule disabled — known pre-existing pattern, see `extension-dev` learnings)

## tour.spec.ts — guided tour
First-install describe uses `test.use({ tour: 'pending' })`; every other spec's `context` fixture marks the tour done (`dismissTour`).
- the first popup open after install starts at step 1
- closing and reopening the popup resumes on the same step
- Skip tour, Escape and Done each mean it never starts by itself again (Done also returns focus to the "?" button)
- the default fixture shows no tour
- the header "?" button and Settings > General > Take the tour (closes Settings) both replay from step 1
- while the tour is up a mouse click on the sidebar and Up/Down do not reach the app, and Tab stays inside the card
- interactive steps end to end: "Next" is withheld until the user has made and named a group, changed its colour (only that group's dot works; the ring stays inside the popup), pinned it, typed in search (cleared again on leaving the step) and changed the theme through the account menu and Settings (Escape closes the menu, not the tour; the rest of the menu and of Settings is locked); the last step removes the practice group and only it
- an interactive step survives the popup closing (same step, practice group remembered); Escape in a new group's name field cancels the group, not the tour; "Skip tour" offers the practice group's removal in a toast
- at the free group limit the three group steps are read-only and no group is made; "Skip chapter" jumps to the next chapter
- a tour step has no serious/critical axe violations (`nested-interactive` disabled as in a11y.spec.ts)

## tourV2.spec.ts — guided tour v2 (action ring, chapters, keyboard)
Done. The ring is `[data-tour-action]`, the region `[data-tour-spotlight]` (value `calm` or `merged` while a ring is up), the chapter header `[data-tour-chapter]`. While Settings is open Radix hides the card from the accessibility tree, so the card's controls are located by CSS there. Run against a build made without `TM_E2E_GRANT_DOWNLOADS`.
- chapter header: every step shows "Chapter N of 6" and the chapter title; the description shows on a chapter's first step and on the step a resumed tour lands on, not on later steps; the status line carries it on the first step shown of a chapter and not on the next step, nor after Back to that first step
- a read-only step has a region ring (empty value, pulsing) and no action ring; with `prefers-reduced-motion` the pulse animation is none
- action ring through all five tasks with the mouse: make a group (Add Group, merged region; the name field, calm region; still the field while the name is "temp group"; Save once a name of its own is typed), colour (dot, swatches, Apply once a different colour is picked), pin (star), search ("Open search", then the field; a whole word stays in the field), theme (account menu button, "Settings", Theme control, open list, "Save changes"); at every position the ring contains its control, is tight to it, stays 8px inside the 800x600 frame, is the only thing that pulses, the card does not cover it and the document does not overflow; no ring once a task is done; "Restore defaults" is locked in the theme step
- keyboard only, all five tasks: on arriving at a "try it" step focus is on the card and Enter does not skip it; one Tab from the card lands on the step's control; when the task is done focus is back on the card and Enter goes on (theme: after Escape closes Settings, which does not end the tour); search: typing a whole word keeps focus in the field; focus is never on `<body>`
- resume on an interactive step: reopening shows the same step still to do, the practice group id is still in `tm_tour`, and the ring is on that group's control
- "Skip this step" moves on (the next group step is read-only when nothing was made), "Skip chapter" jumps a chapter, "Skip tour" ends it and unlocks the app; the last chapter has no "Skip chapter"; the "?" button replays from step 1 with its chapter header
- at the Free group limit: "Make a group", "Give it a colour" and "Pin a group to the top" show their fallback text, no action ring, "Next" instead of "Skip this step"; "Add Group" does nothing, and no upgrade prompt or limit toast appears
- KNOWN BUG (test fails on purpose): Enter on the card right after a task completes, then Tab within 500 ms, leaves focus on the card instead of the next step's control (the hand-back window in Tour.tsx is not reset on a step change)

## devices.spec.ts — Devices settings tab (Pro)
- free-tier (unauthenticated) user does not see the Devices tab at all
- pro-tier user sees the Devices tab in Settings (signed in via `signInAsPro`, every Supabase call stubbed)

## autoBackup.spec.ts — Automatic backups (Settings → Data)
- a signed-out user sees the explanation and "Upgrade to Pro", and no switch, interval or "Back up now"
- the section does not overflow the 800x600 popup horizontally
- a lapsed account keeps its existing backups (Restore listed, no "Back up now")
- Pro (`signInAsPro`): the toggle and the interval persist across a popup reopen; old stored settings show the defaults (on, daily)
- Pro: backups are listed newest first with group and tab counts; the sidebar Sessions list shows none of them (manual sessions still listed)
- Pro: Restore adds the groups next to the current ones and Undo removes them; declining the confirm changes nothing; Delete removes only that backup
- Not in e2e: the scheduled run, "Back up now", rotation and the upload (they run in the background worker, whose network requests `page.route()` cannot stub) — covered by `autoBackup*.test.ts` and `autoBackup.integration.test.ts`
- Rule the cases below follow: a backup that is missing from the account is NEVER deleted from the browser because of that. Deleting in the web dashboard removes the cloud copy only.
- TO ADD — Pro: a backup stored locally and marked uploaded, with the account's `sessions` answer stubbed EMPTY (complete, no error): after Settings → Data loads, the backup is still listed, still there after a popup reopen, and no "Removed ..." line is shown
- TO ADD — Pro: same with a stubbed answer that holds other backups: the missing one stays listed next to the ones brought back ("Brought back N backup(s) stored in your account." is the only line)
- TO ADD — Pro: Delete's confirm text says the backup is removed from this browser and from the account and that another browser that already has it keeps its own copy; accepting removes only that backup, declining removes nothing
- TO ADD — Pro: "Replace my groups" while the stored `cloudSyncActive` setting is false: a DELETE for the replaced group ids is requested (page-level `groups` DELETE stub sees them) and the ids are in the stored `pendingDeleteGroupIds`
- TO ADD — account switch: with "Also save a file to this computer" stored on, signing in as a different account leaves the option off (and the folder and file name unchanged)
- TO ADD — file settings: a file name `com{groups}`, a folder `CONIN$`, a name with a zero-width or right-to-left-override character each show their validation message and are not saved
- TO ADD (needs its own build, see below) — "Back up now" with the file option on writes a file under `TabMerger/` in the downloads folder, for a store of several thousand tabs too
- The file-copy build: a headless browser cannot answer the `downloads` permission prompt. Build with `TM_E2E_GRANT_DOWNLOADS=1 pnpm --filter @tabmerger/extension exec wxt build --mode development`, COPY `.output/chrome-mv3-dev` to another folder (for example `.output/chrome-mv3-dev-downloads`), then rebuild the normal dev build (`pnpm --filter @tabmerger/extension build:dev`) so the other specs keep the real manifest. The spec launches its own persistent context from that folder with `acceptDownloads: true` and a `downloadsPath` (the shared fixture takes `extensionPath` but passes neither of those), and skips itself when the folder does not exist. Playwright stores each download under a GUID name there: read the intended name from the Settings status line ("File saved to Downloads/..."), the content from that folder. The switch is ignored by every build mode except `development`.

## encryptionGate.spec.ts — encryption setup prompt (signed-in Pro user)
- a failed encryption check does not open "Set up encryption" and leaves the popup usable
- an account the server reports as having no key is asked to set up encryption

## visual.spec.ts — visual regression (`@visual`, not part of `test:e2e`)
Each state is shot in the light and the dark theme, as `popup-<state>-<theme>.png` (24 screenshots):
- `empty` — no saved groups, Now Open only
- `populated` — three coloured groups; the active one is starred, has a note, a starred named window, a tab note,
  a renamed tab and a stale tab
- `incognito` — a coloured group with a starred incognito window, a plain incognito window and a normal window
- `color-picker` — the group colour picker open on a sidebar row
- `settings-modal` — Settings, General tab (the version badge text is pinned to `v0.0.0`)
- `url-rules-modal` — URL rules at the free limit (3/3, "Add rule" disabled) with a very long pattern
- `search` — search overlay with a query matching three tabs, non-matching tabs dimmed behind it
- `encryption-setup` — "Set up encryption" for a signed-in Pro account with no key
- `encryption-unlock` — "Unlock encryption" (one field) on a device that does not hold the key
- `free-limit` — free account with seven groups: the upgrade banner and two locked sidebar rows
- `selection` — selection mode with two tabs selected and the action bar
- `long-content` — very long group name, window name, tab titles, URL and notes (also asserts the document does
  not grow past 800x600)

## Visual regression

`tests/visual.spec.ts` compares screenshots of the popup with baselines in `tests/visual.spec.ts-snapshots/`.
It covers what behaviour tests cannot see: overflow in the fixed 800x600 popup, the sidebar/header seam, colour
tints, both themes. The check is informational in CI.

**Run** (the spec always loads the production-mode build, `.output/chrome-mv3`, even when a dev build exists,
because the two render differently; `TM_E2E_EXT_DIR` still overrides it):

```bash
pnpm --filter @tabmerger/extension build
pnpm --filter @tabmerger/extension test:visual
```

**Update the Windows baselines** after an intentional UI change, then look at the changed images before
committing them:

```bash
pnpm --filter @tabmerger/extension test:visual --update-snapshots
```

Pass Playwright flags straight after the script name, with no `--` in between: pnpm passes a `--` through and
Playwright then reads the flag as a file filter.

**Baselines are per platform** (`*-win32.png`, `*-linux.png`): fonts and antialiasing differ between systems.
The `*-linux.png` files are generated by CI on a GitHub runner, never locally. A platform with no baseline yet
writes one and fails that first run.

**Conditions every shot is taken under** (`openSeededPopup` and `shoot` in the spec, seed data in
`visualSeed.ts`):
- 800x600 viewport, the real popup size;
- the page clock frozen (`context.clock.setFixedTime`) before the popup loads; seed timestamps are offsets from
  that instant, so stale markers and relative times never change;
- no network: http(s) requests are aborted in the page and the browser resolves nothing but loopback. Favicons
  are inline `data:` images or the built-in fallback, and Supabase is stubbed by `signInAsPro`;
- the theme stored the way the app stores it (`appSettings.theme` plus the `tabmerger-theme` copy in
  localStorage) and asserted before the shot;
- "Now Open" mirrors the test browser: always one window with one `about:blank` tab (the app leaves its own
  popup page out), so nothing is masked;
- `prefers-reduced-motion` emulated: hover transitions that move an element (the colour swatch grows on hover)
  otherwise shift whatever is positioned against it by a pixel, depending on timing;
- pointer parked on the header logo, fonts and images loaded, no toast or tooltip on screen, animations
  disabled, caret hidden.

**Tolerance:** one value for the whole spec, `maxDiffPixelRatio: 0.001` (480 of 480,000 pixels). It only absorbs
antialiasing noise; a one-pixel move of the sidebar edge alone changes about 1,200 pixels. Do not raise it for
one test: fix or remove a shot that is not stable.

**Adding a state:** seed fixed data only (no `Date.now()`, no random values, no remote images), wait on an
assertion for the state rather than a sleep, and run the spec several times
(`test:visual --repeat-each=5 --retries=0`, then once more with `TM_E2E_CPU_THROTTLE=4`) before committing the
baseline.

## Not covered yet (gaps, not silently assumed)
- Firefox/Edge builds — suite only runs against `chrome-mv3`
- Supabase sync / cross-device conflict resolution
- AI features (`useAI`, tab preview summaries) — gated behind Pro AI, no test account wired
- Free-tier group/tab limit enforcement (`useEntitlements`)
- Sessions save/restore
