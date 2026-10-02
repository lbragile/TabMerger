---
name: learnings-windows-header-count
description: Investigation notes on a reported "N Windows · 1 Tab" header undercount bug that could not be reproduced with current committed code
metadata:
  type: project
---

A task reported the WindowsPanel toolbar header (`packages/extension/src/components/Windows/index.tsx` ~line 361, `formatGroupCounts(group.windows.length, group.windows.reduce((a, w) => a + w.tabs.length, 0))`) showing an undercounted tab total (e.g. "6 Windows · 1 Tab") after stale-tab UI features were added, allegedly via a screenshot.

**Investigation performed (all clean, no bug found):**
- `formatGroupCounts(windowCount, tabCount)` argument order is consistent at every call site (`Windows/index.tsx`, `useCurrentTabs.ts`, `utils.ts` defaults) — never swapped across the git history.
- The header computes directly from the `group` prop (not a cached `.info` string) — `group.info` is a dead/unused field for display purposes (only used at creation-time and by mutations, never read by any component).
- `useRemoveStaleTabs`, `useCleanupSuggestions`, and the stale-dot indicator in `Tab.tsx` are all scoped correctly (per-groupIndex, don't leak across groups) and don't affect the header's window/tab totals — staleness never filters what the header counts.
- Empirically re-rendered `WindowsPanel` with a 6-window/6-tab group (mixed stale/fresh `savedAt`) via a throwaway Vitest test — header correctly rendered "6 Windows ◆ 6 Tabs" every time.

**Conclusion:** Could not reproduce with current `HEAD` (commit e6594f3, which already includes "TDD/coverage overhaul, bug fixes"). Likely either already fixed by that commit, or the bug requires a specific repro path not yet identified — e.g. after a DnD cross-window move, after "Remove stale tabs", or after "Deduplicate tabs" (`DeduplicateConfirm.tsx` — not yet audited for this). Added a regression test (`windowsPanelToolbar.test.tsx` — "WindowsPanel — window/tab count header") to lock in current correct behavior. If this resurfaces, get exact repro steps (which action precedes the wrong count) before re-investigating — static/empirical review of the display line alone is a dead end.

**Why:** Avoid re-doing the same broad static-review sweep next time — start from `DeduplicateConfirm.tsx` and DnD cross-window move paths, which weren't fully audited.
