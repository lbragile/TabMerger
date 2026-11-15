import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AUTO_ITEM_COLORS } from '@tabmerger/shared'
import { useSaveClosedToGroup, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, getSessions, saveGroupsState, saveSession, updateSessionColor } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createTab, createWindow } from '@/lib/utils'
import type { GroupsState, Session } from '@/lib/types'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { FreeLimitExceededError } from '@/lib/tierLimits'
import { useUIStore } from '@/stores/uiStore'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb). "Save to group…" from Recently closed goes through the same
// groups write as every other save (pending sync, one undo step, Free backstop), and a session's
// colour is checked when read and only ever set on a session that still exists.

vi.mock('@/lib/toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }))

const entry = (id: string, kind: 'tab' | 'window', urls: string[]): RecentlyClosedEntry => ({
  id,
  closedAt: Date.now(),
  kind,
  tabs: urls.map((url) => ({ url, title: `Title ${url}`, favIconUrl: 'https://x.example/f.ico', pinned: true })),
})

function client(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

async function seed(savedGroups = 1): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  const groups = Array.from({ length: savedGroups }, (_, i) => {
    const g = createGroup(`g${i}`, `Group ${i}`)
    g.windows = [createWindow([createTab('Existing', `https://existing${i}.example`)])]
    g.pendingSync = false
    return g
  })
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] }
  await saveGroupsState(state)
  return getGroupsState()
}

describe('useSaveClosedToGroup — real IndexedDB', () => {
  beforeEach(async () => {
    await clearDb()
    useUIStore.setState({ undoStack: [], redoStack: [] })
  })

  it('a closed tab lands in the group as a saved tab (id 0, no pin), pending sync, one undo step', async () => {
    const state = await seed()
    const { wrapper } = client(state)
    const { result } = renderHook(() => useSaveClosedToGroup(), { wrapper })
    const undoBefore = useUIStore.getState().undoStack.length

    await result.current.mutateAsync({ entries: [entry('t', 'tab', ['https://github.com/pr/1'])], target: { groupId: 'g0' } })

    const stored = (await getGroupsState()).available.find((g) => g.id === 'g0')!
    expect(stored.pendingSync).toBe(true)
    const tabs = stored.windows.flatMap((w) => w.tabs)
    expect(tabs.map((t) => t.url)).toEqual(['https://existing0.example', 'https://github.com/pr/1'])
    expect(tabs[1]).toMatchObject({ id: 0, title: 'Title https://github.com/pr/1' })
    expect(tabs[1].pinned).toBeUndefined()
    expect(tabs[1].savedAt).toEqual(expect.any(Number))
    expect(useUIStore.getState().undoStack.length).toBe(undoBefore + 1)
  })

  it('a window entry into a new group named after the site', async () => {
    const state = await seed()
    const { wrapper } = client(state)
    const { result } = renderHook(() => useSaveClosedToGroup(), { wrapper })
    await result.current.mutateAsync({ entries: [entry('w', 'window', ['https://figma.com/a', 'https://figma.com/b'])], target: { newGroupName: 'figma.com' } })
    const groups = (await getGroupsState()).available
    const created = groups[groups.length - 1]
    expect(created.name).toBe('figma.com')
    expect(created.pendingSync).toBe(true)
    expect(created.windows).toHaveLength(1)
    expect(created.windows[0].tabs.map((t) => t.url)).toEqual(['https://figma.com/a', 'https://figma.com/b'])
  })

  it('Free: a new group over the 5-group limit is refused before anything is written', async () => {
    const state = await seed(5)
    const { wrapper } = client(state)
    const { result } = renderHook(() => useSaveClosedToGroup({ maxGroups: 5, maxTabs: 50 }), { wrapper })
    await expect(
      result.current.mutateAsync({ entries: [entry('t', 'tab', ['https://a.example'])], target: { newGroupName: 'a.example' } })
    ).rejects.toBeInstanceOf(FreeLimitExceededError)
    expect((await getGroupsState()).available).toHaveLength(6)
  })

  it('Free: tabs over the 50-tab limit are refused', async () => {
    const state = await seed(1)
    const { wrapper } = client(state)
    const { result } = renderHook(() => useSaveClosedToGroup({ maxGroups: 5, maxTabs: 50 }), { wrapper })
    const urls = Array.from({ length: 50 }, (_, i) => `https://t${i}.example`)
    await expect(result.current.mutateAsync({ entries: [entry('w', 'window', urls)], target: { groupId: 'g0' } })).rejects.toBeInstanceOf(FreeLimitExceededError)
    expect((await getGroupsState()).available[1].windows).toHaveLength(1)
  })
})

describe('session colours — real IndexedDB', () => {
  beforeEach(async () => {
    await clearDb()
  })

  const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id, groups: [], createdAt: Date.now(), ...extra })

  it('a stored colour outside the palette is dropped when read; a palette colour is kept', async () => {
    await saveSession(session('bad', { color: 'url(javascript:alert(1))' }))
    await saveSession(session('good', { color: AUTO_ITEM_COLORS[4] }))
    const byId = Object.fromEntries((await getSessions()).map((s) => [s.id, s]))
    expect('color' in byId.bad).toBe(false)
    expect(byId.good.color).toBe(AUTO_ITEM_COLORS[4])
  })

  it('updateSessionColor changes only that field of a stored session', async () => {
    await saveSession(session('s', { description: 'd', auto: undefined }))
    const updated = await updateSessionColor('s', AUTO_ITEM_COLORS[9])
    expect(updated).toMatchObject({ id: 's', description: 'd', color: AUTO_ITEM_COLORS[9] })
    expect((await getSessions())[0]).toMatchObject({ id: 's', description: 'd', color: AUTO_ITEM_COLORS[9] })
  })

  it('updateSessionColor never re-creates a session deleted meanwhile', async () => {
    expect(await updateSessionColor('gone', AUTO_ITEM_COLORS[1])).toBeNull()
    expect(await getSessions()).toEqual([])
  })
})
