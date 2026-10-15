/**
 * Every DnD drop that changes saved data is exactly ONE undo step and one Undo reverts the whole
 * drop (both groups, the created window or group); Redo re-applies it. That includes drops out of
 * and into Now Open: Undo of a drag-out reopens the closed tabs, Redo closes exactly the tabs Undo
 * reopened (by id). A move that stays inside Now Open is no step. Real useDndHandlers, uiStore and
 * useUndoRedo against an in-memory groups store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1 }))

vi.mock('@/lib/localDb', () => {
  const save = async (next: GroupsState, opts: { expectedRev?: number } = {}) => {
    if (opts.expectedRev !== undefined && opts.expectedRev !== store.rev) throw Object.assign(new Error('stale'), { name: 'StaleGroupsError' })
    store.rev += 1
    store.state = structuredClone({ ...next, rev: store.rev })
    return store.rev
  }
  return {
    getGroupsState: vi.fn(async () => structuredClone(store.state)),
    saveGroupsState: vi.fn(save),
    updateGroupsState: vi.fn(async (fn: (s: GroupsState) => GroupsState | null) => {
      const next = fn(structuredClone(store.state))
      if (next) await save(next)
      return structuredClone(store.state)
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue({})
  }
})
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn() } }))

import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { NEW_GROUP_ID } from '@/lib/dndMove'
import { historyEntryEffect } from '@/lib/undoLiveTabs'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import { useUIStore } from '@/stores/uiStore'

const tab = (title: string, id = 0): Tab => ({ id, title, url: `https://example.com/${title}`, savedAt: 1 })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, ...over })

const seed = (): GroupsState => ({
  active: { id: 'now', index: 0 },
  rev: 1,
  available: [
    group('now', [win([tab('live1', 41), tab('live2', 42)], { id: 7 })], { permanent: true }),
    group('work', [win([tab('a1'), tab('a2'), tab('a3')])]),
    group('play', [win([tab('p1')])])
  ]
})
const saved = (s: GroupsState) => s.available.filter((g) => !g.permanent).map((g) => [g.id, g.windows.map((w) => w.tabs.map((t) => t.title))])
const steps = () => useUIStore.getState().undoStack.length

type Fn = ReturnType<typeof vi.fn>
let c: { tabs: Record<string, Fn>; windows: Record<string, Fn>; runtime: Record<string, Fn> }
/** Browser tabs that exist now (id → url). */
let open: Map<number, string>

beforeEach(() => {
  vi.clearAllMocks()
  clearDndDragLive()
  store.state = seed()
  store.rev = 1
  open = new Map([[41, 'https://example.com/live1'], [42, 'https://example.com/live2']])
  let nextId = 500
  c = {
    tabs: {
      get: vi.fn(async (id: number) => {
        if (!open.has(id)) throw new Error('No tab')
        return { id, url: open.get(id), windowId: 7, index: 0 }
      }),
      create: vi.fn(async ({ url }: { url: string }) => {
        const id = nextId++
        open.set(id, url)
        return { id, url }
      }),
      remove: vi.fn(async (ids: number | number[]) => [ids].flat().forEach((id) => open.delete(id))),
      move: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([])
    },
    windows: {
      get: vi.fn().mockResolvedValue({ id: 7 }),
      getCurrent: vi.fn().mockResolvedValue({ id: 7 }),
      create: vi.fn(async ({ url }: { url: string | string[] }) => ({
        id: 8,
        tabs: [url].flat().map((u) => {
          const id = nextId++
          open.set(id, u)
          return { id, url: u }
        })
      }))
    },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), connect: vi.fn(() => ({ postMessage: vi.fn(), onDisconnect: { addListener: vi.fn() } })) }
  }
  vi.stubGlobal('chrome', c)
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

