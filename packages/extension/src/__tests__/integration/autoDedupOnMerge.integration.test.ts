/**
 * "Auto-deduplicate on merge" against real IndexedDB: the setting is saved the way Settings saves
 * it, read back by the merge from storage (nothing cached), and the merged group is persisted
 * without repeated URLs only when it is on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useMergeGroups, useMergeWithCurrent, useUniteWindows, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { DEFAULT_APP_SETTINGS, useSaveAppSettings } from '@/hooks/useAppSettings'
import { getGroupsState, saveGroupsState, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Tab } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// ponytail: real IndexedDB, no vi.mock('@/lib/localDb') — the setting and the merge both persist.

const saved = (title: string, url: string): Tab => ({ ...createTab(title, url), id: 0 })

async function seed(): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  nowOpen.windows = [createWindow([createTab('Docs', 'https://docs.example.com/'), createTab('News', 'https://news.example.com/')])]
  const a = createGroup('group-a', 'Group A')
  a.windows = [createWindow([{ ...saved('Docs', 'https://DOCS.example.com'), note: 'read later' }, saved('Mail', 'https://mail.example.com/')])]
  const b = createGroup('group-b', 'Group B')
  b.windows = [createWindow([saved('Mail', 'https://mail.example.com/'), saved('Wiki', 'https://wiki.example.com/')]), createWindow([saved('Mail', 'https://mail.example.com/')])]
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, a, b] }
  await saveGroupsState(state)
  return getGroupsState()
}

function client(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

const titles = (g: Group | undefined) => g?.windows.map((w) => w.tabs.map((t) => t.title))
const stored = async (id: string) => (await getGroupsState()).available.find((g) => g.id === id)

describe('Auto-deduplicate on merge — real IndexedDB', () => {
  beforeEach(async () => {
    await clearDb()
    useUIStore.setState({ undoStack: [], redoStack: [], activeGroupIndex: 1 })
  })

  it('off (nothing saved yet): Merge with current stores every copied tab', async () => {
    const { wrapper } = client(await seed())
    const { result } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await act(() => result.current.mutateAsync(1))
    expect(titles(await stored('group-a'))).toEqual([['Docs', 'News'], ['Docs', 'Mail']])
  })

  it('on (saved through Settings): Merge with current stores the group without the repeat, keeping its own tab and note', async () => {
    const { wrapper } = client(await seed())
    const { result: save } = renderHook(() => useSaveAppSettings(), { wrapper })
    await act(() => save.current.mutateAsync({ ...DEFAULT_APP_SETTINGS, autoDedupOnMerge: true }))

    const { result } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await act(() => result.current.mutateAsync(1))
    const a = await stored('group-a')
    expect(titles(a)).toEqual([['News'], ['Docs', 'Mail']])
    expect(a?.windows[1].tabs[0].note).toBe('read later')
    expect(a?.pendingSync).toBe(true)
    // Now Open is untouched and still first
    const state = await getGroupsState()
    expect(state.available[0].permanent).toBe(true)
    expect(titles(state.available[0])).toEqual([['Docs', 'News']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('on (read from storage, nothing cached): Merge groups and Unite windows store no repeats', async () => {
    await setSetting('appSettings', { ...DEFAULT_APP_SETTINGS, autoDedupOnMerge: true })
    const { wrapper } = client(await seed())
    const { result: unite } = renderHook(() => useUniteWindows(), { wrapper })
    await act(() => unite.current.mutateAsync(2))
    expect(titles(await stored('group-b'))).toEqual([['Mail', 'Wiki']])

    const { wrapper: fresh } = client(await getGroupsState())
    const { result: merge } = renderHook(() => useMergeGroups(), { wrapper: fresh })
    await act(() => merge.current.mutateAsync(['group-a', 'group-b']))
    expect(titles(await stored('group-a'))).toEqual([['Docs', 'Mail'], ['Wiki']])
    expect(await stored('group-b')).toBeUndefined()
  })

  it('off (saved off): Merge groups keeps every tab', async () => {
    await setSetting('appSettings', { ...DEFAULT_APP_SETTINGS, autoDedupOnMerge: false })
    const { wrapper } = client(await seed())
    const { result } = renderHook(() => useMergeGroups(), { wrapper })
    await act(() => result.current.mutateAsync(['group-a', 'group-b']))
    expect(titles(await stored('group-a'))).toEqual([['Docs', 'Mail'], ['Mail', 'Wiki'], ['Mail']])
  })
})
