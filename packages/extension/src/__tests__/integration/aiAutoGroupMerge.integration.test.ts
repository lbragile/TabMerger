import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { GROUPS_QUERY_KEY, useApplyAIGroups } from '@/hooks/useGroups'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { clearDb } from './dbTestUtils'

/**
 * Auto-group into a group that already exists, against real IndexedDB (fake-indexeddb): the
 * suggestion "youtube" lands in the stored "YouTube" group as one new window (no second
 * "YouTube" group, the duplicate URL not stored twice), a new name still makes a new group, and
 * the whole apply is ONE undo step that restores the stored groups exactly.
 */

// `savedAt` on saved tabs: without it the first read runs the savedAt migration write mid-test
const saved = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const live = (title: string, id: number): Tab => ({ id, title, url: `https://example.com/${title}` })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false })
const group = (id: string, name: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id, name, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, pendingSync: false, ...over
})
const savedView = (s: GroupsState) =>
  s.available.filter((g) => !g.permanent).map((g) => ({ id: g.id, name: g.name, windows: g.windows.map((w) => w.tabs.map((t) => t.title)) }))

async function setup(state: GroupsState) {
  await saveGroupsState(state)
  const stored = await getGroupsState()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, stored)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ apply: useApplyAIGroups({ maxGroups: 2, maxTabs: 50 }), history: useUndoRedo() }), { wrapper })
  return { result }
}

beforeEach(async () => {
  await clearDb()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

describe('Auto-group into an existing same-named group — real IndexedDB', () => {
  it('adds to the stored group instead of duplicating it, then one Undo restores the stored groups', async () => {
    const seed: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [
        group('now', 'Now Open', [win([live('yt1', 41), live('yt2', 42), live('docs', 43)])], { permanent: true }),
        group('yt', 'YouTube', [win([saved('yt1')])]),
      ]
    }
    const { result } = await setup(seed)
    const before = savedView(await getGroupsState())

    let counts: Awaited<ReturnType<typeof result.current.apply.mutateAsync>> | undefined
    await act(async () => {
      // Free plan with 1 of 2 group slots used: one new group fits, the merge needs no slot
      counts = await result.current.apply.mutateAsync([
        { name: 'youtube', color: 'rgba(1,1,1,1)', tabIds: [41, 42] },
        { name: 'Docs', color: 'rgba(2,2,2,1)', tabIds: [43] },
      ])
    })
    expect(counts).toEqual({ createdGroups: 1, mergedGroups: 1, appliedTabs: 2 })

    const stored = await getGroupsState()
    const view = savedView(stored)
    expect(view.filter((g) => g.name.toLowerCase() === 'youtube')).toHaveLength(1)
    expect(view[0]).toEqual({ id: 'yt', name: 'YouTube', windows: [['yt1'], ['yt2']] })
    expect(view[1]).toMatchObject({ name: 'Docs', windows: [['docs']] })
    expect(stored.available.find((g) => g.id === 'yt')?.pendingSync).toBe(true)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    await waitFor(() => expect(result.current.history.canUndo).toBe(true))

    await act(async () => {
      await result.current.history.undo()
    })
    expect(savedView(await getGroupsState())).toEqual(before)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })
})
