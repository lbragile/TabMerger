import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useGroups, useMergeGroups, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState, getSetting, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import type { GroupsState, UrlRule } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// ponytail: real IndexedDB, no vi.mock('@/lib/localDb') — the merge must persist for real.

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

async function seed(): Promise<void> {
  const nowOpen = createNowOpenGroup()
  const a = createGroup('group-a', 'Group A')
  a.windows = [createWindow([createTab('A1', 'https://github.com/a')])]
  const b = createGroup('group-b', 'Group B')
  b.windows = [createWindow([createTab('B1', 'https://github.com/b')]), createWindow([createTab('B2', 'https://github.com/b2')])]
  const c = createGroup('group-c', 'Group C')
  c.windows = [createWindow([createTab('C1', 'https://example.com/c')])]
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, a, b, c] }
  await saveGroupsState(state)
}

describe('useMergeGroups — real IndexedDB integration', () => {
  beforeEach(async () => {
    await clearDb()
    useUIStore.setState({ undoStack: [], redoStack: [], activeGroupIndex: 3 })
  })

  it('persists the merged group, drops the others, retargets their URL rules and keeps the same group in view', async () => {
    await seed()
    const rules: UrlRule[] = [
      { id: 'r1', pattern: 'github.com/*', groupId: 'group-b', createdAt: 1 },
      { id: 'r2', pattern: 'example.com/*', groupId: 'group-c', createdAt: 2 }
    ]
    await setSetting('urlRules', rules)

    // The popup always has the groups cached: the merge reads the viewed group from there
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cached = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    const { result: groups } = renderHook(() => useGroups(), { wrapper: cached })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    expect(qc.getQueryData(GROUPS_QUERY_KEY)).toBeDefined()
    const { result } = renderHook(() => useMergeGroups(), { wrapper: cached })
    await result.current.mutateAsync(['group-a', 'group-b'])

    const state = await getGroupsState()
    expect(state.available.map((g) => g.id)).toEqual([state.available[0].id, 'group-a', 'group-c'])
    expect(state.available[0].permanent).toBe(true)
    const merged = state.available[1]
    expect(merged.name).toBe('Group A')
    expect(merged.windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['A1', 'B1', 'B2'])
    expect(merged.pendingSync).toBe(true)

    // The rule of the merged-away group follows it; unrelated rules stay
    await expect.poll(async () => (await getSetting<UrlRule[]>('urlRules', [])).map((r) => r.groupId)).toEqual(['group-a', 'group-c'])

    // The viewed group (Group C) moved from index 3 to 2
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('writes nothing when fewer than two groups can be merged', async () => {
    await seed()
    const before = await getGroupsState()

    const { result } = renderHook(() => useMergeGroups(), { wrapper })
    await result.current.mutateAsync(['group-a', 'missing', before.available[0].id])

    const after = await getGroupsState()
    expect(after.available.map((g) => g.id)).toEqual(before.available.map((g) => g.id))
    expect(after.available[1].updatedAt).toBe(before.available[1].updatedAt)
  })
})
