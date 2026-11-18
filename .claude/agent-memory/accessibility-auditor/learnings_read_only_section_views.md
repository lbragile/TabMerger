---
name: learnings-read-only-section-views
description: Checks and traps for master-detail views opened from sidebar rows (SectionView/MainPanel): focus, arrow keys, current cue, announcements
metadata:
  type: project
---

Audit 2026-11-13 of the Archived/Sessions read-only main-panel views. Check code before trusting.

- Master-detail with focus left on the sidebar row: the open is silent for screen readers (`aria-current` is only state), so pair it with a polite status or a focusable heading. Closing via the header close button hands focus to the group row, not the row that opened the view.
- `useKeyboardNav` listens on `document` for Up/Down and switches the group, which also resets `mainView`. Any focused element that does not consume the arrow (the sidebar row that opened a view, header buttons) therefore silently closes the view. A list that consumes arrows (`ReadOnlyWindows`) must be called out as an exception, and it clamps per list instance, so SessionView (one list per group) cannot arrow across groups.
- The sidebar row left bar (`borderInlineStart`) is drawn on EVERY row in the item's colour, so it is not a "current" cue; the real cues are the 5-7% background (equal to hover) and weight/colour of the name.
- Restore/Delete in the sidebar and the views fire no toast or live region: the row just disappears (focus falls to body for sidebar-row actions).
- Meta lines using the "◆" separator are read aloud as "black diamond"; sidebar badges hide it with `aria-hidden`, header meta text does not.
- Each read-only window is a `<section aria-label>` (a region landmark) with no heading, so landmark lists fill with repeated "Window 1" entries.
- Sessions row text keeps `text-[9px] text-muted-foreground/50` and `/70` (fails 1.4.3 in light and dark); the Archived row uses full muted at 10px and passes.
- Tooltip tokens (`--tooltip`) verified by formula: pass 4.5:1 in both themes; Radix tooltip content in a Portal stays hoverable and Esc-dismissable.
- RTL: new code uses logical properties (`ps-`, `pe-`, `me-`, `text-start`, `borderInlineStart`, `rtl:-scale-x-100` on the chevron); only the Restore (RotateCcw) glyph is not mirrored.
