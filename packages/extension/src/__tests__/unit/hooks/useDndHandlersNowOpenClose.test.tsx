/**
 * useDndHandlersNowOpenClose.test.tsx — commit-level check of the "close your own window
 * last" rule (spec C7) for a Now Open drag-out.
 *
 * `partitionClosableTabs` itself is pinned in `dndNowOpenMoveOut.test.ts`. These tests drive
 * the real `useDndHandlers` drop (onDragStart -> onDragEnd) and look at what reaches
 * `chrome.tabs.remove` and the deferred-close port:
 *  - a window the TabMerger page is NOT in closes whole at the drop, active tab included,
 *    and no port is opened;
 *  - the page's own window loses its non-active tabs at once and only its active tab goes
 *    to the port;
 *  - the saved copy is written before either side effect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { saveGroupsState } from '@/lib/localDb'
import { resetDeferredClosePort, DEFERRED_CLOSE_PORT } from '@/lib/deferredTabClose'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const save = saveGroupsState as unknown as ReturnType<typeof vi.fn>

/** The window the TabMerger page lives in, and another browser window. */
const OWN = 100
const OTHER = 200

const live = (id: number, title: string): Tab => ({ id, title, url: `https://example.com/${title}` })
const saved = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` })
const win = (id: number, tabs: Tab[]): ExtWindow => ({ id, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  permanent: false,
  ...over
})

/** Now Open holds the own window (tabs 10, 11, 12; 10 active) and another window (20, 21; 20 active). */
function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', [win(OWN, [live(10, 'o1'), live(11, 'o2'), live(12, 'o3')]), win(OTHER, [live(20, 'x1'), live(21, 'x2')])], {
        permanent: true
      }),
      group('dest', [win(0, [saved('d1')])])
    ]
  }
}

function stubChrome(order: string[]) {
  const ports: { name: string; postMessage: ReturnType<typeof vi.fn> }[] = []
  const stub = {
    windows: { create: vi.fn().mockResolvedValue({}), getCurrent: vi.fn().mockResolvedValue({ id: OWN }) },
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 10, windowId: OWN },
        { id: 20, windowId: OTHER }
      ]),
      remove: vi.fn().mockImplementation(async () => {
        order.push('tabs.remove')
      }),
      create: vi.fn().mockResolvedValue({}),
      move: vi.fn().mockResolvedValue({})
    },
    runtime: {
      connect: vi.fn((info: { name: string }) => {
        order.push('port')
        const port = { name: info.name, postMessage: vi.fn(), onDisconnect: { addListener: vi.fn() } }
        ports.push(port)
        return port
      })
    }
  }
  vi.stubGlobal('chrome', stub)
  return { stub, ports }
}

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useDndHandlers(), { wrapper }).result
}
type Hook = { current: ReturnType<typeof useDndHandlers> }

async function dropOnGroup(result: Hook, activeId: string, selectionIds?: string[]) {
  const data = selectionIds ? { selectionIds } : undefined
  await act(async () => {
    result.current.onDragStart({ active: { id: activeId, data: { current: data } } } as unknown as DragStartEvent)
  })
  await act(async () => {
    await result.current.onDragEnd({
      active: { id: activeId, data: { current: data } },
      over: { id: 'dest', data: { current: { type: 'group' } } }
    } as unknown as DragEndEvent)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDeferredClosePort()
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], activeGroupIndex: 0 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetDeferredClosePort()
})

describe('Now Open drag-out commit — which real tabs close at the drop', () => {
  it('a window the TabMerger page is NOT in: tabs.remove gets all its ids (active included), no deferred-close port', async () => {
    const order: string[] = []
    const { stub, ports } = stubChrome(order)
    const result = setup(seed())
    await dropOnGroup(result, 'now::w1')

    expect(stub.tabs.remove).toHaveBeenCalledTimes(1)
    expect(stub.tabs.remove).toHaveBeenCalledWith([20, 21])
    expect(stub.runtime.connect).not.toHaveBeenCalled()
    expect(ports).toHaveLength(0)
  })

  it("the page's own window: non-active tabs close now, the port gets only the active tab", async () => {
    const order: string[] = []
    const { stub, ports } = stubChrome(order)
    const result = setup(seed())
    await dropOnGroup(result, 'now::w0')

    expect(stub.tabs.remove).toHaveBeenCalledTimes(1)
    expect(stub.tabs.remove).toHaveBeenCalledWith([11, 12])
    expect(ports).toHaveLength(1)
    expect(ports[0].name).toBe(DEFERRED_CLOSE_PORT)
    expect(ports[0].postMessage).toHaveBeenCalledWith({ tabIds: [10] })
  })

  it("a selection spanning both windows: the other window closes whole, only the own window's active tab waits", async () => {
    const order: string[] = []
    const { stub, ports } = stubChrome(order)
    const result = setup(seed())
    await dropOnGroup(result, 'now::w0', ['now::w0', 'now::w1'])

    const closedNow = (stub.tabs.remove.mock.calls[0][0] as number[]).slice().sort((a, b) => a - b)
    expect(closedNow).toEqual([11, 12, 20, 21])
    expect(ports).toHaveLength(1)
    expect(ports[0].postMessage).toHaveBeenCalledWith({ tabIds: [10] })
  })

  it('the destination copy is saved (detached, id 0) BEFORE any real tab is closed', async () => {
    const order: string[] = []
    save.mockImplementation(async () => {
      order.push('save')
    })
    const { stub } = stubChrome(order)
    const result = setup(seed())
    await dropOnGroup(result, 'now::w1')

    expect(order.indexOf('save')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('save')).toBeLessThan(order.indexOf('tabs.remove'))
    const savedState = save.mock.calls.at(-1)![0] as GroupsState
    const dest = savedState.available.find((g) => g.id === 'dest')!
    expect(dest.windows.at(-1)!.tabs.map((t) => [t.id, t.title])).toEqual([
      [0, 'x1'],
      [0, 'x2']
    ])
    expect(stub.tabs.remove).toHaveBeenCalled()
    save.mockReset()
    save.mockResolvedValue(undefined)
  })
})
