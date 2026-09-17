/**
 * useDndHandlersKeyboardA11y.test.tsx — the keyboard-drag + screen-reader contract of the
 * commit handler (accessibility audit C2/S1/S2/S3):
 *  - a live-drag flag is set at pickup (for every sensor) and cleared on every exit
 *  - a KeyboardSensor pickup is marked `keyboard` (rows then render its live transform)
 *  - every exit records a real-name outcome that the dnd-kit end/cancel announcement reads
 *  - after a KEYBOARD drop, focus goes to where the item landed (or the nearest remaining
 *    item); a pointer drop never moves focus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { isDndDragLive, isDndKeyboardDrag, clearDndDragLive } from '@/lib/dndMultiDrag'
import { DND_SCREEN_READER_INSTRUCTIONS } from '@/lib/dndAnnouncements'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})
const seed = (): GroupsState => ({
  active: { id: 'now', index: 0 },
  available: [
    group('now', [], { permanent: true }),
    group('work', [win([tab('a1'), tab('a2'), tab('a3')])]),
    group('play', [win([tab('p1')])])
  ]
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], seed())
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}
type Hook = ReturnType<typeof setup>['result']

const keyboardEvent = () => new KeyboardEvent('keydown', { code: 'Space' })

function start(result: Hook, id: string, opts: { keyboard?: boolean; type?: string } = {}) {
  act(() => {
    result.current.onDragStart({
      active: { id, data: { current: opts.type ? { type: opts.type } : undefined } },
      activatorEvent: opts.keyboard ? keyboardEvent() : new MouseEvent('mousedown')
    } as unknown as DragStartEvent)
  })
}
async function end(result: Hook, id: string, overId: string | null, overType?: string) {
  await act(async () => {
    await result.current.onDragEnd({
      active: { id, data: { current: undefined } },
      over: overId ? { id: overId, data: { current: overType ? { type: overType } : undefined } } : null
    } as unknown as DragEndEvent)
  })
}
const announceEnd = (result: Hook, id: string) =>
  result.current.announcements.onDragEnd!({ active: { id, data: { current: {} } }, over: null } as never)

/** A rendered tab row with a focusable grip, like Tab.tsx. */
function gripFor(id: string) {
  const r = document.createElement('div')
  r.setAttribute('role', 'listitem')
  r.setAttribute('data-tm-dnd-id', id)
  const g = document.createElement('span')
  g.tabIndex = 0
  g.setAttribute('aria-label', `Drag to reorder tab: ${id}`)
  r.appendChild(g)
  document.body.appendChild(r)
  return g
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  clearDndDragLive()
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('live-drag flag + keyboard marker', () => {
  it('a KeyboardSensor pickup sets the live flag, marks the drag keyboard, and every exit clears it', async () => {
    const { result } = setup()
    start(result, 'work::w0::t0', { keyboard: true })
    expect(isDndDragLive()).toBe(true)
    expect(isDndKeyboardDrag()).toBe(true)
    expect(result.current.active?.keyboard).toBe(true)
    await end(result, 'work::w0::t0', 'work::w0::t2')
    expect(isDndDragLive()).toBe(false)
    expect(result.current.active).toBeNull()

    start(result, 'work::w0::t0', { keyboard: true })
    act(() => result.current.onDragCancel())
    expect(isDndDragLive()).toBe(false)
  })

  it('a pointer/native pickup is live but NOT keyboard (rows keep suppressing the transform)', async () => {
    const { result } = setup()
    start(result, 'work::w0::t0')
    expect(isDndDragLive()).toBe(true)
    expect(isDndKeyboardDrag()).toBe(false)
    expect(result.current.active?.keyboard).toBe(false)
    await end(result, 'work::w0::t0', null)
    expect(isDndDragLive()).toBe(false)
  })
})

const liveRegionText = () => document.getElementById('tm-dnd-live-region')?.textContent ?? ''

describe('end/cancel announcements carry the real outcome', () => {
  it('POINTER drop: dnd-kit\'s end announcement names the item + destination (and that the group is hidden)', async () => {
    const { result } = setup()
    start(result, 'work::w0::t0')
    await end(result, 'work::w0::t0', 'play', 'group')
    expect(announceEnd(result, 'work::w0::t0')).toBe('Moved tab a1 to Window 2 of group play, position 1 of 1. Group play is not shown.')
  })

  it('A1 KEYBOARD drop: dnd-kit gets a short token; the full outcome goes to the app-owned region AFTER focus lands', async () => {
    const { result } = setup()
    const grip = gripFor('work::w0::t0')
    start(result, 'work::w0::t0', { keyboard: true })
    await end(result, 'work::w0::t0', 'play', 'group')
    expect(announceEnd(result, 'work::w0::t0')).toBe('Dropped.')
    expect(document.activeElement).toBe(grip)
    // not in the same tick as the focus move (a focus change cancels speech)…
    expect(liveRegionText()).toBe('')
    // …but ~150ms later, in an assertive region outside #root
    await vi.waitFor(() =>
      expect(liveRegionText()).toBe('Moved tab a1 to Window 2 of group play, position 1 of 1. Group play is not shown.')
    )
    const region = document.getElementById('tm-dnd-live-region')!
    expect(region.getAttribute('aria-live')).toBe('assertive')
    expect(region.closest('#tm-dnd-aux-host')).not.toBeNull()
  })

  it('A1 the instructions are short (1–2 sentences) so a re-read after the focus move is brief', () => {
    const text = DND_SCREEN_READER_INSTRUCTIONS.draggable
    expect(text.split(/(?<=\.)\s+/).filter(Boolean).length).toBeLessThanOrEqual(2)
    expect(text).toMatch(/Space/)
    expect(text).toMatch(/Escape/)
  })

  it("rejected by canDrop: \"Can't drop there\" + where it returned (not \"dropped into\")", async () => {
    const { result } = setup()
    start(result, 'work', { type: 'group' })
    await end(result, 'work', 'now', 'group')
    expect(announceEnd(result, 'work')).toBe("Can't drop there. Group work returned to position 1 of 2.")
  })

  it('no target / dropped on itself', async () => {
    const { result } = setup()
    start(result, 'work::w0::t1')
    await end(result, 'work::w0::t1', null)
    expect(announceEnd(result, 'work::w0::t1')).toMatch(/^Can't drop there\. Tab a2 returned to position 2 of 3/)
    start(result, 'work::w0::t1')
    await end(result, 'work::w0::t1', 'work::w0::t1')
    expect(announceEnd(result, 'work::w0::t1')).toMatch(/^Dropped tab a2 back at position 2 of 3/)
  })

  it('cancel: pointer → full text via dnd-kit; keyboard → token, full text in the app region after focus', async () => {
    const { result } = setup()
    const cancelText = () =>
      result.current.announcements.onDragCancel!({ active: { id: 'work::w0::t2', data: { current: {} } }, over: null } as never)
    const full = 'Movement cancelled. Tab a3 returned to position 3 of 3 in Window 1 of group work.'
    start(result, 'work::w0::t2')
    act(() => result.current.onDragCancel())
    expect(cancelText()).toBe(full)

    gripFor('work::w0::t2')
    start(result, 'work::w0::t2', { keyboard: true })
    act(() => result.current.onDragCancel())
    expect(cancelText()).toBe('Cancelled.')
    await vi.waitFor(() => expect(liveRegionText()).toBe(full))
  })

  it('A2 a KEYBOARD drag over a sidebar group row never springs it open (focus would fall to <body>)', async () => {
    vi.useFakeTimers()
    try {
      const { result } = setup()
      start(result, 'work::w0::t0', { keyboard: true })
      act(() => {
        result.current.onDragOver({
          active: { id: 'work::w0::t0', data: { current: undefined } },
          over: { id: 'play', data: { current: { type: 'group' } } }
        } as never)
      })
      act(() => vi.advanceTimersByTime(2000))
      expect(useUIStore.getState().activeGroupIndex).toBe(1)
      // control: the same dwell during a pointer drag DOES spring the group open
      start(result, 'work::w0::t0')
      act(() => {
        result.current.onDragOver({
          active: { id: 'work::w0::t0', data: { current: undefined } },
          over: { id: 'play', data: { current: { type: 'group' } } }
        } as never)
      })
      act(() => vi.advanceTimersByTime(700))
      expect(useUIStore.getState().activeGroupIndex).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('focus after a KEYBOARD drop (restoreFocus is off: ids are positional)', () => {
  it('focuses the grip where the item LANDED — not whatever took its old slot', async () => {
    const { result } = setup()
    const oldSlot = gripFor('work::w0::t0') // after the move this slot holds a2
    const landed = gripFor('work::w0::t2')
    start(result, 'work::w0::t0', { keyboard: true })
    await end(result, 'work::w0::t0', 'work::w0::t2', 'tab')
    expect(document.activeElement).toBe(landed)
    expect(document.activeElement).not.toBe(oldSlot)
  })

  it('item left the visible panel (moved to another group) → the nearest remaining row gets focus', async () => {
    const { result } = setup()
    const near = gripFor('work::w0::t0')
    start(result, 'work::w0::t0', { keyboard: true })
    await end(result, 'work::w0::t0', 'play', 'group')
    expect(document.activeElement).toBe(near)
  })

  it('a rejected keyboard drop keeps focus on the item itself', async () => {
    const { result } = setup()
    const own = gripFor('work::w0::t1')
    start(result, 'work::w0::t1', { keyboard: true })
    await end(result, 'work::w0::t1', null)
    expect(document.activeElement).toBe(own)
  })

  it('a POINTER drop never moves focus', async () => {
    const { result } = setup()
    gripFor('work::w0::t2')
    const before = document.activeElement
    start(result, 'work::w0::t0')
    await end(result, 'work::w0::t0', 'work::w0::t2', 'tab')
    expect(document.activeElement).toBe(before)
  })
})
