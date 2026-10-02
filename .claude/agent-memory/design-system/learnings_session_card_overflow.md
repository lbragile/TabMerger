---
name: session-card-overflow-fix
description: SessionCard 3-column grid overflow — root cause and fix pattern for dashboard cards
metadata:
  type: project
---

`SessionCard.tsx` overflowed at `lg:grid-cols-3` because it used `flex flex-col md:flex-row`
with a right-hand "Contents" panel at a hard-coded `md:w-[280px]` — flex items default to
`min-width: auto`, so long tab titles/urls pushed the row (and grid track) wider than the
column instead of truncating. Fixed by dropping the two-panel flex-row layout entirely: the
card is now single-column with `min-w-0` on the outer card and on truncating flex children,
and the "Contents" side panel became a collapsible section (`useState` toggle, "Show
contents (N)" button) below the actions row — mirroring `GroupGrid.tsx`'s `GroupCard`
"Show tabs" expand/collapse pattern instead of inventing a new pattern.

**Why:** `GroupGrid.tsx` (built same session) is the current reference for dashboard card
visual language — collapsible tab lists via a text button, not fixed-width side panels.
Consistency here also incidentally fixes the overflow since collapsible content is naturally
constrained to the card's own width.

**How to apply:** Any future dashboard card with a "preview list of children" (groups, tabs,
sessions) should default to a collapsible section below the main content, not a side-by-side
panel — side panels don't reflow gracefully inside CSS grid columns. Also: `min-w-0` must be
added explicitly on both the grid item and any flex child that truncates — Tailwind's
`truncate` class silently does nothing without it.
