/**
 * useKeyboardMove.test.tsx — the keyboard MOVE MODE controller: entering from a request, the
 * key handling (Up/Down wrap, Left -> group list, list Up/Down make the highlighted group the
 * shown one, Right enters it, Space commits, Escape cancels and restores the shown group;
 * Enter and Tab inert), announcements, the preview (collapsed source rows, `applyGap`, docked
 * copy), focus, and that Space commits through `commitKeyboardMove` with the right
 * (active, over) pair — the same tail pointer drops end in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React, { useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildDndModel } from '@/hooks/useDndModel'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { isDndDragLive, clearDndDragLive } from '@/lib/dndMultiDrag'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const { commitSpy, gapSpy, promoteSpy, gate, uiState } = vi.hoisted(() => ({
  commitSpy: vi.fn().mockResolvedValue(undefined),
  gapSpy: vi.fn(),
  promoteSpy: vi.fn((): string[] | null => null),
  gate: { atLimit: false },
  uiState: {
    activeGroupIndex: 1,
    selectedItems: [] as Array<{ type: string; id: string }>,
    clearSelection: vi.fn(),
    setActiveGroupIndex: vi.fn()
  }
}))

vi.mock('@/components/dnd/DndProvider', () => ({
  useDndContext: () => ({ commitKeyboardMove: commitSpy, applyGap: gapSpy })
}))
vi.mock('@/hooks/useDndHandlers', () => ({
  getNewGroupZoneGate: () => gate,
  ownFocusSelectors: (_s: unknown, id: string) => [`[data-tm-dnd-id="${id}"]`],
  promoteStoreSelection: promoteSpy
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign(() => undefined, { getState: () => uiState })
}))

import { useKeyboardMove } from '@/hooks/useKeyboardMove'

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` })
const win = (titles: string[]): ExtWindow => ({ id: 0, tabs: titles.map(tab), incognito: false, focused: false })
const grp = (id: string, name: string, windows: ExtWindow[], extra: Partial<Group> = {}): Group => ({
  id,
  name,
  color: 'c',
  updatedAt: 1,
  windows,
  ...extra
})
const state = (): GroupsState => ({
  active: { id: 'now', index: 0 },
  available: [
    grp('now', 'Now Open', [], { permanent: true }),
    grp('work', 'Work', [win(['Alpha', 'Bravo', 'Charlie']), win(['Delta'])]),
    grp('play', 'Play', [win(['Foxtrot'])]),
    grp('extra', 'Extra', [win(['Golf'])])
  ]
})

function Probe() {
  const host = useRef<HTMLDivElement>(null)
  useKeyboardMove(host)
  return <div ref={host} tabIndex={-1} data-testid="host" />
}

/** Rows for every model id (the controller only offers targets that are rendered), each 30px tall. */
function mountRows(s: GroupsState) {
  const m = buildDndModel(s)
  const make = (id: string) => {
    const el = document.createElement('div')
    el.setAttribute('data-tm-dnd-id', id)
    el.tabIndex = 0
    el.scrollIntoView = vi.fn()
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30, x: 0, y: 0, toJSON: () => ({}) })
    document.body.appendChild(el)
    return el
  }
  const rows: Record<string, HTMLElement> = {}
  for (const id of [...Object.keys(m.groups), ...Object.keys(m.windows), ...Object.keys(m.tabs)]) rows[id] = make(id)
  for (const tid of ['new-window-dropzone', 'new-group-dropzone']) {
    const z = document.createElement('div')
    z.setAttribute('data-testid', tid)
    z.scrollIntoView = vi.fn()
    document.body.appendChild(z)
  }
  return rows
}

