import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AUTO_ITEM_COLORS } from '@tabmerger/shared'
import { useSaveClosedToGroup, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, getSessions, markSessionUploaded, saveGroupsState, saveSession, updateGroupsState, updateSessionColor } from '@/lib/localDb'
import { addRecentlyClosedEntry, getRecentlyClosedEntries } from '@/lib/recentlyClosedDb'
import { ClosedSaveTargetGoneError } from '@/lib/recentlyClosedSave'
import { RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'
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

describe('useSaveClosedToGroup — the menu was opened on an older state', () => {
  beforeEach(async () => {
    await clearDb()
    useUIStore.setState({ undoStack: [], redoStack: [] })
  })

  it.each([
    ['deleted', (g: GroupsState) => ({ ...g, available: g.available.filter((x) => x.id !== 'g0') })],
    ['archived', (g: GroupsState) => ({ ...g, available: g.available.map((x) => (x.id === 'g0' ? { ...x, archived: true } : x)) })],
  ])('the picked group was %s after the menu opened: rejects ClosedSaveTargetGoneError, writes nothing, no undo step', async (_how, change) => {
    const menuState = await seed()
    await updateGroupsState((fresh) => change(fresh))
    const before = await getGroupsState()
    const { wrapper } = client(menuState)
    const { result } = renderHook(() => useSaveClosedToGroup(), { wrapper })
    const undoBefore = useUIStore.getState().undoStack.length
    await expect(
      result.current.mutateAsync({ entries: [entry('t', 'tab', ['https://a.example'])], target: { groupId: 'g0' } })
    ).rejects.toBeInstanceOf(ClosedSaveTargetGoneError)
    expect(await getGroupsState()).toEqual(before)
    expect(useUIStore.getState().undoStack.length).toBe(undoBefore)
  })

  it('a group write that landed between menu open and save is kept, and the tab goes to the picked group by id', async () => {
    const menuState = await seed(2)
    // another context adds a tab to the target AND moves it to the end, after the menu opened
    await updateGroupsState((fresh) => {
      const g0 = fresh.available.find((x) => x.id === 'g0')!
      const edited = { ...g0, windows: [{ ...g0.windows[0], tabs: [...g0.windows[0].tabs, createTab('Concurrent', 'https://concurrent.example')] }] }
      return { ...fresh, available: [fresh.available[0], fresh.available.find((x) => x.id === 'g1')!, edited] }
    })
    const { wrapper } = client(menuState)
    const { result } = renderHook(() => useSaveClosedToGroup(), { wrapper })
    await result.current.mutateAsync({ entries: [entry('t', 'tab', ['https://saved.example'])], target: { groupId: 'g0' } })
    const stored = await getGroupsState()
    const g0 = stored.available.find((x) => x.id === 'g0')!
    expect(g0.windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual(['https://existing0.example', 'https://concurrent.example', 'https://saved.example'])
    expect(stored.available.find((x) => x.id === 'g1')!.windows.flatMap((w) => w.tabs).map((t) => t.url)).toEqual(['https://existing1.example'])
  })

  it('the recently closed entry is still in the list after it was saved into a group', async () => {
    const state = await seed()
    const closed = entry('rc1', 'tab', ['https://keep-me.example'])
    await addRecentlyClosedEntry({ ...closed, tabs: closed.tabs.map(({ url, title }) => ({ url, title })) }, RECENTLY_CLOSED_LIMITS.pro)
    const { wrapper } = client(state)
    const { result } = renderHook(() => useSaveClosedToGroup(), { wrapper })
    await result.current.mutateAsync({ entries: [closed], target: { groupId: 'g0' } })
    expect((await getRecentlyClosedEntries()).map((e) => e.id)).toEqual(['rc1'])
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

  it('updateSessionColor refuses an automatic backup and marks the upload token in the same write', async () => {
    await saveSession(session('auto', { auto: true }))
    expect(await updateSessionColor('auto', AUTO_ITEM_COLORS[1], 5)).toBeNull()
    expect((await getSessions())[0].color).toBeUndefined()
    await saveSession(session('m'))
    expect(await updateSessionColor('m', AUTO_ITEM_COLORS[1], 5)).toMatchObject({ color: AUTO_ITEM_COLORS[1], uploadPending: 5 })
    expect((await getSessions()).find((x) => x.id === 'm')).toMatchObject({ uploadPending: 5 })
  })

  it('markSessionUploaded clears only the token it uploaded; a newer change keeps its mark', async () => {
    await saveSession(session('m', { uploadPending: 2 }))
    await markSessionUploaded('m', 100, 1)
    expect((await getSessions())[0]).toMatchObject({ uploadedAt: 100, uploadPending: 2 })
    await markSessionUploaded('m', 200, 2)
    const [after] = await getSessions()
    expect(after.uploadedAt).toBe(200)
    expect(after.uploadPending).toBeUndefined()
    // never re-creates a session that is gone
    await markSessionUploaded('gone', 300, 1)
    expect((await getSessions()).map((x) => x.id)).toEqual(['m'])
  })

  it('updateSessionColor never re-creates a session deleted meanwhile', async () => {
    expect(await updateSessionColor('gone', AUTO_ITEM_COLORS[1])).toBeNull()
    expect(await getSessions()).toEqual([])
  })
})
