import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { buildDndModel } from '@/hooks/useDndModel'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { clearDb } from './dbTestUtils'

/**
 * Undo/redo of a drag and drop, against real IndexedDB (fake-indexeddb): the drop, the undo and
 * the redo are each ONE step, and each restores the whole operation (both groups, the created
 * window) in the stored state, not only in the cache.
 */

// `savedAt` set: without it the groups query's first read runs the savedAt migration WRITE, a
// foreign write mid-test that makes the next undo's expected-rev check refuse it
const tab = (title: string, id = 0): Tab => ({ id, title, url: `https://example.com/${title}`, ...(id === 0 ? { savedAt: 1 } : {}) })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, pendingSync: false, ...over
})
const titles = (s: GroupsState, id: string) => s.available.find((g) => g.id === id)?.windows.map((w) => w.tabs.map((t) => t.title))

async function setup(state: GroupsState) {
  await saveGroupsState(state)
  const stored = await getGroupsState()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, stored)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ dnd: useDndHandlers(), history: useUndoRedo() }), { wrapper })
  return { qc, result, model: buildDndModel(stored) }
}

async function drag(
  result: { current: { dnd: ReturnType<typeof useDndHandlers> } },
  activeId: string,
  over: { id: string; data?: Record<string, unknown> }
) {
  await act(async () => {
    result.current.dnd.onDragStart({ active: { id: activeId, data: { current: undefined } }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
  })
  await act(async () => {
    await result.current.dnd.onDragEnd({
      active: { id: activeId, data: { current: undefined } },
      over: { id: over.id, data: { current: over.data } }
    } as unknown as DragEndEvent)
  })
}

beforeEach(async () => {
  await clearDb()
  clearDndDragLive()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

describe('undo/redo of a drop — real IndexedDB', () => {
  it('a cross-group drop into the new-window zone is ONE step; Undo restores both groups, Redo re-applies', async () => {
    const seed: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [], { permanent: true }), group('work', [win([tab('a1'), tab('a2')])]), group('play', [win([tab('p1')])])]
    }
    const { result, model } = await setup(seed)
    const a1 = model.windows[model.groups.work.windowIds[0]].tabIds[0]

    await drag(result, a1, { id: 'play::new-window', data: { type: 'new-window', groupId: 'play', groupIndex: 2 } })

    await waitFor(async () => expect(titles(await getGroupsState(), 'play')).toEqual([['p1'], ['a1']]))
    expect(titles(await getGroupsState(), 'work')).toEqual([['a2']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    await waitFor(() => expect(result.current.history.canUndo).toBe(true))

    await act(async () => {
      await result.current.history.undo()
    })
    const undone = await getGroupsState()
    expect(titles(undone, 'work')).toEqual([['a1', 'a2']])
    expect(titles(undone, 'play')).toEqual([['p1']])
    // the restore is a NEW local change, so the next sync pushes it rather than pulling the drop back
    expect(undone.available.find((g) => g.id === 'work')?.pendingSync).toBe(true)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)

    await act(async () => {
      await result.current.history.redo()
    })
    const redone = await getGroupsState()
    expect(titles(redone, 'work')).toEqual([['a2']])
    expect(titles(redone, 'play')).toEqual([['p1'], ['a1']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
  })

  it('a drag OUT of Now Open is one step: Undo removes the copy and reopens the tab, Redo closes exactly the reopened tab', async () => {
    const c = chrome as unknown as {
      tabs: Record<string, ReturnType<typeof vi.fn>>
      windows: Record<string, ReturnType<typeof vi.fn>>
    }
    c.tabs.get = vi.fn().mockRejectedValue(new Error('No tab with id')) // the dragged tab is closed
    c.tabs.create = vi.fn().mockResolvedValue({ id: 501 })
    c.tabs.remove = vi.fn().mockResolvedValue(undefined)
    c.windows.get = vi.fn().mockResolvedValue({ id: 7 })

    const seed: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [win([tab('live1', 41), tab('live2', 42)], { id: 7 })], { permanent: true }), group('work', [win([tab('a1')])])]
    }
    const { result, model } = await setup(seed)
    const live2 = model.windows[model.groups.now.windowIds[0]].tabIds[1]

    await drag(result, live2, { id: 'work', data: { type: 'group' } })
    await waitFor(async () => expect(titles(await getGroupsState(), 'work')).toEqual([['a1'], ['live2']]))
    expect(c.tabs.remove).toHaveBeenCalledWith([42])
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    await act(async () => {
      await result.current.history.undo()
    })
    expect(titles(await getGroupsState(), 'work')).toEqual([['a1']])
    // reopened where it was: same window, same position, in the background
    expect(c.tabs.create).toHaveBeenCalledWith({ windowId: 7, url: 'https://example.com/live2', index: 1, active: false, pinned: false })

    // Redo closes the REOPENED tab (id 501), and only that one
    c.tabs.get = vi.fn(async (id: number) => (id === 501 ? { id: 501, url: 'https://example.com/live2', windowId: 7, index: 1 } : Promise.reject(new Error('gone'))))
    c.tabs.remove.mockClear()
    await act(async () => {
      await result.current.history.redo()
    })
    expect(titles(await getGroupsState(), 'work')).toEqual([['a1'], ['live2']])
    expect(c.tabs.remove).toHaveBeenCalledTimes(1)
    expect(c.tabs.remove).toHaveBeenCalledWith([501])
  })
})
