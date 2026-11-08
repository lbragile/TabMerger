---
name: learnings-auto-save-open-tabs
description: Auto-save open tabs — marker inside the encrypted blob, promotion-on-edit in writeGroupsState, worker run/lock/threshold, tier-default settings, test and build gotchas
metadata:
  type: reference
---

Auto-save open tabs = a normal group carrying `autoSave: { at, rolling }` (inside the encrypted
`groups.windows` blob, no schema change). Files: `lib/autoSave.ts` (pure: settings reader, plan,
threshold step, copy), `lib/autoSaveRun.ts` (worker: tier, lock, alarm, threshold, messages),
`lib/autoSaveGroups.ts` (store-free marker helpers, also imported by localDb and syncEngine),
constants in `packages/shared/src/constants/autoSave.ts`.

Non-obvious things:

- **"Editing keeps it" lives in `writeGroupsState`** (`promoteEditedAutoSave`): every writer (mutation
  hooks, DnD's blind `saveGroupsState`, bulk actions, AI, the worker) is covered with no per-call-site
  code. It only fires when the incoming copy has `pendingSync === true` (every user edit sets it; a
  pulled server copy never does) and compares content NORMALISED like `groupContentEqual`
  (`starred ?? false`, `archived ?? false`, `note ?? ''`, no `permanent`). Without both, a pulled copy
  of an untouched auto-save (rowToGroup shape differs from a locally created group) was "edited".
  Writes flagged `savedUnchanged` (Now Open mirror) skip the comparison entirely: hot path.
- The promotion is announced to the CURRENT context through a listener (`onAutoSavePromoted`), not a
  runtime message. It is emitted inside the write, BEFORE the write's undo step is recorded: read
  `undoStack[0]` synchronously in the listener as the "before" entry, show the Undo toast on the next
  tick. A blind DnD write leaves the marker in the cache, so the listener also invalidates the groups query.
- **Copies must drop the marker** (`asNewGroup`, `makeConflictCopy`): otherwise a Free user's duplicate
  is the oldest rolling auto-save and the next run deletes it.
- Merge: a difference ONLY in the marker means one side pressed Keep. Keep wins
  (`groupContentEqual(a, b, { ignoreAutoSave: true })`), no conflict copy; stay pending when the server
  copy is still marked. `markPushed` keeps comparing the marker (a Keep is a change to push).
- **Tier for a background run**: no session on a store no account owns = confirmed Free; no session
  but `LAST_USER_ID_KEY` set = unknown (a signed-out Pro user's pulled rolling groups must never be
  removed and queued as server deletes); failed `fetchTier` = unknown. Only confirmed Free removes or
  marks `rolling`. The last answer is remembered (`AUTO_SAVE_TIER_SEEN_KEY`) only for the on/off
  default, alarm arming and the Free limits.
- Settings "absent = plan default": `autoSaveTabsEnabled` is optional and NOT in `DEFAULT_APP_SETTINGS`;
  the draft-then-save Settings modal spreads the stored object, so absent stays absent until toggled.
- The Settings card must not render either default while `useEntitlements().loading` (a Pro user would
  see the switch flick from off to on).
- New catalog area for worker-read copy: register it in every `locales/<lng>/index.ts` AND in
  `locales/worker.ts` (imports + table + `WORKER_AREAS`); the worker-catalogs test fails otherwise.
- `text-ui-start` is only allowed on an element with its own `dir` (logicalDirection test): put it on
  the `dir="auto"` span, use `text-start` on the button around it.
- Mounting a new section inside `SidePanel` broke four old SidePanel test files (their hand-rolled
  `vi.mock('@/hooks/useGroups')` lacks the new hook): mock the section module there
  (`vi.mock('@/components/SidePanel/AutoSavedSection', () => ({ AutoSavedSection: () => null }))`).
- E2E without touching `.output/chrome-mv3-dev`: a config outside the repo that spreads the real one
  with its own `outDir`, `pnpm exec wxt build --mode development -c <that config>`, then
  `TM_E2E_EXT_DIR=<abs path>/chrome-mv3-dev pnpm exec playwright test -c e2e/playwright.config.ts <spec>`.
  Signed out, the worker's manual run is fully offline (confirmed Free), so the e2e can drive
  "Auto-save now" end to end.
- Editing UTF-8 files with a Python script on Windows: always `encoding='utf-8'` (and `PYTHONUTF8=1`);
  the default cp1252 decode made a multi-line match containing "→" fail.
- On a heavily loaded machine vitest fails with "Failed to start forks worker ... Timeout waiting for
  worker to respond" and reports "no tests" (exit 0!): grep the log for `Test Files`, re-run.

Related: [[auto-backups]], [[learnings-groups-rmw-lock]], [[learnings-i18n-i18next]].
