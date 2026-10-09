import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useMoveWindow, useGroups, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// ponytail: real IndexedDB (fake-indexeddb), no vi.mock('@/lib/localDb'). "Copy to group" on a
// Now Open window must persist a DETACHED saved copy in the target and leave Now Open's live
// window alone.

function liveTab(id: number, url: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: url, url, favIconUrl: '', pinned: false, ...extra }
}

function makeClient(state?: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (state) qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

async function seed(): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  const live: ExtWindow = {
    id: 901,
    tabs: [liveTab(11, 'https://a.example.com', { pinned: true }), liveTab(12, 'https://b.example.com')],
    incognito: false,
    focused: true,
    starred: true,
  }
  const other: ExtWindow = { id: 902, tabs: [liveTab(13, 'https://c.example.com')], incognito: false, focused: false }
  nowOpen.windows = [live, other]
  nowOpen.updatedAt = 5
  const target = createGroup('target', 'Target')
  target.windows = []
  target.updatedAt = 1
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, target] }
  await saveGroupsState(state)
  return state
}

describe('useMoveWindow Now Open "Copy to group" — real IndexedDB integration', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('persists a detached copy (tab ids 0, savedAt set) in the target and leaves Now Open untouched, across a store reload', async () => {
    const state = await seed()
    const nowOpenBefore = structuredClone((await getGroupsState()).available[0])
    const { wrapper } = makeClient(state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })

    // Reload from IndexedDB itself, not from the query cache.
    const reloaded = await getGroupsState()
    const target = reloaded.available[1]
    expect(target.windows).toHaveLength(1)
    const copy = target.windows[0]
    expect(copy.id).toBe(0)
    expect(copy.focused).toBe(false)
    expect(copy.starred).toBe(false)
    expect(copy.tabs.map((t) => t.url)).toEqual(['https://a.example.com', 'https://b.example.com'])
    for (const t of copy.tabs) {
      expect(t.id).toBe(0)
      expect(typeof t.savedAt).toBe('number')
      expect(t.pinned).toBeFalsy()
    }
    expect(target.pendingSync).toBe(true)
    expect(target.updatedAt).toBeGreaterThan(1)

    // Now Open: same windows, same live ids, not marked for sync, not re-stamped.
    expect(reloaded.available[0].permanent).toBe(true)
    expect(reloaded.available[0].windows).toEqual(nowOpenBefore.windows)
    expect(reloaded.available[0].windows.map((w) => w.id)).toEqual([901, 902])
    expect(reloaded.available[0].updatedAt).toBe(5)
    expect(reloaded.available[0].pendingSync).toBeFalsy()
  })

  it('a fresh app session (new QueryClient, useGroups) reads the same copy back', async () => {
    const state = await seed()
    const { wrapper } = makeClient(state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })
    await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 1, toGroupIndex: 1 })

    const fresh = makeClient()
    const { result: groups } = renderHook(() => useGroups(), { wrapper: fresh.wrapper })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    const data = groups.current.data!
    expect(data.available[0].windows).toHaveLength(2)
    expect(data.available[1].windows).toHaveLength(1)
    expect(data.available[1].windows[0].tabs[0]).toMatchObject({ id: 0, url: 'https://c.example.com' })
  })

  it('copying twice yields two independent saved windows while Now Open still holds the one live window', async () => {
    const state = await seed()
    const { wrapper } = makeClient(state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })
    await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })

    const reloaded = await getGroupsState()
    expect(reloaded.available[1].windows).toHaveLength(2)
    expect(reloaded.available[0].windows).toHaveLength(2)
  })
})
