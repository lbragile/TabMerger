---
name: dnd-ondragover-self-feed-loop
description: The unified DnD layer's live onDragOver preview can feed itself into an infinite render loop ("Maximum update depth exceeded") that unmounts the whole popup — check these four guards survive any DnD change
metadata:
  type: project
---

**[2026-09] Unified DnD layer.** The live `onDragOver` reflow renders the panels from
`overrideState` (a working copy with sortable rows inserted/removed mid-drag). That
shifts which droppable the pointer hits, so dnd-kit's `over` can flip between two
targets that resolve to the same move, or land on a row that ONLY exists in the
preview. Each flip allocated a new `overrideState` object → re-render → layout shift
→ another flip → "Maximum update depth exceeded". The popup has **no error boundary**,
so React unmounts it entirely and every drag type goes dead at once.

Four guards keep the loop broken — verify all four still exist after any change to
`src/hooks/useDndHandlers.ts` or `src/components/dnd/DndProvider.tsx`:

1. `DndProvider.tsx` — `measuring={{ droppable: { strategy: 1 } }}` (BeforeDragging).
   MUST NOT be `0` (Always): Always re-measures every render, so the preview's DOM
   shift moves collision rects mid-drag and re-triggers `onDragOver`. The `1` is
   hardcoded, not imported, on purpose (vitest v4 throws on an undefined named export
   from a factory mock of `@dnd-kit/core`).
2. `useDndHandlers.onDragOver` — `if (a && o && a.id === o.id) return;` (pointer
   resolved onto the dragged row itself → keep current preview, don't null it).
3. `useDndHandlers.onDragOver` — `if (!idInModel(model, overId)) return;` ignores an
   `over.id` absent from the PRE-DRAG model (preview-only row).
4. `useDndHandlers` — `applyPreview()` de-dupes via `previewSignature` (structural
   fingerprint ignoring `updatedAt`/`pendingSync`); `onDragEnd` commits against
   `lastRealOverRef` when the raw drop target is preview-only.

Regression tests: `src/__tests__/unit/hooks/useDndHandlersUnified.test.tsx`
("onDragOver reflow does not feed itself" describe block, 4 tests).

**How to apply:** If a future DnD change flips `measuring` to Always, removes any of
guards 2-4, or the "does not feed itself" tests disappear, treat it as a reload
blocker — the failure mode is a fully dead drag layer, not a subtle glitch.
