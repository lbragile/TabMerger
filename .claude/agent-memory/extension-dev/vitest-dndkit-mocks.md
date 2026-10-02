---
name: vitest-dndkit-mocks
description: vitest v4 throws on reading an undefined named export from a factory mock — bit the DnD rework via @dnd-kit/core
metadata:
  type: feedback
---

Under vitest v4, `vi.mock('@dnd-kit/core', () => ({ ...partial }))` makes the module
namespace throw on ANY read of a key the factory omitted ("No X export is defined on
the mock. Did you forget to return it from vi.mock?"), NOT return `undefined`.

**Why it bit us:** `DndProvider.tsx` had `const measuring = MeasuringStrategy ? ... : undefined`.
Several existing test files (`windowsPanelToolbar`, `dnd`, `windowsDnd`, `unifiedDnd`)
mock `@dnd-kit/core` without `MeasuringStrategy`, so the guard itself threw and every
`WindowsPanel` render crashed.

**How to apply:**
- Don't reference potentially-absent `@dnd-kit/core` value exports at module scope or
  in render. `MeasuringStrategy.Always === 0` — hardcode `measuring={{ droppable: { strategy: 0 } }}`.
- Value exports referenced ONLY inside a function body that the mock never invokes
  (e.g. a custom `collisionDetection` passed to a mocked `<DndContext>` that ignores it)
  are safe — the binding is read lazily at call time, not at import.
- The import statement itself does not throw; only the read does.
- Same class of failure bites `vi.mock('@/stores/uiStore', () => ({ useUIStore: (sel) => sel(state) }))`:
  such mocks have NO `.getState`. Any hook that calls `useUIStore.getState()` throws
  "not a function" in those suites. Read store slices via the selector form
  (`useUIStore((s) => s.x) ?? fallback`) in hook bodies instead of `getState()`.