let qc: QueryClient
const live = () => document.getElementById('tm-dnd-live-region')?.textContent?.trim() ?? ''
const key = (code: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true, ...init })
  act(() => {
    document.dispatchEvent(ev)
  })
  return ev
}
const keys = (...codes: string[]) => codes.forEach((c) => key(c))
function start(rows: Record<string, HTMLElement>, kind: 'tab' | 'window' | 'group', id: string) {
  rows[id]?.focus()
  act(() => {
    useKeyboardMoveStore.getState().requestMove(kind, id)
  })
  // pick-up runs in a microtask (flushSync cannot run inside the effect that consumed the request)
}
const lastGap = () => gapSpy.mock.calls[gapSpy.mock.calls.length - 1]?.[0] as { height: number; containerKey: string | null; shiftIds: Set<string> } | null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  qc = new QueryClient()
  qc.setQueryData(GROUPS_QUERY_KEY, state())
  commitSpy.mockClear()
  gapSpy.mockClear()
  promoteSpy.mockReset().mockReturnValue(null)
  gate.atLimit = false
  uiState.selectedItems = []
  uiState.activeGroupIndex = 1
  uiState.clearSelection.mockClear()
  uiState.setActiveGroupIndex.mockReset().mockImplementation((i: number) => {
    uiState.activeGroupIndex = i
  })
  useKeyboardMoveStore.setState({ request: null, kind: null, marker: null })
})
afterEach(() => {
  clearDndDragLive()
  vi.unstubAllGlobals()
})

async function setup() {
  const rows = mountRows(state())
  const utils = render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>
  )
  return { rows, ...utils }
}
/** Start a move and let the microtask that begins it run. */
async function begin(rows: Record<string, HTMLElement>, kind: 'tab' | 'window' | 'group', id: string) {
  start(rows, kind, id)
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useKeyboardMove — entering', () => {
  it('a request enters move mode: announces, publishes kind + marker, marks the source, silences shortcuts', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    expect(live()).toMatch(/^Picked up tab Bravo, position 2 of 3 in Window 1 of group Work\./)
    expect(useKeyboardMoveStore.getState().kind).toBe('tab')
    expect(isDndDragLive()).toBe(true)
    expect(rows['work::w0::t1'].hasAttribute('data-tm-move-source')).toBe(true)
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })

  it('focus moves to the stable host (never left on the collapsing row); the source row collapses', async () => {
    const { rows, getByTestId } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    expect(document.activeElement).toBe(getByTestId('host'))
    expect(rows['work::w0::t1'].style.getPropertyValue('height')).toBe('0px')
    expect(rows['work::w0::t1'].style.getPropertyPriority('height')).toBe('important')
  })

  it('opens the pointer\'s insertion gap at the source slot (applyGap) and docks a copy in the aux host', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const gap = lastGap()!
    expect(gap.height).toBe(30)
    expect(gap.containerKey).toBe('work::w0')
    expect([...gap.shiftIds]).toEqual(['work::w0::t2'])
    expect(document.querySelectorAll('#tm-dnd-aux-host [data-testid="drag-ghost"]')).toHaveLength(1)
  })

  it('the docked ghost never carries the source marker (only the source row does)', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const ghost = document.querySelector('#tm-dnd-aux-host [data-testid="drag-ghost"]')!
    expect(ghost).not.toBeNull()
    expect(ghost.hasAttribute('data-tm-move-source')).toBe(false)
    expect(ghost.querySelector('[data-tm-move-source]')).toBeNull()
    expect(rows['work::w0::t1'].hasAttribute('data-tm-move-source')).toBe(true)
  })

  it('Down moves the gap with the cursor (the rows after the new slot shift)', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowUp') // first in Window 1: Alpha shifts
    expect([...lastGap()!.shiftIds]).toEqual(['work::w0::t0', 'work::w0::t2'])
    key('ArrowDown')
    key('ArrowDown') // last in Window 1: nothing shifts
    expect([...lastGap()!.shiftIds]).toEqual([])
  })

  it('a request for an id that no longer exists, or while a move is live, is ignored', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'ghost::w0::t0')
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    await begin(rows, 'tab', 'work::w0::t1')
    await begin(rows, 'tab', 'work::w0::t0')
    key('Escape')
    expect(live()).toMatch(/returned to position 2 of 3/) // still Bravo's move
  })

  it('a selected row carries the whole selection (ghost for N); an unselected pick clears the selection', async () => {
    const { rows } = await setup()
    promoteSpy.mockReturnValue(['work::w0::t0', 'work::w0::t1'])
    uiState.selectedItems = [{ type: 'tab', id: 'tab-1-0-0' }]
    await begin(rows, 'tab', 'work::w0::t1')
    expect(live()).toMatch(/^Picked up 2 tabs\./)
    expect(rows['work::w0::t0'].hasAttribute('data-tm-move-source')).toBe(true)
    key('ArrowDown')
    key('Space')
    expect(commitSpy).toHaveBeenCalledWith(
      { type: 'tab', id: 'work::w0::t1', selectionIds: ['work::w0::t0', 'work::w0::t1'] },
      expect.objectContaining({ type: 'tab', id: 'work::w0::t2' })
    )
    expect(uiState.clearSelection).not.toHaveBeenCalled()

    promoteSpy.mockReturnValue(null)
    await begin(rows, 'tab', 'work::w1::t0')
    expect(uiState.clearSelection).toHaveBeenCalled()
    key('Escape')
  })
})

