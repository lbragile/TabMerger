---
name: learnings-modal-flex-grid-overflow
description: Root-cause pattern for content bleeding past modal/panel boundaries in the fixed 800x600 popup — missing overflow-hidden on the grid container plus missing min-w-0 down a flex/grid chain
metadata:
  type: project
---

Fixed a real layout bug: Settings → Devices panel's expanded device row content
rendered past the modal's right edge, bleeding into popup content behind it.

Root cause (two-part, both needed):
1. `DialogContent` (`packages/extension/src/components/ui/dialog.tsx`) is
   `display: grid` with `max-w-lg` but had **no `overflow-hidden`**. CSS
   `max-width` caps the box's own size, but does nothing to clip content that
   overflows past that box — the box stays capped, the child content just
   renders past it (`overflow: visible` is the default). That's exactly what
   the screenshot showed: modal box unchanged size, text spilling past it.
2. Grid/flex items default to `min-width: auto`, not `0`. Any DOM boundary
   that is itself a grid/flex *item* (not just container) — e.g. the `<Tabs>`
   root div and the `mt-4 max-h-[320px] overflow-y-auto` tab-content wrapper
   in `Settings.tsx`, both direct children of the grid `DialogContent` — will
   refuse to shrink below their content's intrinsic width unless explicitly
   given `min-w-0`. A single long/dense string anywhere deep in the tree can
   then push that ancestor wider than available space, and with #1 unfixed,
   the excess renders past the modal.

Fix applied: `overflow-hidden` on `DialogContent` (this is a **global** fix
affecting all modals since it's the shared primitive), `min-w-0` added to
`Tabs` root + tab-content scroll wrapper in `Settings.tsx`, and `min-w-0`
added through the `OtherDevices.tsx` / `DeviceRow` flex chain (outer bordered
row div, expanded section div, per-tab row div) — the truncate spans already
had `min-w-0 truncate` but their *ancestors* didn't, which is what let them
overflow instead of shrink-and-truncate.

Recurring risk class in this codebase (2nd overflow bug this session after
SessionCard on the web side): any time a flex/grid item wraps text content in
a fixed-size container (the popup can never scroll outward per CLAUDE.md),
audit the FULL ancestor chain for `min-w-0`, not just the leaf truncate span —
one missing link anywhere between the grid/flex boundary and the leaf breaks
containment. `overflow-hidden` on the outermost box (here `DialogContent`) is
the backstop that makes truncation failures invisible-but-safe instead of a
visible bleed past the popup's fixed 800x600 boundary.
