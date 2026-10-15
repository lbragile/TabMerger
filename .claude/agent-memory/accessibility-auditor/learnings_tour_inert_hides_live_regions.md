---
name: tour-inert-hides-live-regions
description: The guided tour makes the app root inert, so live regions mounted inside it (SearchAnnouncer, SelectionAnnouncer) go silent during tour steps; only toasts, the tour card and the DnD aux host are spared
metadata:
  type: reference
---

`lockTourApp` (`src/lib/tourDom.ts`) sets `inert` on every child of the app root except the toast region, the elements a step allows and their ancestors. Inert content is removed from the accessibility tree, so a polite live region rendered inside the root (`SearchAnnouncer`, `SelectionAnnouncer`) is not announced while a step is up, including the search steps where the user types. Live regions that survive: the tour card's own status line, sonner's toast region, and `#tm-dnd-live-region` (a `<body>` child via `getDndAuxHost`).

Audit tips for this codebase:
- The tour's `useSearchMode()` forces "dim" while the tour is active, so hide-mode paths are never exercised in tour steps.
- Rows use a roving tabindex (`-1`) and dnd-kit grips are forced to `tabIndex={-1}`; the tour reaches them through `OPERABLE` (includes `[tabindex]`), not `FOCUSABLE`.