async function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, structuredClone(store.state))
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ dnd: useDndHandlers(), history: useUndoRedo() }), { wrapper })
  // let the groups query's mount read settle first: this in-memory store has no write-generation
  // re-read (the real localDb does), so a read that resolved after the drop would put the old state back
  await waitFor(() => expect(qc.isFetching()).toBe(0))
  const drop = async (activeId: string, overId: string, overData?: Record<string, unknown>, selectionIds?: string[]) => {
    const data = { current: selectionIds ? { selectionIds } : undefined }
    act(() => {
      result.current.dnd.onDragStart({ active: { id: activeId, data }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
    })
    await act(async () => {
      await result.current.dnd.onDragEnd({ active: { id: activeId, data }, over: { id: overId, data: { current: overData } } } as unknown as DragEndEvent)
    })
  }
  const undo = () => act(async () => { await result.current.history.undo() })
  const redo = () => act(async () => { await result.current.history.redo() })
  return { drop, undo, redo }
}

/** One step for the drop; Undo gives back exactly `before`; Redo gives back exactly the dropped state. */
async function expectOneStepRoundTrip(h: Awaited<ReturnType<typeof setup>>, run: () => Promise<void>) {
  const before = saved(store.state)
  await run()
  const after = saved(store.state)
  expect(after).not.toEqual(before)
  expect(steps()).toBe(1)
  await h.undo()
  expect(saved(store.state)).toEqual(before)
  expect(steps()).toBe(0)
  await h.redo()
  expect(saved(store.state)).toEqual(after)
  expect(steps()).toBe(1)
  return after
}

describe('saved-group drops: one step each, one Undo reverts the whole drop', () => {
  it('THE REPORTED CASE: a tab into ANOTHER group\'s new-window zone (two groups touched, a window created)', async () => {
    const h = await setup()
    const after = await expectOneStepRoundTrip(h, () => h.drop('work::w0::t0', 'play::new-window', { type: 'new-window', groupId: 'play', groupIndex: 2 }))
    expect(after).toEqual([['work', [['a2', 'a3']]], ['play', [['p1'], ['a1']]]])
  })

  it('two selected tabs into another group\'s new-window zone', async () => {
    useUIStore.setState({ selectionMode: true, selectedItems: [{ type: 'tab', id: 'tab-1-0-0' }, { type: 'tab', id: 'tab-1-0-2' }] })
    const h = await setup()
    const after = await expectOneStepRoundTrip(h, () =>
      h.drop('work::w0::t0', 'play::new-window', { type: 'new-window', groupId: 'play', groupIndex: 2 }, ['work::w0::t0', 'work::w0::t2'])
    )
    expect(after).toEqual([['work', [['a2']]], ['play', [['p1'], ['a1', 'a3']]]])
  })

  it('a tab onto a tab in its own window (reorder)', async () => {
    const h = await setup()
    await expectOneStepRoundTrip(h, () => h.drop('work::w0::t0', 'work::w0::t2'))
  })

  it('a window onto another group\'s row', async () => {
    const h = await setup()
    await expectOneStepRoundTrip(h, () => h.drop('work::w0', 'play', { type: 'group' }))
  })

  it('a group reorder', async () => {
    const h = await setup()
    await expectOneStepRoundTrip(h, () => h.drop('play', 'work'))
  })

  it('a tab onto the new-group zone: Undo removes the created group too', async () => {
    const h = await setup()
    const after = await expectOneStepRoundTrip(h, () => h.drop('work::w0::t1', NEW_GROUP_ID))
    expect(after).toHaveLength(3)
  })
})

describe('drops out of / into Now Open are one step too', () => {
  it('a drag OUT of Now Open: Undo removes the copy and reopens the tab; Redo closes exactly the reopened tab', async () => {
    const h = await setup()
    await h.drop('now::w0::t1', 'play', { type: 'group' })
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1'], ['live2']]]])
    expect(open.has(42)).toBe(false) // the move closed the real tab
    expect(steps()).toBe(1)
    expect(historyEntryEffect(useUIStore.getState().undoStack[0])?.kind).toBe('reopen')

    await h.undo()
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1']]]])
    expect(c.tabs.create).toHaveBeenCalledWith({ windowId: 7, url: 'https://example.com/live2', index: 1, active: false, pinned: false })
    const reopened = [...open].find(([, u]) => u === 'https://example.com/live2')![0]

    // an unrelated tab at the same URL must never be closed by the redo
    open.set(77, 'https://example.com/live2')
    c.tabs.remove.mockClear()
    await h.redo()
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1'], ['live2']]]])
    expect(c.tabs.remove).toHaveBeenCalledWith([reopened])
    expect(open.has(77)).toBe(true)
  })

  it('Redo after the user closed the reopened tab: the saved copy comes back, nothing else is closed, no error', async () => {
    const h = await setup()
    await h.drop('now::w0::t1', 'play', { type: 'group' })
    await h.undo()
    const reopened = [...open].find(([, u]) => u === 'https://example.com/live2')![0]
    open.delete(reopened) // the user closed it
    c.tabs.remove.mockClear()
    await h.redo()
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1'], ['live2']]]])
    expect(c.tabs.remove).not.toHaveBeenCalled()
  })

  it('a saved tab dropped INTO Now Open: Undo puts it back and closes exactly the tab the drop opened', async () => {
    const h = await setup()
    await h.drop('work::w0::t0', 'now::w0', { type: 'window' })
    expect(steps()).toBe(1)
    const opened = [...open].find(([, u]) => u === 'https://example.com/a1')![0]
    await h.undo()
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1']]]])
    expect(c.tabs.remove).toHaveBeenCalledWith([opened])
    expect(open.has(41) && open.has(42)).toBe(true)
  })

  it('a reorder INSIDE Now Open changes no saved data: no step', async () => {
    const h = await setup()
    await h.drop('now::w0::t0', 'now::w0::t1')
    expect(c.tabs.move).toHaveBeenCalled()
    expect(steps()).toBe(0)
  })
})
