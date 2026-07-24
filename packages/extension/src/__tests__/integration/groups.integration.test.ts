import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useGroups,
  useAddGroup,
  useUpdateGroupName,
  useDeleteGroup,
} from '@/hooks/useGroups'
import { getGroupsState } from '@/lib/localDb'
import { clearDb } from './dbTestUtils'

// ponytail: no vi.mock('@/lib/localDb') anywhere in this file — these hooks hit real
// IndexedDB (fake-indexeddb, see integration/setup.ts) so we exercise real transactions.

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useGroups — real IndexedDB integration', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('creates, renames, and deletes a group, persisting through real IndexedDB round trips', async () => {
    const { result: groups } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))

    // Seed: only Now Open should exist initially
    expect(groups.current.data?.available).toHaveLength(1)
    expect(groups.current.data?.available[0].permanent).toBe(true)

    const { result: addGroup } = renderHook(() => useAddGroup(), { wrapper })
    await addGroup.current.mutateAsync({ name: 'Research' })

    let state = await getGroupsState()
    expect(state.available).toHaveLength(2)
    const newGroupIndex = state.available.findIndex((g) => g.name === 'Research')
    expect(newGroupIndex).toBeGreaterThan(-1)

    const { result: renameGroup } = renderHook(() => useUpdateGroupName(), { wrapper })
    await renameGroup.current.mutateAsync({ groupIndex: newGroupIndex, name: 'Renamed Group' })

    state = await getGroupsState()
    expect(state.available[newGroupIndex].name).toBe('Renamed Group')

    const { result: deleteGroup } = renderHook(() => useDeleteGroup(), { wrapper })
    await deleteGroup.current.mutateAsync(newGroupIndex)

    state = await getGroupsState()
    expect(state.available).toHaveLength(1)
    expect(state.available.some((g) => g.name === 'Renamed Group')).toBe(false)
  })

  it('keeps the Now Open group at index 0, permanent, and un-deletable across real read/write cycles', async () => {
    // First read creates Now Open from scratch (empty DB)
    let state = await getGroupsState()
    expect(state.available).toHaveLength(1)
    expect(state.available[0].permanent).toBe(true)
    expect(state.available[0].name).toBeTruthy()
    const nowOpenId = state.available[0].id

    const { result: addGroup } = renderHook(() => useAddGroup(), { wrapper })
    await addGroup.current.mutateAsync({ name: 'Other Group' })

    const { result: deleteGroup } = renderHook(() => useDeleteGroup(), { wrapper })
    // Attempt to delete Now Open (index 0) — must be silently rejected
    await deleteGroup.current.mutateAsync(0)

    state = await getGroupsState()
    expect(state.available[0].id).toBe(nowOpenId)
    expect(state.available[0].permanent).toBe(true)
    expect(state.available.some((g) => g.id === nowOpenId)).toBe(true)
    // The non-permanent group is untouched since we tried to delete index 0, not it
    expect(state.available.some((g) => g.name === 'Other Group')).toBe(true)
  })
})
