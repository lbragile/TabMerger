/**
 * useDndHandlersFocusIdentity.test.tsx — keyboard focus after a drop follows IDENTITY, not
 * the old positional slot (accessibility audit A4 / A5, 2026-09-14).
 *
 *  A5 the item left the shown panel / its window was removed → the nearest remaining item
 *     of the same list (by identity), else a sibling window's header, else sidebar rows;
 *     a lone window (no grip) lands on its header control; a Now Open copy stays on the source
 *  A4 a keyboard reorder inside Now Open (chrome.tabs.move, re-synced later) re-focuses the
 *     SAME real tab once the groups cache reflects the move; never steals moved focus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers, FOLLOW_LIVE_TAB_MS } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}
type Hook = ReturnType<typeof setup>['result']

function keyboardDrop(result: Hook, id: string, overId: string, overType: string, selectionIds?: string[]) {
  const data = selectionIds ? { selectionIds } : undefined
  act(() => {
    result.current.onDragStart({
      active: { id, data: { current: data } },
      activatorEvent: new KeyboardEvent('keydown', { code: 'Space' })
    } as unknown as DragStartEvent)
  })
  return act(async () => {
    await result.current.onDragEnd({
      active: { id, data: { current: data } },
      over: { id: overId, data: { current: { type: overType } } }
    } as unknown as DragEndEvent)
  })
}

/** Render rows for the given model ids, like the real panel: `data-tm-dnd-id` row + labelled grip. */
function renderRows(ids: string[]) {
  document.body.innerHTML = ''
  const out: Record<string, HTMLElement> = {}
  for (const id of ids) {
    const row = document.createElement('div')
    row.setAttribute('data-tm-dnd-id', id)
    const isWindow = /::w\d+$/.test(id)
    if (!isWindow) row.setAttribute('role', 'listitem')
    const grip = document.createElement('span')
    grip.tabIndex = 0
    grip.setAttribute('aria-label', `Drag to reorder ${isWindow ? 'window' : 'tab'}: ${id}`)
    row.appendChild(grip)
    document.body.appendChild(row)
    out[id] = grip
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  clearDndDragLive()
  document.body.innerHTML = ''
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('A5 focus fallbacks are found by identity, not by the old slot', () => {
  it('a selection spanning an emptied window left the panel → the next item of the PRIMARY\'s own list (y2), not whatever took slot w1::t1', async () => {
    // work: w0 = [x], w1 = [y0, y1, y2]; drag y1 with x selected → group play (hidden)
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [], { permanent: true }), group('work', [win([tab('x')]), win([tab('y0'), tab('y1'), tab('y2')])]), group('play', [])]
    }
    const { result } = setup(s)
    // after the move work = w0 [y0, y2]: the slot-based fallback would have hit w0's grip or y0
    const grips = renderRows(['work::w0', 'work::w0::t0', 'work::w0::t1'])
    await keyboardDrop(result, 'work::w1::t1', 'play', 'group', ['work::w1::t1', 'work::w0::t0'])
    expect(document.activeElement).toBe(grips['work::w0::t1'])
  })

  it('a tab whose window emptied left the panel → the nearest remaining sibling WINDOW, not the tab that slid into its slot', async () => {
    // work: w0 = [x], w1 = [y0, y1]; move x → play. After: work w0 = [y0, y1]
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [], { permanent: true }), group('work', [win([tab('x')]), win([tab('y0'), tab('y1')])]), group('play', [])]
    }
    const { result } = setup(s)
    const grips = renderRows(['work::w0', 'work::w0::t0', 'work::w0::t1'])
    await keyboardDrop(result, 'work::w0::t0', 'play', 'group')
    expect(document.activeElement).toBe(grips['work::w0'])
    expect(document.activeElement).not.toBe(grips['work::w0::t0'])
  })

  it('nothing of the source group is rendered → the source group\'s sidebar row', async () => {
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [], { permanent: true }), group('work', [win([tab('x')])]), group('play', [])]
    }
    const { result } = setup(s)
    document.body.innerHTML = ''
    const row = document.createElement('div')
    row.setAttribute('data-sidebar-group-index', '1')
    row.tabIndex = 0
    document.body.appendChild(row)
    await keyboardDrop(result, 'work::w0::t0', 'play', 'group')
    expect(document.activeElement).toBe(row)
  })

  it('a window landing as a group\'s ONLY window (no grip) → its header\'s first real control', async () => {
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [], { permanent: true }), group('work', [win([tab('a')]), win([tab('b')])]), group('play', [])]
    }
    useUIStore.setState({ activeGroupIndex: 2 })
    const { result } = setup(s)
    document.body.innerHTML = ''
    const card = document.createElement('div')
    card.setAttribute('data-tm-dnd-id', 'play::w0')
    const header = document.createElement('div')
    header.setAttribute('data-window-header', '')
    // like Window.tsx's context-menu trigger: tabindex -1 AND aria-hidden
    const hiddenTrigger = document.createElement('button')
    hiddenTrigger.tabIndex = -1
    hiddenTrigger.setAttribute('aria-hidden', 'true')
    const star = document.createElement('button')
    star.setAttribute('aria-label', 'Star window')
    header.append(hiddenTrigger, star)
    card.appendChild(header)
    document.body.appendChild(card)
    await keyboardDrop(result, 'work::w1', 'play', 'group')
    expect(document.activeElement).toBe(star)
  })

  it('a Now Open COPY keeps focus on the source grip (the source stays) and says so', async () => {
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [group('now', [win([tab('live', { id: 11 }), tab('live2', { id: 12 })], { id: 700 })], { permanent: true }), group('work', [])]
    }
    useUIStore.setState({ activeGroupIndex: 0 })
    const { result } = setup(s)
    const grips = renderRows(['now::w0::t0', 'now::w0::t1'])
    await keyboardDrop(result, 'now::w0::t0', 'work', 'group')
    expect(document.activeElement).toBe(grips['now::w0::t0'])
    await vi.waitFor(() =>
      expect(document.getElementById('tm-dnd-live-region')?.textContent).toMatch(/^Copied tab live to .*The open tabs stay open\./)
    )
  })
})

