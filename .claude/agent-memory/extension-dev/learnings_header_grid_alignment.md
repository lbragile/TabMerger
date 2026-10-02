---
name: learnings-header-grid-alignment
description: Header/SidePanel column alignment bug — grid gap/padding broke the 240px boundary match, not the 240px value itself
metadata:
  type: feedback
---

When aligning Header's columns to SidePanel's fixed-width sidebar, matching the raw pixel number (240) in both files is necessary but not sufficient. A CSS Grid's `gap-*` and the container's own `px-*` both shift column boundaries independently of the column-width values in `grid-cols-[...]` — `grid-cols-[240px_1fr_auto] gap-2 px-3` puts column 2's start at `px-left + 240 + gap`, not at `240`, from the viewport edge. SidePanel/main-content in `App.tsx` has zero outer padding and no gap, so its true boundary is at exactly `240px`.

**Fix pattern:** don't use CSS Grid with gap for a header that must pixel-align with a flex layout below it. Mirror the exact box model instead — a flex `<header>` with a first child of `style={{ width: 240, borderRight: '1px solid var(--zone-sidebar-border)' }}` and its own internal `px-3`, matching `SidePanel`'s root div exactly (same width/border, no outer container padding). Put per-section padding (`px-3`, `pr-3`) inside each flex cell, never on the outer `<header>`.

**Why this matters:** "the number is right in both files" is not proof of alignment — always check gap/padding contributions on both sides of a boundary that's supposed to be pixel-perfect between two sibling layout trees (header row vs. body row).

**Regression test:** assert the header's outer element has no `px-*` class and its first child's inline `style.width`/`borderRight` match the SidePanel root's values — see `sidePanelAndHeader.test.tsx` describe block "Header — logo column alignment with SidePanel".
