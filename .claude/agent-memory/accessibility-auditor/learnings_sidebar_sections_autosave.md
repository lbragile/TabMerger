---
name: learnings-sidebar-sections-autosave
description: Sidebar sections (SidebarSection shell) and Settings → Data a11y patterns checked in the auto-save audit; reuse for Archived/Sessions
metadata:
  type: project
---

Audit 2026-11-07 of Auto-save UI. Check code before trusting.

- `SidebarSection` has `aria-expanded` but no `aria-controls`/body id; shared by Auto-saved, Archived, Sessions, so one fix covers all.
- Sidebar row/section raw `<button>`s (not shadcn `Button`) get no `focus-visible:ring`; they rely on the browser default outline. `globals.css` has no global button focus rule. Shadcn `Button` uses `focus-visible:ring-2 ring-ring`.
- Sidebar icon buttons are 12-18px (below WCAG 2.2 target size 24px); the pattern is shared with Archived.
- Metadata text `text-[9px] text-muted-foreground/50` is about 2.3:1 light (fails 1.4.3); `--muted-foreground` light is about 4.8:1 on white, 4.4-4.6 on the sidebar tint.
- `useAutoSaveNow` guards re-entry (`if (running) return`) and toasts every outcome; the Settings status line is also `role="status"`, so a run is announced twice (toast + status).
- Toasts default to 4000ms (`DEFAULT_TOAST_DURATION`); a toast with an Undo action is hard to reach by keyboard in that time.
- Settings controls: `Label` has no `htmlFor`; the Switch/Select carry `aria-label` and descriptions are not `aria-describedby`-linked.