describe('useKeyboardMove — main panel', () => {
  it('Down announces each target; Space commits (active, over) through commitKeyboardMove and tears the preview down', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowDown')
    expect(live()).toBe('Bravo, last in Window 1')
    const ev = key('Space')
    expect(ev.defaultPrevented).toBe(true)
    expect(commitSpy).toHaveBeenCalledTimes(1)
    expect(commitSpy).toHaveBeenCalledWith(
      { type: 'tab', id: 'work::w0::t1', selectionIds: undefined },
      { type: 'tab', id: 'work::w0::t2', index: 2 }
    )
    expect(isDndDragLive()).toBe(false)
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(rows['work::w0::t1'].hasAttribute('data-tm-move-source')).toBe(false)
    expect(rows['work::w0::t1'].style.getPropertyValue('height')).toBe('')
    expect(document.querySelectorAll('[data-testid="drag-ghost"]')).toHaveLength(0)
    expect(lastGap()).toBeNull()
  })

  it('Up/Down WRAP and announce it', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowUp') // first
    key('ArrowUp') // wraps to the new-window zone
    expect(live()).toBe('Wrapped to bottom. Bravo, in a new window')
    key('ArrowDown') // wraps to the top
    expect(live()).toBe('Wrapped to top. Bravo, first in Window 1')
  })

  it('crosses into the next window and stops at each; the new-window zone highlights through the store marker', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowDown', 'ArrowDown')
    expect(live()).toBe('Bravo, first in Window 2')
    keys('ArrowDown', 'ArrowDown')
    expect(live()).toBe('Bravo, in a new window')
    expect(useKeyboardMoveStore.getState().marker).toEqual({ type: 'zone', zone: 'new-window' })
    expect(lastGap()!.containerKey).toBeNull()
  })

  it('Right in the main panel does nothing (no announcement, same target)', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const before = live()
    const ev = key('ArrowRight')
    expect(ev.defaultPrevented).toBe(true)
    expect(live()).toBe(before)
  })

  it('Escape cancels: nothing commits, the preview goes, focus returns to the source row, outcome announced', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowDown')
    const ev = key('Escape')
    expect(ev.defaultPrevented).toBe(true)
    expect(commitSpy).not.toHaveBeenCalled()
    expect(live()).toMatch(/^Movement cancelled\. Tab Bravo returned to position 2 of 3/)
    expect(document.activeElement).toBe(rows['work::w0::t1'])
    expect(isDndDragLive()).toBe(false)
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(lastGap()).toBeNull()
    expect(document.querySelectorAll('[data-testid="drag-ghost"]')).toHaveLength(0)
  })

  it('Enter and Tab are inert while moving; modified Space and auto-repeat are not a drop', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const enter = key('Enter')
    const tabKey = key('Tab')
    expect(enter.defaultPrevented).toBe(true)
    expect(tabKey.defaultPrevented).toBe(true)
    expect(commitSpy).not.toHaveBeenCalled()
    key('Space', { shiftKey: true })
    key('Space', { ctrlKey: true })
    key('Space', { repeat: true })
    expect(commitSpy).not.toHaveBeenCalled()
    expect(useKeyboardMoveStore.getState().kind).toBe('tab')
    expect(document.activeElement).not.toBe(rows['work::w0::t1'])
  })

  it('other keys are left alone', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const ev = key('KeyA')
    expect(ev.defaultPrevented).toBe(false)
  })

  it('Space on a lone origin reports "nothing moved", commits nothing, focus back on the row', async () => {
    const { rows } = await setup()
    uiState.activeGroupIndex = 2
    await begin(rows, 'window', 'play::w0')
    key('Space')
    expect(commitSpy).not.toHaveBeenCalled()
    expect(live()).toMatch(/nothing moved/)
    expect(document.activeElement).toBe(rows['play::w0'])
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
  })

  it('a pointer press or the window losing focus cancels the move', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    act(() => {
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(commitSpy).not.toHaveBeenCalled()
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(live()).toBe('Movement cancelled.')
    await begin(rows, 'tab', 'work::w0::t1')
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
  })

  it('unmounting mid-move cleans the flag, the preview and the marks', async () => {
    const { rows, unmount } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    unmount()
    expect(isDndDragLive()).toBe(false)
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(rows['work::w0::t1'].hasAttribute('data-tm-move-source')).toBe(false)
  })

  it('cancels with an explanation when the moving item disappears from the cache', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const changed = state()
    changed.available[1] = grp('work', 'Work', [win(['Alpha'])])
    act(() => {
      qc.setQueryData(GROUPS_QUERY_KEY, changed)
    })
    expect(live()).toBe('The groups changed, so the movement was cancelled.')
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(isDndDragLive()).toBe(false)
  })

  it('a cache update that moves the cursor target re-announces it and republishes the gap', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    const changed = state()
    changed.available[1] = grp('work', 'Work', [win(['Alpha', 'Bravo']), win(['Delta'])])
    gapSpy.mockClear()
    act(() => {
      qc.setQueryData(GROUPS_QUERY_KEY, changed)
    })
    expect(useKeyboardMoveStore.getState().kind).toBe('tab')
    expect(gapSpy).toHaveBeenCalled()
  })
})

