# Extension E2E test cases

Playwright suite in `packages/extension/e2e/tests/`, run via `pnpm --filter @tabmerger/extension test:e2e`.
Each file loads the real built extension (`.output/chrome-mv3`) in a persistent Chromium context — no mocking.

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

## Not covered yet (gaps, not silently assumed)
- Firefox/Edge builds — suite only runs against `chrome-mv3`
- Supabase sync / cross-device conflict resolution
- AI features (`useAI`, tab preview summaries) — gated behind Pro AI, no test account wired
- Free-tier group/tab limit enforcement (`useEntitlements`)
- Sessions save/restore
