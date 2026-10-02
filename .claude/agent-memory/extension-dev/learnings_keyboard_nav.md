---
name: learnings_keyboard_nav
description: Keyboard navigation implementation — what was pre-built vs. the one missing piece (DOM focus sync)
metadata:
  type: feedback
---

## Keyboard nav in the extension popup is nearly complete out of the box

`useKeyboardNav` (`src/hooks/useKeyboardNav.ts`) already handles:
- `↑`/`↓` — `setActiveGroupIndex`
- `Enter` — `setActiveGroupIndex(getFocusedSidebarGroupIndex())`
- `Del` — delete focused tab (via `data-group-index/window-index/tab-index`) or sidebar group (via `data-sidebar-group-index`), guards against Now Open (index 0)
- `Ctrl+G` — add group
- `Ctrl+F` — focus search input (falls back to `querySelector('header input')`)
- `Ctrl+Z`/`Y` — undo/redo

`GroupContextMenu` wrapper already has `tabIndex={0}`, `data-sidebar-group-index`, and `focus-visible:ring-2 focus-visible:ring-primary`.
`TabItem` already has `tabIndex={0}`, `data-group-index/window-index/tab-index`, and `focus-visible:ring-2 focus-visible:ring-primary`.

## The one missing piece: DOM focus doesn't follow activeGroupIndex

`↑`/`↓` updates Zustand `activeGroupIndex` but never calls `.focus()` on the DOM element. `Enter` and `Del` read `document.activeElement`, so without DOM focus they find nothing.

**Fix:** A `useEffect` in `SidePanel` that queries `[data-sidebar-group-index="${activeGroupIndex}"]` and calls `.focus()` — but only when `document.activeElement` is already a sidebar group element. This prevents stealing focus from the windows-panel tab chips when the user is navigating tabs.

```tsx
useEffect(() => {
  const active = document.activeElement as HTMLElement | null;
  if (active?.dataset.sidebarGroupIndex == null) return;
  const target = document.querySelector<HTMLElement>(`[data-sidebar-group-index="${activeGroupIndex}"]`);
  target?.focus({ preventScroll: false });
}, [activeGroupIndex]);
```

**Why:** `setActiveGroupIndex` is a Zustand setter — React re-renders async, so you can't `.focus()` immediately after calling it. The `useEffect` runs after the render cycle when the DOM is stable.
