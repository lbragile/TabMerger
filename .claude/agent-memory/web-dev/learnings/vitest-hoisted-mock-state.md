---
name: vitest-hoisted-mock-state
description: Vary a hoisted vi.mock's return value per test with a vi.hoisted mutable object, not vi.doMock + vi.doUnmock (doUnmock drops the hoisted mock too)
metadata:
  type: reference
---

To run one page test under several subscription rows (e.g. `it.each(['pro_ai','pro','free'])`), keep the
hoisted `vi.mock('@/lib/supabase/server', ...)` and have it read a `vi.hoisted(() => ({ tier: 'pro', ... }))`
object; each test sets the fields and `beforeEach` resets them. `DashboardHeader.test.tsx` does this.

Avoid `vi.doMock(...)` in a test followed by `vi.doUnmock(...)`: both share one registry, so the unmock
removes the path entirely and later tests in the file import the real module (a real Supabase client),
not the file's hoisted mock. If the test throws before the unmock, the override leaks instead.
The page is re-imported per test (`vi.resetModules()` in `beforeEach`), so the factory runs again and
picks up the mutated object.

Related: [[learnings_supabase_client_mock_shape]].