describe('A4 a keyboard reorder inside Now Open follows the real tab through the browser re-sync', () => {
  const nowOpen = (ids: number[]): GroupsState => ({
    active: { id: 'now', index: 0 },
    available: [
      group('now', [win(ids.map((id) => tab(`t${id}`, { id })), { id: 700 })], { permanent: true }),
      group('work', [win([tab('w')])])
    ]
  })

  beforeEach(() => {
    vi.stubGlobal('chrome', { tabs: { move: vi.fn().mockResolvedValue({}), create: vi.fn() }, windows: { create: vi.fn() } })
    useUIStore.setState({ activeGroupIndex: 0 })
  })

  it('focus stays on the tab (old slot) until the re-sync, then moves to where the SAME tab now is', async () => {
    const { qc, result } = setup(nowOpen([11, 12, 13]))
    const grips = renderRows(['now::w0::t0', 'now::w0::t1', 'now::w0::t2'])
    await keyboardDrop(result, 'now::w0::t0', 'now::w0::t2', 'tab')
    expect(chrome.tabs.move).toHaveBeenCalled()
    expect(document.activeElement).toBe(grips['now::w0::t0'])

    // an unrelated refresh that doesn't move tab 11 yet → focus untouched
    act(() => qc.setQueryData(['groups'], nowOpen([11, 12, 13])))
    expect(document.activeElement).toBe(grips['now::w0::t0'])

    // useCurrentTabs reflects chrome.tabs.move: tab 11 is now last
    act(() => qc.setQueryData(['groups'], nowOpen([12, 13, 11])))
    expect(document.activeElement).toBe(grips['now::w0::t2'])
  })

  it('never steals focus the user moved elsewhere before the re-sync', async () => {
    const { qc, result } = setup(nowOpen([11, 12, 13]))
    renderRows(['now::w0::t0', 'now::w0::t1', 'now::w0::t2'])
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    await keyboardDrop(result, 'now::w0::t0', 'now::w0::t2', 'tab')
    elsewhere.focus()
    act(() => qc.setQueryData(['groups'], nowOpen([12, 13, 11])))
    expect(document.activeElement).toBe(elsewhere)
  })

  it(`gives up after ${FOLLOW_LIVE_TAB_MS}ms without a re-sync`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { qc, result } = setup(nowOpen([11, 12, 13]))
    const grips = renderRows(['now::w0::t0', 'now::w0::t1', 'now::w0::t2'])
    await keyboardDrop(result, 'now::w0::t0', 'now::w0::t2', 'tab')
    act(() => vi.advanceTimersByTime(FOLLOW_LIVE_TAB_MS + 1))
    act(() => qc.setQueryData(['groups'], nowOpen([12, 13, 11])))
    expect(document.activeElement).toBe(grips['now::w0::t0'])
  })
})
