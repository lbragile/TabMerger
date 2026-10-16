import type { GroupsState } from '@/lib/types'

type GetFn = () => Promise<GroupsState>
type SaveFn = (state: GroupsState) => Promise<unknown>

/**
 * Adds an `updateGroupsState` to a `vi.mock('@/lib/localDb', ...)` factory object, built on the
 * object's own `getGroupsState` / `saveGroupsState` mocks (looked up at CALL time, so per-test
 * `mockResolvedValue` / call assertions on those two still work). Mirrors the real contract:
 * `fn` gets the current state; `null` skips the write; the result is saved and returned, and
 * `afterWrite(stored, base)` (where the undo step is recorded) runs once it is saved.
 */
export function withUpdateGroupsState<T extends { getGroupsState?: unknown; saveGroupsState?: unknown }>(mock: T) {
  const updateGroupsState = async (
    fn: (current: GroupsState) => GroupsState | null,
    opts: { afterWrite?: (stored: GroupsState, base: GroupsState) => void } = {}
  ): Promise<GroupsState> => {
    const current = await (mock.getGroupsState as GetFn)()
    const next = fn(current)
    if (!next) return current
    await (mock.saveGroupsState as SaveFn)(next)
    opts.afterWrite?.(next, current)
    return next
  }
  return { ...mock, updateGroupsState }
}
