# Deleting a hook export leaves stale `vi.mock` factory keys that no check catches

**[2026-09] Unified DnD rewrite.** `hooks/useDnd.ts` deleted `useGroupDndHandlers`,
`useWindowDndHandlers`, `parseDndId`, `parseLegacyDndId`. Non-test `src/` was fully
clean afterward, but four unit test files still had these names as keys inside
`vi.mock('@/hooks/useDnd', () => ({ ... }))` factory objects:

- `src/__tests__/unit/components/sidePanelAndHeader.test.tsx`
- `src/__tests__/unit/components/SidePanel/sidePanelSections.test.tsx`
- `src/__tests__/unit/components/SidePanel/sidePanelUnifiedDnd.test.tsx`
- `src/__tests__/unit/components/Windows/windowsPanelToolbar.test.tsx`

**Why it's a trap:** `vi.mock` factory return values are NOT type-checked against
the real module, so `pnpm type-check` stays green. `wxt build` never touches test
files. The smoke test's grep (check 3) is the *only* gate that surfaces them, and
they read as "expected" because they're inside test files. They are harmless to a
Chrome reload but are dead config that will rot further with each DnD change.

**How to apply:** When check 3 (grep for removed DnD identifiers) hits only test
files, don't wave it through as "comments/mocks, fine." Separate the three cases:
(a) comments / `describe` strings — genuinely fine; (b) `parseDndId` regression-guard
assertions (`expect(mod.parseDndId).toBeUndefined()`) — intentional, keep; (c) live
keys in a `vi.mock` factory object — stale, report as test-cleanup debt with
file:line. Route the cleanup to `test-writer`, not a blocker for reload.
