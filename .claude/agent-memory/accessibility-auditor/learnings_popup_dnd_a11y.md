---
name: learnings-popup-dnd-a11y
description: Popup DnD/selection a11y gotchas — load-bearing ARIA selectors, dnd-kit keyboard internals (activator, coordinate getter reaches sidebar, live region), positional-id focus, announcer/focus talk-over, contrast figures
metadata:
  type: project
---

First audit 2026-09-13; follow-up verification 2026-09-14 after extension-dev implemented C1–S5/M1–M6/m1 (M3 roving tabindex landed later: `hooks/useRovingRow.ts`). Check code before trusting bug status.

**Things that look like safe a11y fixes but break DnD**
- `role="listitem"` on the tab row is a DnD selector (`closestDragRow` in `lib/dndHtml5Sensor.ts`, `dragRowKind` in `lib/dndDragVisuals.ts`). Changing the row role means updating those.
- Grip labels are `Drag to reorder tab|window|group: <title>`. The `Drag to reorder` PREFIX is a selector (`[aria-label^=...]`) in `dndHtml5Sensor.ts`, `lib/dndFocus.ts`, `App.tsx` focus-out, and the e2e repro suite — keep it.
- `aria-pressed` on the grip is NOT pinned any more. Empirical trial `gripAriaPressed` in `packages/extension/e2e/repro/popupAbortWindow.repro.ts` showed an attribute-only change, even synchronous in `dragstart`, does not abort the native drag; dnd-kit manages it. Lesson: trust the repro harness over code comments/spec wording for C4 claims.

**dnd-kit internals (core 6.3.1, sortable 10.0.0, accessibility 3.1.1 under node_modules/.pnpm)**
- KeyboardSensor activator fires only when `event.target === activatorNode` and ignores modifiers — Shift+Space on the grip picks up. It calls `preventDefault`, not `stopPropagation`.
- The sensor's move/end/cancel keydown listener is added to `document` in a `setTimeout`; earlier document listeners run first (hence the `isDndDragLive()` flag in `lib/dndMultiDrag.ts`). End codes = Space, Enter, Tab.
- `sortableKeyboardCoordinates` filters droppables by DIRECTION ONLY — any enabled droppable (sidebar group rows, new-window zone) is reachable; Left arrow from a tab goes to the sidebar. So hover-driven logic in `onDragOver` (600ms spring-open) also fires during keyboard drags.
- LiveRegion = `role="status" aria-live="assertive" aria-atomic`; `announce(undefined)` is a no-op. Monitor events dispatch synchronously in the same batch as the user handler, so the drop announcement and any store change made in `onDragEnd` land in the same commit.
- Popup uses `restoreFocus:false`; `lib/dndFocus.ts` focuses by landed position in rAF, keyboard drags only (gated on `activatorEvent instanceof KeyboardEvent`).
- Row React keys are positional too. Moves whose result arrives later (Now Open reorder = `chrome.tabs.move`, `applyMove` returns `next: s` with no `landed`) leave focus on the old slot, which then shows a different tab.

**Screen-reader timing risk (needs real SR check)**
- Focus moves one rAF after the drop announcement. NVDA/JAWS cancel speech on focus change, and the grip's `aria-describedby` instructions (long custom text) are re-read, so the drop outcome may never be heard. Also `SelectionAnnouncer` (polite) says "N still selected" in the same commit.

**How to apply**
- C4-safe fix shapes: live-region text; focus calls in rAF after commit; static CSS in `globals.css`; classes in `#tm-dnd-aux-host`; keydown-handler logic; skipping hover logic when `activeRef.current.keyboard`. Mark anything toggled on grip/row/window card mid-native-drag as "touches grip ancestor". Static (never-toggled) class strings are fine.
- Unit tests now exist (`useDndHandlersKeyboardA11y`, `dndFocus`, `dndAnnouncements`, `SelectionAnnouncer`, `selectionRange`, `reducedMotion`); no confirmed e2e for keyboard DnD — treat SR/keyboard runtime claims as code-read.

**Contrast figures (computed; reuse)**
- Light `--primary` hsl(193 100% 40%) = rgb(0,160,204), L≈0.295: 3.04:1 on white; 2.73:1 on a `bg-primary/10` row; 2.84:1 on light sidebar `--zone-sidebar` (≈rgb 247,247,248).
- Dark `--primary` hsl(193 80% 55%) = rgb(48,192,232), L≈0.44: 9.3:1 on dark card; 8.2:1 on primary/10 row; 8.3:1 on dark sidebar.
- `--foreground` inset bar on selected tab row: 17.9:1 light, 16.8:1 dark. `bg-foreground/text-background` badge ≈19:1. `.dark` is on `<html>`, so aux-host content inherits theme.
- Group selection hardcoded rgba(0,180,204): light ≈2.0:1 vs its 15% tint, 2.3:1 vs sidebar; dark 5.6:1. Group checked icon `text-accent-foreground` light 5.4:1 on the tint.
- `opacity-60` companion rows: dashed primary outline ≈2.0:1 light; 10px muted hostname ≈2.3:1.
- `ring-primary/50`: 1.7:1 white card, 3.0:1 dark. `opacity-30` grip ≈1.5:1 light, 1.6:1 dark.
