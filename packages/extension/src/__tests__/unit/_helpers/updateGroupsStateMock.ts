import type { GroupsState } from '@/lib/types'

type GetFn = () => Promise<GroupsState>
type SaveFn = (state: GroupsState) => Promise<unknown>

/**
 * Adds an `updateGroupsState` to a `vi.mock('@/lib/localDb', ...)` factory object, built on the
 * object's own `getGroupsState` / `saveGroupsState` mocks (looked up at CALL time, so per-test
 * `mockResolvedValue` / call assertions on those two still work). Mirrors the real contract:
 * `fn` gets the current state; `null` skips the write; the result is saved and returned.
 */
export function withUpdateGroupsState<T extends { getGroupsState?: unknown; saveGroupsState?: unknown }>(mock: T) {
  const updateGroupsState = async (fn: (current: GroupsState) => GroupsState | null): Promise<GroupsState> => {
    const current = await (mock.getGroupsState as GetFn)()
    const next = fn(current)
    if (!next) return current
    await (mock.saveGroupsState as SaveFn)(next)
    return next
  }
  return { ...mock, updateGroupsState }
}
