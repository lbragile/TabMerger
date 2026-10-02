---
name: vitest-hoisting
description: const variables referenced in vi.mock factories cause TDZ errors — use vi.hoisted() instead
metadata:
  type: feedback
---

Any `const mockX = vi.fn()` declared at module level and referenced inside a `vi.mock(...)` factory will throw `ReferenceError: Cannot access 'mockX' before initialization` at test time. This is because vitest hoists `vi.mock` calls to the top of the file, before `const` declarations are initialized.

**Fix:** use `vi.hoisted()` to declare all such variables:

```ts
const { mockToastError, mockUseGroups } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUseGroups: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: mockToastError } }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
```

**Why:** `vi.hoisted()` runs before `vi.mock` factories are evaluated, so the variables are initialized in time.

**How to apply:** Always use `vi.hoisted()` when a test file needs to capture a reference to a mock function for later assertion (e.g., `expect(mockX).toHaveBeenCalled()`). If you only need `vi.fn()` inline without capturing the reference, the issue doesn't arise.

Related: [[learnings_supabase_mock]]
