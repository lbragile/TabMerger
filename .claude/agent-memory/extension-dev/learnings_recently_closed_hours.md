---
name: learnings-recently-closed-hours
description: Recently closed day view "day at a glance" - per-hour activity strip (roving bars, aria-pressed), hour markers below their entries inside the one list, pick reset during render, jsdom/Intl gotchas, scratchpad screenshot spec
metadata:
  type: reference
---

Shape (all popup-only):
- Pure `lib/recentlyClosedHours.ts`: `closedHour` = `new Date(ms).getHours()` (wall clock, as the
  rows show), `countByHour` (24 slots; a window counts once), `busiestHours` (all ties, earliest
  first), `runsByHour` (consecutive same-hour runs of the newest-first list, NOT a map: a
  fall-back DST day's repeated 01:xx passes stay together and nothing reorders),
  `hourLabel`/`hourAxisLabel` (formatted from a fixed 2000-01-01 date so a DST-skipped hour still
  has a label; `hourLabel` reuses `formatClosedTime`), `barHeightRem` (min 0.375, max 2.625).
- `hooks/useClosedHourFilter(entries)`: counts over the WHOLE day (search never changes bars);
  the pick resets itself when its hour empties by adjusting state DURING render
  (`if (chosen !== null && counts[chosen] === 0) setChosen(null)`), so an Undo that brings the
  hour back does not revive the old pick. Day change resets for free: MainPanel keys the view by day.
  Picks are announced via `announceSectionView` from the click (never from an effect, never for
  the automatic reset); unmount clears the last announced text.
- `ClosedHourStrip`: `role="group"` of bar buttons with roving tabindex (Left/Right via
  `inlineArrow`, Home/End; the stop = last focused, else picked, else earliest bar). The visible
  status `<p>` is NOT a live region (the section announcer is), or picks would be read twice.
  "Show all hours" unmounts itself on click, so it focuses the previously picked bar.
  The picked bar gets an underline too (state not by opacity alone). 24-column grid: Tailwind v4
  `grid-cols-24` is `repeat(24, minmax(0,1fr))`, so wide axis labels ("12 PM") overflow their
  cell instead of widening it; first/last label use `justify-self-start/end`. RTL: the grid
  mirrors by itself.
- Markers are `<li aria-hidden>` inside the SAME `<ul>`, after each run's last listed entry
  (they move when "Show more" extends a run). Rendered with one flat `runs.flatMap(...)` array so
  rows keep their keys (an open window chevron survives the run's first row leaving). Markers
  carry no `CLOSED_ENTRY_ATTR`/`READ_ONLY_TAB_ATTR`, so `handleReadOnlyListKeyDown` and
  `useFocusAfterRowRemoval` cross hours untouched. Tests that counted `:scope > li` now count
  `li[data-read-only-row]`.

Gotchas:
- Node's ICU formats `en-GB` `{hour:'numeric', minute:'2-digit'}` 2 AM as "2:00" (not "02:00"); assert `/^0?2:00$/`.
- jsdom: `el.focus()` / `el.dispatchEvent(keydown)` outside `act` gave a stale roving
  `tabIndex` (state set in onFocus not flushed); wrap them in `act`.
- Screenshots without touching the repo's e2e tree: a spec + plain-object config (no
  `@playwright/test` import, the scratchpad can't resolve it) in the scratchpad, importing
  `e2e/fixtures`/`helpers`/`seed` by absolute path, run with
  `npx playwright test -c <scratch>/shots.config.ts` from `packages/extension`.

Related: [[learnings-recently-closed-ui]], [[learnings-section-views-mainview]], [[learnings-rtl-layout]].
