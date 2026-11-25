---
name: learnings-command-shortcuts-and-merge-dedup
description: Browsers silently refuse undocumented suggested_keys (Alt+Shift+C/P/R/W/X/Z in Edge 158 + Chromium 149); headless probe recipe; autoDedupOnMerge wiring via readAutoDedupOnMerge + dedupeMergedWindows
metadata:
  type: reference
---

**Command shortcuts (`scripts/commandShortcuts.ts`, used by `wxt.config.ts`):**
- A browser leaves a `suggested_key` "Not set" with no error when it collides with its own
  accelerators, and the help pages are incomplete. Edge 158 and Chromium 149 both refuse
  Alt+Shift+A/B/C/P/R/T/W/X/Z (C, P, R, W, X, Z are on no help page); Edge also documents
  Ctrl+Shift+K/U/P. Never trust the docs alone: probe.
- Probe recipe (headless, no store build): copy a built `chrome-mv3`/`edge-mv3` dir to a temp
  folder, rewrite `manifest.json` commands with 4 candidate keys, launch Playwright
  `chromium.launchPersistentContext(tmpProfile, { channel: 'msedge' | 'chromium', headless: true,
  args: ['--disable-extensions-except=…', '--load-extension=…',
  '--disable-features=DisableLoadExtensionCommandLineSwitch'] })`, then in the service worker
  `chrome.commands.getAll()`: an empty `shortcut` = refused. Max 4 suggested keys per extension.
- Edge shows Comma as `Alt+Shift+,`; Chromium as `Alt+Shift+Comma`. `MacCtrl` in the `mac` key
  parses fine on Windows. Ctrl+Alt is disallowed (AltGr). Option+Shift on Mac types characters.
- Firefox source for built-in keys: gecko-dev `browser/base/content/browser-sets.inc` (the
  mozilla-firefox repo path 404s); support.mozilla.org serves a bot challenge to fetchers.
- `src/__tests__/unit/scripts/commandShortcuts.test.ts` checks the defaults against the reserved
  table and loads wxt.config.ts (vi.mock("vite") + computed import path, as manifestLocales.test).

**Auto-deduplicate on merge:**
- Mutation hooks read the setting with `readAutoDedupOnMerge(qc)` (useAppSettings.ts):
  `qc.ensureQueryData` = the cache when present, else IndexedDB; failures count as off. Read it
  BEFORE `mutate()`: the mutFn runs inside the groups lock and must stay synchronous.
- `dedupeMergedWindows(kept, added)` (lib/deduplication.ts, built on `findDuplicateTabs`) keeps
  the target group's tab and drops the incoming copy, drops windows emptied by it, keeps
  already-empty windows. Applied to Merge with current, Unite windows (not Now Open: its tabs are
  real browser tabs), useMergeGroups and applyOrganizeActions (`{ dedupOnMerge }` option).
  AI auto-group already dedupes unconditionally (aiAutoGroup.ts). Moves/copies are not merges.
- Existing hook test mocks of `@/lib/localDb` that lack `getSetting` still pass: the missing-export
  throw happens inside `readAutoDedupOnMerge`'s try, so it reads as off.