describe('useKeyboardMove — group list', () => {
  it('Left puts the cursor on the shown group (ringed row), the item still held, copy at the END of it', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowLeft')
    expect(live()).toBe('Group list: Work')
    expect(rows['work'].hasAttribute('data-tm-move-cursor')).toBe(true)
    expect(rows['work::w0::t1'].hasAttribute('data-tm-move-source')).toBe(true)
    expect(lastGap()!.containerKey).toBe('work::w1') // end of Work: Window 2
    expect(lastGap()!.shiftIds.size).toBe(0)
  })

  it('Up/Down make the highlighted group the SHOWN one, live; Space drops at the end of it', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowDown')
    expect(live()).toBe('Group list: Play')
    expect(uiState.setActiveGroupIndex).toHaveBeenLastCalledWith(2)
    expect(rows['play'].hasAttribute('data-tm-move-cursor')).toBe(true)
    expect(rows['work'].hasAttribute('data-tm-move-cursor')).toBe(false)
    key('Space')
    expect(commitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab', id: 'work::w0::t1' }), { type: 'tab', id: 'play::w0::t0', index: 1 })
    // a drop keeps the target group shown (no restore)
    expect(uiState.activeGroupIndex).toBe(2)
  })

  it('the list wraps and announces it; Now Open is a stop for a tab', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowUp')
    expect(live()).toBe('Group list: Now Open')
    key('ArrowUp')
    expect(live()).toBe('Wrapped to bottom. Group list: New group')
    key('ArrowDown')
    expect(live()).toBe('Wrapped to top. Group list: Now Open')
  })

  it('"New group" highlights the zone and Space creates a group (over = new-group)', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowUp', 'ArrowUp') // Now Open, then (wrapped) New group
    expect(useKeyboardMoveStore.getState().marker).toEqual({ type: 'zone', zone: 'new-group' })
    expect(lastGap()!.containerKey).toBeNull()
    key('Space')
    expect(commitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab' }), expect.objectContaining({ type: 'new-group' }))
  })

  it('Right enters the highlighted group (item at its end, announced); Right on "New group" does nothing', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowDown', 'ArrowRight')
    expect(live()).toBe('Play: Bravo, last in Window 1')
    expect(rows['play'].hasAttribute('data-tm-move-cursor')).toBe(false)
    key('ArrowUp') // now walking Play's slots
    expect(live()).toBe('Bravo, first in Window 1')
    key('Escape')
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowUp', 'ArrowUp')
    const before = live()
    key('ArrowRight')
    expect(live()).toBe(before)
  })

  it('Left inside the list does nothing', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    key('ArrowLeft')
    const before = live()
    key('ArrowLeft')
    expect(live()).toBe(before)
  })

  it('"New group" is not offered at the free-tier cap', async () => {
    const { rows } = await setup()
    gate.atLimit = true
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowUp', 'ArrowUp')
    expect(live()).toBe('Wrapped to bottom. Group list: Extra')
  })

  it('Escape from another group restores the originally shown group, focus on the source row, nothing moves', async () => {
    const { rows } = await setup()
    await begin(rows, 'tab', 'work::w0::t1')
    keys('ArrowLeft', 'ArrowDown', 'ArrowDown')
    expect(uiState.activeGroupIndex).toBe(3)
    key('Escape')
    expect(commitSpy).not.toHaveBeenCalled()
    expect(uiState.activeGroupIndex).toBe(1)
    expect(document.activeElement).toBe(rows['work::w0::t1'])
    expect(rows['extra'].hasAttribute('data-tm-move-cursor')).toBe(false)
    expect(live()).toMatch(/^Movement cancelled\./)
  })

  it('a window source also uses the list; a group source ignores Left/Right', async () => {
    const { rows } = await setup()
    await begin(rows, 'window', 'work::w0')
    keys('ArrowLeft', 'ArrowDown')
    expect(live()).toBe('Group list: Play')
    key('Space')
    expect(commitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'window', id: 'work::w0' }), expect.objectContaining({ type: 'window', id: 'play::w0' }))
    await begin(rows, 'group', 'work')
    const before = live()
    keys('ArrowLeft', 'ArrowRight')
    expect(live()).toBe(before)
  })
})

describe('useKeyboardMove — groups', () => {
  it('a picked-up group becomes the shown group and moves among saved groups (gap in the sidebar list)', async () => {
    const { rows } = await setup()
    uiState.activeGroupIndex = 2
    await begin(rows, 'group', 'work')
    expect(uiState.setActiveGroupIndex).toHaveBeenCalledWith(1)
    expect(lastGap()!.containerKey).toBe('groups')
    key('ArrowDown')
    expect(live()).toBe('Work, position 2 of 3')
    key('Space')
    expect(commitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'group', id: 'work' }), expect.objectContaining({ type: 'group', id: 'extra', after: false }))
  })

  it('Up from the first saved group wraps to the bottom and never targets Now Open', async () => {
    const { rows } = await setup()
    await begin(rows, 'group', 'work')
    key('ArrowUp')
    expect(live()).toBe('Wrapped to bottom. Work, last')
    key('Space')
    const over = commitSpy.mock.calls[0][1]
    expect(over.id).not.toBe('now')
    expect(over.id).toBe('extra')
    expect(over.after).toBe(true)
  })
})
