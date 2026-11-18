---
name: learnings-tooltip-portal-contrast
description: components/ui/tooltip.tsx renders in a Radix Portal; without it tooltips inherited row opacity and the sidebar ScrollArea scrollbar painted over them; --tooltip tokens for light-theme contrast
metadata:
  type: reference
---

`TooltipContent` (components/ui/tooltip.tsx) is wrapped in `TooltipPrimitive.Portal`. Before, the
content rendered inside its trigger's subtree, which caused two bugs:

- It inherited an ancestor's `opacity` (locked group rows `opacity-60`, search-faded 0.6,
  selection-faded 0.4): washed-out bubble with rows showing through. A child can never be more
  opaque than its ancestor, whatever its own z-index.
- Inside the sidebar `ScrollArea` viewport, the scrollbar (a LATER sibling in the ScrollArea root)
  painted over a tooltip near the sidebar's end edge.

With the portal the Radix popper wrapper is a direct child of `<body>`, after the app root, z-50.
Dark mode still works because `.dark` is on `<html>` (lib/theme.ts), and `dir` comes from `<html>`.
Unit test: `__tests__/unit/components/ui/tooltip.test.tsx` (popper's parent is body, not inside a
dimmed row / container). Radix renders the text twice (visible bubble + a visually hidden
`role="tooltip"` copy), so find the bubble via `closest('[data-radix-popper-content-wrapper]')`.

Contrast: white on `--primary` (hsl 193 100% 40%) is 3.05:1, below 4.5:1 for 12px text. Tooltips use
`bg-tooltip text-tooltip-foreground` (globals.css tokens): light `193 100% 28%` + white = 5.67:1;
dark keeps primary (`193 80% 55%` on `193 100% 10%`) = 7.30:1. Per-call `className` overrides
(e.g. the destructive tooltip in Tab.tsx) still win via tailwind-merge.
