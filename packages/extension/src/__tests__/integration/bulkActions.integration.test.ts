import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useBulkDelete } from '@/hooks/useBulkActions'
import { useGroups } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import type { GroupsState } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// ponytail: real IndexedDB, no vi.mock('@/lib/localDb') — bulk delete must persist for real.

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

async function seed(): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  const groupA = createGroup('group-a', 'Group A')
  groupA.windows = [createWindow([createTab('Tab 1', 'https://a.example.com')])]
  const groupB = createGroup('group-b', 'Group B')
  groupB.windows = [createWindow([createTab('Tab 2', 'https://b.example.com')])]

  const state: GroupsState = {
    active: { id: nowOpen.id, index: 0 },
    available: [nowOpen, groupA, groupB],
  }
  await saveGroupsState(state)
  return state
}

describe('useBulkDelete — real IndexedDB integration', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('persists bulk group deletion to real IndexedDB and preserves Now Open', async () => {
    await seed()

    const { result: bulkDelete } = renderHook(() => useBulkDelete(), { wrapper })
    await bulkDelete.current.mutateAsync([
      { id: 'group-2', type: 'group' }, // groupB at index 2
    ])

    const state = await getGroupsState()
    expect(state.available).toHaveLength(2)
    expect(state.available.some((g) => g.id === 'group-b')).toBe(false)
    expect(state.available[0].permanent).toBe(true)
    expect(state.available.some((g) => g.id === 'group-a')).toBe(true)
  })

  it('refuses to bulk-delete the permanent Now Open group even when targeted', async () => {
    await seed()

    const { result: bulkDelete } = renderHook(() => useBulkDelete(), { wrapper })
    await bulkDelete.current.mutateAsync([{ id: 'group-0', type: 'group' }])

    const state = await getGroupsState()
    expect(state.available).toHaveLength(3)
    expect(state.available[0].permanent).toBe(true)
  })

  it('persists bulk tab deletion to real IndexedDB', async () => {
    const seeded = await seed()
    const groupAIndex = seeded.available.findIndex((g) => g.id === 'group-a')

    const { result: groups } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))

    const { result: bulkDelete } = renderHook(() => useBulkDelete(), { wrapper })
    await bulkDelete.current.mutateAsync([
      { id: `tab-${groupAIndex}-0-0`, type: 'tab' },
    ])

    const state = await getGroupsState()
    const groupA = state.available.find((g) => g.id === 'group-a')
    // groupA only had one window, so the (now-empty) window is kept rather than auto-closed
    // — the "drop empty window" rule only kicks in when the group has more than one window.
    expect(groupA?.windows).toHaveLength(1)
    expect(groupA?.windows[0].tabs).toHaveLength(0)
  })
})
