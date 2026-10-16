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
  // Like the real store: writes apply one at a time in issue order, `afterWrite` runs inside the
  // write's step once it is stored (with the state stored just before it)
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  const write = (next: GroupsState, expectedRev?: number): GroupsState => {
    if (expectedRev !== undefined && expectedRev !== store.rev) throw Object.assign(new Error('stale'), { name: 'StaleGroupsError' })
    store.rev += 1
    store.state = structuredClone({ ...next, rev: store.rev })
    return structuredClone(store.state)
  }
  type AfterWrite = (stored: GroupsState, base: GroupsState) => void
  return {
    getGroupsState: vi.fn(async () => enqueue(async () => structuredClone(store.state))),
    saveGroupsState: vi.fn((next: GroupsState, opts: { expectedRev?: number; afterWrite?: AfterWrite } = {}) =>
      enqueue(async () => {
        const base = structuredClone(store.state)
        const stored = write(next, opts.expectedRev)
        opts.afterWrite?.(stored, base)
        return store.rev
      })
    ),
    updateGroupsState: vi.fn((fn: (s: GroupsState) => GroupsState | null, opts: { afterWrite?: AfterWrite } = {}) =>
      enqueue(async () => {
        const base = structuredClone(store.state)
        const next = fn(base)
        if (!next) return base
        const stored = write(next)
        opts.afterWrite?.(stored, base)
        return stored
      })
    ),
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
import { historyEntryEffect, settledEntryEffect } from '@/lib/undoLiveTabs'
import { saveGroupsState } from '@/lib/localDb'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import { useUIStore } from '@/stores/uiStore'
import { forgetHistoryCursor } from '@/lib/undoHistory'

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
  forgetHistoryCursor()
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
  /** A drop whose commit is NOT awaited: returns the commit's promise (write, then side effects). */
  const startDrop = (activeId: string, overId: string, overData?: Record<string, unknown>) => {
    const data = { current: undefined }
    act(() => {
      result.current.dnd.onDragStart({ active: { id: activeId, data }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
    })
    let commit!: Promise<void>
    act(() => {
      commit = result.current.dnd.onDragEnd({ active: { id: activeId, data }, over: { id: overId, data: { current: overData } } } as unknown as DragEndEvent) as unknown as Promise<void>
    })
    return commit
  }
  const undo = () => act(async () => { await result.current.history.undo() })
  const redo = () => act(async () => { await result.current.history.redo() })
  return { drop, startDrop, undo, redo, history: () => result.current.history }
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

  it('a saved tab dropped onto ANOTHER group sidebar row (lands in a new window there)', async () => {
    const h = await setup()
    const after = await expectOneStepRoundTrip(h, () => h.drop('work::w0::t0', 'play', { type: 'group' }))
    expect(after).toEqual([['work', [['a2', 'a3']]], ['play', [['p1'], ['a1']]]])
  })

  it('the same drop when a Now Open write landed during the drag (the write is refused as stale and redone on a fresh read)', async () => {
    const h = await setup()
    // useCurrentTabs mirrored a tab event: the store moved on, the cache has not seen it
    store.state = { ...store.state, rev: store.rev + 1, available: [{ ...store.state.available[0], windows: [win([tab('live1', 41)], { id: 7 })] }, ...store.state.available.slice(1)] }
    store.rev += 1
    const after = await expectOneStepRoundTrip(h, () => h.drop('work::w0::t0', 'play', { type: 'group' }))
    expect(after).toEqual([['work', [['a2', 'a3']]], ['play', [['p1'], ['a1']]]])
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
    expect((await settledEntryEffect(useUIStore.getState().undoStack[0]))?.kind).toBe('reopen')

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

describe('the drop step is recorded inside its write (G6, G2, G3)', () => {
  it('G6: a failed drop write leaves no step, and never removes an entry another action recorded', async () => {
    const h = await setup()
    const other = seed()
    const redo = seed()
    useUIStore.setState({ undoStack: [other], redoStack: [redo] })
    vi.mocked(saveGroupsState).mockImplementationOnce(() => Promise.reject(new Error('QuotaExceeded')))
    await h.drop('work::w0::t0', 'play::new-window', { type: 'new-window', groupId: 'play', groupIndex: 2 })
    expect(useUIStore.getState().undoStack).toEqual([other])
    expect(useUIStore.getState().undoStack[0]).toBe(other)
    expect(useUIStore.getState().redoStack[0]).toBe(redo)
  })

  it("G2: an Undo clicked before the drop's write landed waits, then undoes the drop", async () => {
    const h = await setup()
    const before = saved(store.state)
    await act(async () => {
      const commit = h.startDrop('work::w0::t0', 'play::new-window', { type: 'new-window', groupId: 'play', groupIndex: 2 })
      const undone = h.history().undo()
      await Promise.all([commit, undone])
    })
    expect(saved(store.state)).toEqual(before)
    expect(steps()).toBe(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('G3: an Undo clicked before Chrome returned the tab a drop into Now Open opened still closes it', async () => {
    const h = await setup()
    let giveTab!: () => void
    const create = c.tabs.create.getMockImplementation() as (args: { url: string }) => Promise<unknown>
    c.tabs.create.mockImplementationOnce((args: { url: string }) => new Promise((resolve) => { giveTab = () => resolve(create(args)) }))
    await act(async () => {
      const commit = h.startDrop('work::w0::t0', 'now::w0', { type: 'window' })
      await waitFor(() => expect(c.tabs.create).toHaveBeenCalled())
      const undone = h.history().undo()
      await new Promise((r) => setTimeout(r, 0))
      expect(c.tabs.remove).not.toHaveBeenCalled()
      giveTab()
      await Promise.all([commit, undone])
    })
    const opened = [...open].find(([, u]) => u === 'https://example.com/a1')
    expect(opened).toBeUndefined() // closed again, by the id Chrome returned
    expect(c.tabs.remove).toHaveBeenCalledTimes(1)
    expect(saved(store.state)).toEqual([['work', [['a1', 'a2', 'a3']]], ['play', [['p1']]]])
  })

  it('a drop with no tabs to open settles its effect at once (an Undo does not wait for it)', async () => {
    const h = await setup()
    await h.drop('work::w0::t0', 'play::new-window', { type: 'new-window', groupId: 'play', groupIndex: 2 })
    expect(historyEntryEffect(useUIStore.getState().undoStack[0])).toBeUndefined()
  })
})

/**
 * The audit matrix (docs/undo-redo-spec.md §2.1, drops): every source × target through the real
 * handler (`onDragEnd` → `commitDrop` → `commitResolved`), and the keyboard-move equivalents
 * (`commitKeyboardMove`). A drop that changes saved data is exactly ONE step and one Undo gives
 * back exactly the state before; Redo the state after. A drop that changes only Now Open is none.
 */
describe('audit matrix: every drop source x target', () => {
  type Row = [name: string, active: string, over: string, overData?: Record<string, unknown>, selection?: string[]]
  const playNewWindow = { type: 'new-window', groupId: 'play', groupIndex: 2 }
  const workNewWindow = { type: 'new-window', groupId: 'work', groupIndex: 1 }
  const nowNewWindow = { type: 'new-window', groupId: 'now', groupIndex: 0 }

  /** work has a second window here, so window moves inside a group are possible */
  const seedTwoWindows = () => {
    store.state = {
      ...seed(),
      available: [seed().available[0], group('work', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('b1')])]), seed().available[2]]
    }
  }

  const oneStep: Row[] = [
    ['saved tab -> other group sidebar row', 'work::w0::t0', 'play', { type: 'group' }],
    ['saved tab -> its own group sidebar row', 'work::w0::t0', 'work', { type: 'group' }],
    ['saved tab -> other group window (spring-open)', 'work::w0::t0', 'play::w0', { type: 'window' }],
    ['saved tab -> other group tab position (spring-open)', 'work::w0::t0', 'play::w0::t0'],
    ['saved tab -> own new-window zone', 'work::w0::t1', 'work::new-window', workNewWindow],
    ['saved tab -> other new-window zone', 'work::w0::t0', 'play::new-window', playNewWindow],
    ['saved tab -> new-group zone', 'work::w0::t0', NEW_GROUP_ID],
    ['saved tab -> Now Open sidebar row', 'work::w0::t0', 'now', { type: 'group' }],
    ['saved tab -> Now Open window (panel)', 'work::w0::t0', 'now::w0', { type: 'window' }],
    ['saved tab -> Now Open tab position (panel)', 'work::w0::t0', 'now::w0::t0'],
    ['saved tab -> Now Open new-window zone', 'work::w0::t0', 'now::new-window', nowNewWindow],
    ['saved tab -> other tab in its own window (reorder)', 'work::w0::t0', 'work::w0::t2'],
    ['saved window -> other group sidebar row', 'work::w1', 'play', { type: 'group' }],
    ['saved window -> other group window (spring-open)', 'work::w1', 'play::w0', { type: 'window' }],
    ['saved window -> its own group window (reorder)', 'work::w1', 'work::w0', { type: 'window' }],
    ['saved window -> new-group zone', 'work::w1', NEW_GROUP_ID],
    ['saved window -> Now Open sidebar row', 'work::w1', 'now', { type: 'group' }],
    ['saved window -> Now Open window (panel)', 'work::w1', 'now::w0', { type: 'window' }],
    ['multi saved tabs -> other group sidebar row', 'work::w0::t0', 'play', { type: 'group' }, ['work::w0::t0', 'work::w0::t2']],
    ['multi saved tabs -> new-group zone', 'work::w0::t0', NEW_GROUP_ID, undefined, ['work::w0::t0', 'work::w1::t0']],
    ['multi saved tabs -> Now Open sidebar row', 'work::w0::t0', 'now', { type: 'group' }, ['work::w0::t0', 'work::w0::t2']],
    ['multi saved windows -> other group sidebar row', 'work::w0', 'play', { type: 'group' }, ['work::w0', 'work::w1']],
    ['live tab -> saved group sidebar row', 'now::w0::t1', 'play', { type: 'group' }],
    ['live tab -> saved window (spring-open)', 'now::w0::t1', 'play::w0', { type: 'window' }],
    ['live tab -> saved tab position (spring-open)', 'now::w0::t1', 'play::w0::t0'],
    ['live tab -> saved group new-window zone', 'now::w0::t1', 'play::new-window', playNewWindow],
    ['live tab -> new-group zone', 'now::w0::t1', NEW_GROUP_ID],
    ['multi live tabs -> saved group sidebar row', 'now::w0::t0', 'play', { type: 'group' }, ['now::w0::t0', 'now::w0::t1']],
    ['live window -> saved group sidebar row', 'now::w0', 'play', { type: 'group' }],
    ['live window -> new-group zone', 'now::w0', NEW_GROUP_ID],
    ['group -> group (reorder)', 'play', 'work', { type: 'group' }]
  ]

  it.each(oneStep)('%s: exactly one step, Undo and Redo round-trip it', async (_name, active, over, overData, selection) => {
    seedTwoWindows()
    const h = await setup()
    await expectOneStepRoundTrip(h, () => h.drop(active, over, overData, selection))
  })

  const noStep: Row[] = [
    ['live tab -> Now Open tab (reorder)', 'now::w0::t0', 'now::w0::t1'],
    ['live tab -> Now Open new-window zone (detach)', 'now::w0::t0', 'now::new-window', nowNewWindow],
    ['saved tab -> itself', 'work::w0::t0', 'work::w0::t0']
  ]

  it.each(noStep)('%s: no step (only Now Open, or nothing, changes)', async (_name, active, over, overData, selection) => {
    seedTwoWindows()
    const before = saved(store.state)
    const h = await setup()
    await h.drop(active, over, overData, selection)
    expect(saved(store.state)).toEqual(before)
    expect(steps()).toBe(0)
  })

  it('two drops in a row are two steps; two Undos take both back', async () => {
    seedTwoWindows()
    const before = saved(store.state)
    const h = await setup()
    await h.drop('work::w0::t0', 'play', { type: 'group' })
    await h.drop('work::w1', 'play', { type: 'group' })
    expect(steps()).toBe(2)
    await h.undo()
    await h.undo()
    expect(saved(store.state)).toEqual(before)
  })
})

describe('audit matrix: keyboard move equivalents (commitKeyboardMove)', () => {
  type KRow = [name: string, active: Record<string, unknown>, over: Record<string, unknown>]
  const rows: KRow[] = [
    ['tab -> other group row', { type: 'tab', id: 'work::w0::t0' }, { type: 'group', id: 'play' }],
    ['tab -> other group tab position', { type: 'tab', id: 'work::w0::t0' }, { type: 'tab', id: 'play::w0::t0', index: 0 }],
    ['tab -> new-group zone', { type: 'tab', id: 'work::w0::t0' }, { type: 'new-group', id: NEW_GROUP_ID }],
    ['window -> other group row', { type: 'window', id: 'work::w0' }, { type: 'group', id: 'play' }],
    ['group -> group (reorder)', { type: 'group', id: 'play' }, { type: 'group', id: 'work' }]
  ]

  it.each(rows)('%s: exactly one step, Undo and Redo round-trip it', async (_name, active, over) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(GROUPS_QUERY_KEY, structuredClone(store.state))
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => ({ dnd: useDndHandlers(), history: useUndoRedo() }), { wrapper })
    await waitFor(() => expect(qc.isFetching()).toBe(0))
    const before = saved(store.state)
    await act(async () => {
      await result.current.dnd.commitKeyboardMove(active as never, over as never)
    })
    const after = saved(store.state)
    expect(after).not.toEqual(before)
    expect(steps()).toBe(1)
    await act(async () => { await result.current.history.undo() })
    expect(saved(store.state)).toEqual(before)
    await act(async () => { await result.current.history.redo() })
    expect(saved(store.state)).toEqual(after)
  })
})
