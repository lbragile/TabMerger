/**
 * useKeyboardMoveReanchor.test.tsx — keyboard MOVE MODE on a groups cache that changes while
 * an item is picked up, run through the REAL commit (`useDndHandlers.commitKeyboardMove` ->
 * `commitResolved`) so every case is checked on what is written.
 *
 * The rule: the picked-up item stays the SAME item. On each cache update it is re-anchored by
 * identity (`rebaseMove`); the drop moves that item and no other. When it can no longer be
 * identified (gone, identical duplicates permuted, or a missing selection member that may have
 * been edited) the move is cancelled with "The groups changed, so the movement was cancelled."
 * and nothing is written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React, { useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildDndModel } from '@/hooks/useDndModel'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { clearDndDragLive, isDndDragLive } from '@/lib/dndMultiDrag'
import { saveGroupsState } from '@/lib/localDb'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const { ctx } = vi.hoisted(() => ({
  ctx: { current: { commitKeyboardMove: async () => {}, applyGap: () => {} } as { commitKeyboardMove: unknown; applyGap: unknown } }
}))

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
// The controller reads the commit from the provider's context: hand it the real handlers'.
vi.mock('@/components/dnd/DndProvider', () => ({ useDndContext: () => ctx.current }))

import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useKeyboardMove } from '@/hooks/useKeyboardMove'

const STALE = 'The groups changed, so the movement was cancelled.'

const tab = (title: string, extra: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...extra })
const win = (titles: string[], extra: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs: titles.map((t) => tab(t)), incognito: false, focused: false, ...extra })
const grp = (id: string, name: string, windows: ExtWindow[], extra: Partial<Group> = {}): Group => ({
  id,
  name,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...extra
})
const seed = (work: ExtWindow[]): GroupsState => ({
  active: { id: 'now', index: 0 },
  available: [grp('now', 'Now Open', [], { permanent: true }), grp('work', 'Work', work), grp('play', 'Play', [win(['Papa'])])]
})
const titles = (s: GroupsState, id: string) => s.available.find((g) => g.id === id)!.windows.map((w) => w.tabs.map((t) => t.title))

function Controller() {
  const host = useRef<HTMLDivElement>(null)
  useKeyboardMove(host)
  return <div ref={host} tabIndex={-1} data-testid="host" />
}
function Probe() {
  const handlers = useDndHandlers()
  ctx.current = { commitKeyboardMove: handlers.commitKeyboardMove, applyGap: handlers.applyGap }
  return <Controller />
}

/** A 30px row for every model id of `s` that has none yet (what React renders after a cache update). */
function mountRows(s: GroupsState) {
  const m = buildDndModel(s)
  for (const id of [...Object.keys(m.groups), ...Object.keys(m.windows), ...Object.keys(m.tabs)]) {
    if (document.querySelector(`[data-tm-dnd-id="${id}"]`)) continue
    const el = document.createElement('div')
    el.setAttribute('data-tm-dnd-id', id)
    el.tabIndex = 0
    el.scrollIntoView = vi.fn()
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30, x: 0, y: 0, toJSON: () => ({}) })
    document.body.appendChild(el)
  }
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-tm-dnd-id="${id}"]`)!

let qc: QueryClient
const cached = () => qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)!
const live = () => document.getElementById('tm-dnd-live-region')?.textContent?.trim() ?? ''
const saved = () => vi.mocked(saveGroupsState).mock.calls.at(-1)?.[0] as GroupsState | undefined
const key = (code: string) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }))
  })
/** Let the commit's async tail, the outcome announcement and the follow frames run. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 300))
  })

async function setup(work: ExtWindow[]) {
  qc.setQueryData(GROUPS_QUERY_KEY, seed(work))
  mountRows(cached())
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>
  )
}
async function pickUp(kind: 'tab' | 'window' | 'group', id: string) {
  row(id).focus()
  act(() => {
    useKeyboardMoveStore.getState().requestMove(kind, id)
  })
  await act(async () => {
    await Promise.resolve()
  })
}
/** Another writer replaces the Work group's windows (a sync pull, another surface). */
function remoteWork(work: ExtWindow[]) {
  const s = cached()
  const next: GroupsState = { ...s, available: s.available.map((g) => (g.id === 'work' ? { ...g, updatedAt: 2, windows: work } : g)) }
  act(() => {
    qc.setQueryData(GROUPS_QUERY_KEY, next)
  })
  mountRows(next)
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  clearDndDragLive()
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  useKeyboardMoveStore.setState({ request: null, kind: null, marker: null })
})
afterEach(() => {
  clearDndDragLive()
  vi.unstubAllGlobals()
})

describe('keyboard move — the picked-up WINDOW stays the same item when the groups change', () => {
  it('windows reordered while one is picked up: the drop moves the picked-up window, not the one now at its old position', async () => {
    await setup([win(['Alpha']), win(['Bravo']), win(['Charlie'])])
    await pickUp('window', 'work::w0') // Alpha
    key('ArrowDown') // the slot between the two other windows
    remoteWork([win(['Bravo']), win(['Charlie']), win(['Alpha'])]) // Alpha is now last; Bravo sits at its old position
    expect(useKeyboardMoveStore.getState().kind).toBe('window')
    key('Space')
    await settle()
    expect(titles(cached(), 'work')).toEqual([['Bravo'], ['Alpha'], ['Charlie']])
    expect(titles(saved()!, 'work')).toEqual([['Bravo'], ['Alpha'], ['Charlie']])
    expect(vi.mocked(saveGroupsState)).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a window removed before the picked-up one (positions shift): the picked-up window still moves', async () => {
    await setup([win(['Xray']), win(['Alpha']), win(['Bravo'])])
    await pickUp('window', 'work::w1') // Alpha
    remoteWork([win(['Alpha']), win(['Bravo'])])
    expect(row('work::w0').hasAttribute('data-tm-move-source')).toBe(true)
    key('ArrowDown')
    expect(live()).toBe('Window 1, last in Work')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Bravo'], ['Alpha']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a window added before the picked-up one: its row mounts with the render, and the picked-up window still moves', async () => {
    await setup([win(['Alpha']), win(['Bravo'])])
    await pickUp('window', 'work::w0') // Alpha
    remoteWork([win(['Xray']), win(['Alpha']), win(['Bravo'])])
    await settle() // the follow frames rebuild the targets from the rows that are now rendered
    expect(row('work::w1').style.getPropertyValue('height')).toBe('0px')
    expect(row('work::w0').style.getPropertyValue('height')).toBe('')
    key('ArrowDown')
    expect(live()).toBe('Window 2, last in Work')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Xray'], ['Bravo'], ['Alpha']])
  })

  it('the picked-up window itself removed: cancelled with the message, nothing written', async () => {
    await setup([win(['Alpha']), win(['Bravo']), win(['Charlie'])])
    await pickUp('window', 'work::w0')
    remoteWork([win(['Bravo']), win(['Charlie'])])
    expect(live()).toBe(STALE)
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(isDndDragLive()).toBe(false)
    const after = cached()
    key('ArrowDown')
    key('Space')
    await settle()
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
    expect(cached()).toBe(after)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('two identical windows permuted around a stable neighbour: cancelled, nothing written', async () => {
    await setup([win(['Same']), win(['Other']), win(['Same'])])
    await pickUp('window', 'work::w0') // the first "Same"
    remoteWork([win(['Other']), win(['Same']), win(['Same'])])
    expect(live()).toBe(STALE)
    expect(useKeyboardMoveStore.getState().kind).toBeNull()
    expect(document.querySelectorAll('[data-testid="drag-ghost"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-tm-move-source]')).toHaveLength(0)
    // focus is back on the row the move started from, and the move's keys are no longer captured
    expect(document.activeElement).toBe(row('work::w0'))
    key('ArrowDown')
    key('ArrowDown')
    key('Space')
    await settle()
    expect(live()).toBe(STALE)
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
    expect(titles(cached(), 'work')).toEqual([['Other'], ['Same'], ['Same']])
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('identical windows that only shift together (nothing permuted) are still told apart by rank', async () => {
    await setup([win(['Same']), win(['Other']), win(['Same'])])
    await pickUp('window', 'work::w2') // the second "Same"
    remoteWork([win(['Xray']), win(['Same']), win(['Other']), win(['Same'])])
    await settle()
    expect(useKeyboardMoveStore.getState().kind).toBe('window')
    key('ArrowUp') // before "Other"
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Xray'], ['Same'], ['Same'], ['Other']])
  })

  it('the group list reordered (window ids keep their group): the picked-up window is the one dropped', async () => {
    await setup([win(['Alpha']), win(['Bravo'])])
    await pickUp('window', 'work::w0')
    key('ArrowDown')
    const s = cached()
    act(() => {
      qc.setQueryData(GROUPS_QUERY_KEY, { ...s, available: [s.available[0], s.available[1], { ...s.available[2], name: 'Play 2', updatedAt: 3 }] })
    })
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Bravo'], ['Alpha']])
  })
})

describe('keyboard move — the picked-up TAB(S) stay the same item(s) when the groups change', () => {
  it('a tab removed before the picked-up tab: the picked-up tab still moves', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie'])])
    await pickUp('tab', 'work::w0::t1') // Bravo
    remoteWork([win(['Bravo', 'Charlie'])])
    expect(row('work::w0::t0').hasAttribute('data-tm-move-source')).toBe(true)
    expect(row('work::w0::t1').hasAttribute('data-tm-move-source')).toBe(false)
    key('ArrowDown')
    expect(live()).toBe('Bravo, last in Window 1')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Charlie', 'Bravo']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('the picked-up tab edited elsewhere (it can no longer be identified): cancelled, nothing written', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie'])])
    await pickUp('tab', 'work::w0::t1')
    remoteWork([{ ...win(['Alpha']), tabs: [tab('Alpha'), tab('Bravo', { note: 'edited' }), tab('Charlie')] }])
    expect(live()).toBe(STALE)
    key('Space')
    await settle()
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
  })

  it('a multi-selection is re-anchored as a whole: both tabs move as one block from their new positions', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie', 'Delta'])])
    useUIStore.setState({
      selectionMode: true,
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })
    await pickUp('tab', 'work::w0::t1') // Bravo + Charlie
    expect(live()).toMatch(/^Picked up 2 tabs\./)
    remoteWork([win(['Zulu', 'Alpha', 'Bravo', 'Charlie', 'Delta'])])
    await settle()
    for (const id of ['work::w0::t2', 'work::w0::t3']) expect(row(id).hasAttribute('data-tm-move-source')).toBe(true)
    expect(row('work::w0::t1').hasAttribute('data-tm-move-source')).toBe(false)
    key('ArrowDown') // after Delta
    expect(live()).toBe('2 tabs, last in Window 1')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Zulu', 'Alpha', 'Delta', 'Bravo', 'Charlie']])
    expect(vi.mocked(saveGroupsState)).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a selection member deleted elsewhere is left out; the rest of the selection still moves', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie', 'Delta'])])
    useUIStore.setState({
      selectionMode: true,
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })
    await pickUp('tab', 'work::w0::t1') // Bravo + Charlie
    expect(document.querySelector('[data-testid="drag-ghost-count"]')?.textContent).toBe('+1')
    remoteWork([win(['Alpha', 'Bravo', 'Delta'])]) // Charlie deleted
    expect(useKeyboardMoveStore.getState().kind).toBe('tab')
    expect(document.querySelector('[data-testid="drag-ghost-count"]')).toBeNull()
    key('ArrowDown')
    expect(live()).toBe('Bravo, last in Window 1')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Alpha', 'Delta', 'Bravo']])
  })

  it('a selection member that may have been edited elsewhere cancels the whole move, nothing written', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie', 'Delta'])])
    useUIStore.setState({
      selectionMode: true,
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })
    await pickUp('tab', 'work::w0::t1')
    remoteWork([{ ...win(['Alpha']), tabs: [tab('Alpha'), tab('Bravo'), tab('Charlie', { customTitle: 'Renamed' }), tab('Delta')] }])
    expect(live()).toBe(STALE)
    key('Space')
    await settle()
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
  })
})

describe('keyboard move — no cache change', () => {
  it('pick up, Down, Space commits that one move with one undo step', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie'])])
    await pickUp('tab', 'work::w0::t0')
    key('ArrowDown')
    expect(live()).toBe('Alpha, position 2 of 3 in Window 1')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Bravo', 'Alpha', 'Charlie']])
    expect(vi.mocked(saveGroupsState)).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(isDndDragLive()).toBe(false)
  })

  it('a cache update that leaves the groups as they are changes nothing about the move', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie'])])
    await pickUp('tab', 'work::w0::t0')
    key('ArrowDown')
    const text = live()
    remoteWork([win(['Alpha', 'Bravo', 'Charlie'])]) // same content, new objects
    await settle()
    expect(live()).toBe(text)
    expect(row('work::w0::t0').hasAttribute('data-tm-move-source')).toBe(true)
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Bravo', 'Alpha', 'Charlie']])
  })
})

describe('keyboard move — further re-anchor cases', () => {
  const selectBravoCharlie = () =>
    useUIStore.setState({
      selectionMode: true,
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })

  it('a re-anchored multi-item drop leaves the moved tabs (not their old positions) selected', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie', 'Delta'])])
    selectBravoCharlie()
    await pickUp('tab', 'work::w0::t1') // Bravo + Charlie
    remoteWork([win(['Zulu', 'Alpha', 'Bravo', 'Charlie', 'Delta'])])
    await settle()
    key('ArrowDown') // after Delta
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Zulu', 'Alpha', 'Delta', 'Bravo', 'Charlie']])
    // Bravo and Charlie now sit at tab indexes 3 and 4 of the first window of group 1
    const ids = useUIStore
      .getState()
      .selectedItems.map((s) => s.id)
      .sort()
    expect(ids).toEqual(['tab-1-0-3', 'tab-1-0-4'])
  })

  it('the picked-up tab moved to ANOTHER window elsewhere: it is still the tab that moves', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie']), win(['Delta', 'Echo'])])
    await pickUp('tab', 'work::w0::t1') // Bravo
    remoteWork([win(['Alpha', 'Charlie']), win(['Delta', 'Bravo', 'Echo'])])
    expect(row('work::w1::t1').hasAttribute('data-tm-move-source')).toBe(true)
    expect(row('work::w0::t1').hasAttribute('data-tm-move-source')).toBe(false)
    key('ArrowDown')
    key('Space')
    await settle()
    const out = titles(saved()!, 'work')
    expect(out.flat().filter((t) => t === 'Bravo')).toHaveLength(1)
    expect(out.flat().sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
    expect(out[0]).toEqual(['Alpha', 'Charlie'])
    expect(vi.mocked(saveGroupsState)).toHaveBeenCalledTimes(1)
  })

  it('Now Open changing underneath (live tabs opened) does not disturb a picked-up saved tab', async () => {
    await setup([win(['Alpha', 'Bravo', 'Charlie'])])
    await pickUp('tab', 'work::w0::t0') // Alpha
    const s = cached()
    const next: GroupsState = { ...s, available: s.available.map((g) => (g.id === 'now' ? { ...g, windows: [win(['Live1', 'Live2'])] } : g)) }
    act(() => {
      qc.setQueryData(GROUPS_QUERY_KEY, next)
    })
    mountRows(next)
    await settle()
    expect(useKeyboardMoveStore.getState().kind).toBe('tab')
    expect(live()).not.toBe(STALE)
    key('ArrowDown')
    key('Space')
    await settle()
    expect(titles(saved()!, 'work')).toEqual([['Bravo', 'Alpha', 'Charlie']])
    expect(titles(saved()!, 'now')).toEqual([['Live1', 'Live2']])
  })
})
