---
name: learnings-search-highlight-hide-dim
description: Popup search - matchRanges / Highlighted, the hide-or-dim setting, why hidden rows keep positional indices, the reorder lock, the sticky query and the tests that marks break
metadata:
  type: learning
---

**Where things live.** `src/lib/searchMatch.ts` (pure: `matchRanges`, `substringRanges`,
`snippetAroundMatch`, `groupSearchState`, `summarizeSearch`), `src/components/Highlighted.tsx`
(the only place a `<mark>` is made), `src/hooks/useSearchView.ts` (`useSearchMode`,
`useSearchFilters`, `PanelSearchContext`), `src/components/SearchAnnouncer.tsx` (live region),
`packages/shared/src/constants/search.ts` (enum, default, copy, `normalizeSearchNonMatching`).

**One matcher everywhere (contiguous only).** Every search filter (panel, sidebar counts, the
search list, the `group:`/`window:`/`tag:` pickers, the `group:` auto-jump in `App.tsx`, Tab.tsx's
own dim check, Ctrl+A in Windows/index.tsx) goes through `textMatches` in `searchMatch.ts`:
trimmed query, case-insensitive `includes`, never letters picked out one by one (the old
`fuzzyMatch` subsequence matcher is gone). `matchRanges` marks the first occurrence of the same
trimmed query, so shown-and-undimmed always means highlighted; a unit test loops both over the
same inputs. Tab.tsx and Windows/index.tsx call `tabMatchesFilters` rather than re-deriving the
title/url check, otherwise a tab matched only by its custom (display) title gets dimmed while
the panel state counts it. The search list orders results with `matchRank` / `sortByRank`
(exact, prefix, word start, anywhere; stable) before the 12-result cut, and pickers the same
before their 8-entry cut. The tour's `search` task already used a contiguous `includes`; it was
left on its own check because importing `searchMatch` pulls `tabTitle` -> `localDb` into
`tourTasks`.

**Hiding is render-only.** Hidden tabs and windows return `null` inside the existing `map`, so
`windowIndex` / `tabIndex` stay the real positions and every mutation still goes to the right
row. The free-tier tab offset keeps counting hidden windows. `groupSearchState` returns arrays
indexed like the group's own `windows` / `tabs` for the same reason. Never filter the array first.

**Reorder lock without touching the DnD model.** In "hide" mode with a query the grips are not
rendered (tabs, windows, groups), `moveGroupId` is withheld and Space on a row is consumed with
an announcement. No grip means no native drag and no dnd-kit keyboard activator, so
`dndMove` / `useDndModel` / `useDndHandlers` need no knowledge of search. "Dim" mode renders
every row and keeps drag and drop as it was.

**Mode is forced to "dim" while the guided tour runs** (`useSearchMode` reads `tourActive`): the
tour points at rows by position. Which groups search skips is the tour's `isHiddenFromSearch`
plus `useTourSearchShowsDemo()` in every memo that filters with it.

**Sticky query consequences.** The query is cleared only by the user, so anything that used to
rely on "picking a result clears it" needs care: the `group:` auto-jump in `App.tsx` now fires
once per filter text (a ref), otherwise every "Now Open" update pulled the user back; a group
found by its name alone shows all its tabs (`groupSearchState`), otherwise going to it showed an
empty panel; a picked tab is revealed by its `data-group-index` / `data-window-index` /
`data-tab-index` attributes after the panel has drawn.

**Escape.** The search box had no Escape handling at all. It now closes on Escape through a
capture-phase `window` listener that calls `preventDefault`, because the app's own Escape
handler (leave selection mode) is also on `window` and skips a prevented event.

**Gotchas.**
- A `<mark>` splits the text node: `getByText('React docs')` no longer finds a row whose text is
  partly marked. Query by role and accessible name, or with a function matcher on `textContent`.
- A new `AppSettings` key is missing from records saved earlier; `settingsEqual` in Settings
  compares each key against its default so the form does not open as "Unsaved changes".
- Semibold marks with no padding: adding horizontal padding moves the text and changes where a
  truncated row cuts off.
- Edit scripts fed to Python through a Git Bash heredoc corrupt non-ASCII characters (`…`, `—`);
  write the script to a UTF-8 file first.
