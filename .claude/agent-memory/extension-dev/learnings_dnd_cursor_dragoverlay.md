---
name: learnings-dnd-cursor-dragoverlay
description: cursor-grab/active:cursor-grabbing Tailwind classes on dnd-kit drag handles don't work during an active drag when using DragOverlay
metadata:
  type: project
---

Symptom: drag handles have `cursor-grab active:cursor-grabbing` Tailwind classes (correctly present in source), base hover `cursor-grab` works, but the cursor never shows `grabbing` while a drag is in progress.

Root cause: this codebase's `WindowsPanel` (packages/extension/src/components/Windows/index.tsx) and `SidePanel` (packages/extension/src/components/SidePanel/index.tsx) both use @dnd-kit's `<DragOverlay>`, portaled to `document.body`, with `pointer-events-none` on the ghost clone (needed so the ghost doesn't itself become a drop target). During an active drag the source sortable item doesn't track the cursor 1:1 (only the ghost does, via the `snapTabToCursor` modifier) — so the pointer ends up positionally over the pointer-events-none ghost, and the browser hit-tests through it to whatever's underneath, never the original handle element. Since `active:` is a CSS pseudo-class tied to actual pointer-down-and-over on that element, it never fires once the layout shifts it out from under the cursor.

Fix: force the cursor at the document.body level instead of relying on element-level `active:` classes. Added `setBodyDragCursor(active: boolean)` in `src/hooks/useDnd.ts` (`document.body.style.cursor = active ? 'grabbing' : ''`), called from every `onDragStart`/`onDragEnd`/`onDragCancel` in both `DndContext` usages (Windows/index.tsx's `handleDragStart`/`handleDragEnd`/`handleDragCancel`, SidePanel/index.tsx's inline handlers).

Gotcha: any test file with `vi.mock('@/hooks/useDnd', () => ({ ... }))` needs `setBodyDragCursor: vi.fn()` added to the mock object, or every test that triggers `handleDragStart` throws "No setBodyDragCursor export is defined on the mock". Five test files needed this: windowsDnd.test.tsx, dnd.test.tsx, windowsPanelToolbar.test.tsx, sidePanelAndHeader.test.tsx, sidePanelSections.test.tsx.
