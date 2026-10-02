---
name: learnings-dndkit-rects
description: How dnd-kit exposes drag rect info during DragOver events for insertion-line positioning
metadata:
  type: project
---

## dnd-kit rect access during dragOver

During `onDragOver` (`DragOverEvent`), two rect sources are available:

- `e.active.rect.current.translated` — a `ClientRect | null` of the dragging element's *current* translated position (i.e., where the ghost is right now). This is the field to use for "where is the dragged item's center currently."
- `e.over?.rect` — a `ClientRect` of the element currently under the cursor.

Both are available in `onDragEnd` too (same shape), so the same 50% threshold logic works in both handlers.

**Why:** `e.active.rect.current.initial` gives the *start* position, not the current one. Use `translated` for live position during drag.

**How to apply:** For insertion-line before/after logic: compare `translated.top + translated.height / 2` vs `overRect.top + overRect.height / 2`. If active center > over center → insert after.

**Note:** `translated` can be `null` briefly at drag start before the first move event. Always guard with `translated && overRect` before reading.
