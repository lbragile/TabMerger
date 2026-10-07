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

## misc.spec.ts — Notes
- group note text persists after popup reload

## persistence.spec.ts — a change survives the popup going away
- a colour change is on disk when the popup is destroyed the instant its write was handed to IndexedDB
  (the popup runs in an iframe that removes itself in the microtask after the write's last request)

## a11y.spec.ts — axe-core
- popup with seeded groups has no serious/critical a11y violations
- selection mode has no serious/critical a11y violations
- (`nested-interactive` rule disabled — known pre-existing pattern, see `extension-dev` learnings)

## devices.spec.ts — Devices settings tab (Pro)
- free-tier (unauthenticated) user does not see the Devices tab at all
- pro-tier user sees the Devices tab in Settings (signed in via `signInAsPro`, every Supabase call stubbed)

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
