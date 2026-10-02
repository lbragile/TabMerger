---
name: test-mocks-follow-hook-usage
description: Any test that mocks @/hooks/useGroups and renders GroupContextMenu (or WindowsPanel) must be updated whenever that component starts consuming a new hook — the mock module has no fallback and throws.
metadata:
  type: feedback
---

When a component under test (`GroupContextMenu.tsx`, `Windows/index.tsx`, `Window.tsx`) starts
calling a new hook from `@/hooks/useGroups`, every test file that does its own
`vi.mock('@/hooks/useGroups', () => ({ ... }))` for that component must add a mock for the new
hook — there is no `importOriginal`/passthrough fallback in these mocks, so a missing export
throws `No "useXyz" export is defined on the "@/hooks/useGroups" mock` at render time, not at
type-check time.

**Why:** caught while consolidating the popup's group menus (making the toolbar ⋯ a subset of the context menu) — adding
`useDeleteAllWindows()` to `GroupContextMenu.tsx` broke
`src/__tests__/unit/components/Windows/confirmOnDelete.test.tsx`, which renders
`GroupContextMenu` directly but wasn't in the plan's list of "tests that will break" because
nobody had grepped for *every* test that mocks `@/hooks/useGroups` and touches that component —
only the ones with existing assertions on the changed strings/handlers were listed.

**How to apply:** before adding a new `useXyz()` call to a component, grep the whole
`__tests__/` tree for `vi.mock('@/hooks/useGroups'` AND the component's name/import together,
not just for the specific label or handler strings you expect to change. `pnpm --filter
@tabmerger/extension test -- --run` will catch it immediately (component throws on mount), so
always do a full test run after adding a hook call — don't rely on a plan's predicted
breakage list being exhaustive.

**Recurred 2026-09-23** moving `handleSaveSession` from `Header.tsx` into `SidePanel/index.tsx`
(the same popup UI consolidation): adding `useSaveSession()` to `SidePanel` broke three files that each hand-roll
their own `vi.mock('@/hooks/useSessions', ...)` — `sidePanelUnifiedDnd.test.tsx`,
`sidePanelSections.test.tsx`, and the shared `sidePanelAndHeader.test.tsx` — none of which had
`useSaveSession` in their mock (it previously only mattered for `Header`). Same failure mode,
not hook-specific to `useGroups`: any hand-rolled `vi.mock` of a hooks module with no
`importOriginal` fallback needs a matching export added whenever the component under test picks
up a new call to that module, regardless of which hooks file it is. Also: when relocating a
handler+its tests between two sibling components (Header → SidePanel here), don't delete the
old describe block — repoint it at the new component and add a short "no longer renders X"
assertion on the old one, so both "moved to" and "removed from" are locked by tests.
