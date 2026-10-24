---
name: tooltip-focus-restore
description: Radix Tooltip.Trigger opens on any non-pointer focus, so overlays restoring focus to a pressed trigger leave a stuck tooltip; both tooltip.tsx wrappers ignore non-focus-visible focus
metadata:
  type: reference
---

Radix `Tooltip.Trigger` opens on focus when no pointer press is in progress. Popover/DropdownMenu/Dialog restore focus to their trigger on close, so the tooltip opened with the pointer elsewhere and stayed until blur (no pointerleave fires).

Decision: `TooltipTrigger` in both `components/ui/tooltip.tsx` files is a forwardRef wrapper whose `onFocus` runs the caller's handler, then `preventDefault()` when the element does not match `:focus-visible` (Radix composes handlers, so its open is skipped). A throwing `matches` (old jsdom/nwsapi) counts as focus-visible. Tests mock `Element.prototype.matches` for `:focus-visible`.
