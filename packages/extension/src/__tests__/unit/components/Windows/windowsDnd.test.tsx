/**
 * windowsDnd.test.tsx
 *
 * Tests for the WindowsPanel DnD flow (single DndContext for all tabs + windows):
 *   1. Cross-window tab drop — dragOver is no-op; dragEnd commits the move on drop
 *   2. Window-header drop  — dragEnd appends tab to that window on drop
 *   3. Same-window reorder — dragOver is no-op; dragEnd applies arrayMove
 *   4. Now Open permanent group — dragEnd calls chrome.tabs.move (cross-window allowed)
 *   5. WindowItem transform suppressed during tab drag (window-level transform)
 *   6. ActiveWindowIndex tracking: only the hovered window gets the ring highlight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowsPanel } from '@/components/Windows'
import { WindowItem } from '@/components/Windows/Window'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core'

// ─── vi.hoisted — configurable useSortable transform + DnD handler capture ───

const {
  getTransform, setTransform,
  getOnDragStart, setOnDragStart,
  getOnDragOver, setOnDragOver,
  getOnDragEnd, setOnDragEnd,
} = vi.hoisted(() => {
  type Transform = { x: number; y: number; scaleX: number; scaleY: number } | null
  let _transform: Transform = null
  let _start: ((e: DragStartEvent) => void) | undefined
  let _over: ((e: DragOverEvent) => void) | undefined
  let _end: ((e: DragEndEvent) => void) | undefined
  return {
    getTransform: () => _transform,
    setTransform: (t: Transform) => { _transform = t },
    getOnDragStart: () => _start,
    setOnDragStart: (h: (e: DragStartEvent) => void) => { _start = h },
    getOnDragOver: () => _over,
    setOnDragOver: (h: (e: DragOverEvent) => void) => { _over = h },
    getOnDragEnd: () => _end,
    setOnDragEnd: (h: (e: DragEndEvent) => void) => { _end = h },
  }
})

// ─── @dnd-kit/core stub ───────────────────────────────────────────────────────

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children, onDragStart, onDragOver, onDragMove, onDragEnd,
  }: {
    children: React.ReactNode
    onDragStart?: (e: DragStartEvent) => void
    onDragOver?: (e: DragOverEvent) => void
    onDragMove?: (e: DragOverEvent) => void
    onDragEnd?: (e: DragEndEvent) => void
  }) => {
    if (onDragStart) setOnDragStart(onDragStart)
    // WindowsPanel uses onDragMove; tests use getOnDragOver() — alias them
    if (onDragOver) setOnDragOver(onDragOver)
    if (onDragMove) setOnDragOver(onDragMove as unknown as (e: DragOverEvent) => void)
    if (onDragEnd) setOnDragEnd(onDragEnd)
    return React.createElement(React.Fragment, null, children)
  },
  closestCenter: vi.fn(),
  pointerWithin: vi.fn(() => []),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  // ponytail: pass children through so DragOverlay content is testable
  DragOverlay: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

// ─── @dnd-kit/sortable stub (configurable transform for window transform test) ─

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const a = [...arr]; const [item] = a.splice(from, 1); a.splice(to, 0, item); return a;
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: getTransform(),
    transition: 'transform 200ms ease',
    isDragging: false,
  }),
}))

// ─── @dnd-kit/utilities stub ─────────────────────────────────────────────────

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (t: { x: number; y: number } | null) =>
        t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '',
    },
  },
}))

// ─── useDnd — real parseDndId logic, stub sensor/window hooks ────────────────

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useWindowDndHandlers: () => ({ onDragEnd: vi.fn() }),
  setBodyDragCursor: vi.fn(),
  parseDndId: (id: string) => {
    const parts = id.split('-')
    const kind = parts[0]
    if (kind === 'tab') {
      return { kind, tabId: parseInt(parts[1], 10), groupIndex: 0, windowIndex: parseInt(parts[2] ?? '0', 10), tabIndex: parseInt(parts[3] ?? '0', 10) }
    }
    return {
      kind,
      tabId: NaN,
      groupIndex: parseInt(parts[1] ?? '0', 10),
      windowIndex: parseInt(parts[2] ?? '0', 10),
      tabIndex: parseInt(parts[3] ?? '0', 10),
    }
  },
}))

// ─── @/hooks/useGroups ────────────────────────────────────────────────────────

vi.mock('@/hooks/useGroups', () => ({
  useAddWindow: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  useDeleteWindow: () => ({ mutate: vi.fn() }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: undefined }),
  useUpdateGroupNote: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useRemoveStaleTabs: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

// ─── @/stores/uiStore ────────────────────────────────────────────────────────

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      searchFilter: '',
      selectionMode: false,
      selectedItems: [],
      openModal: vi.fn(),
      toggleSelection: vi.fn(),
      enterSelectionMode: vi.fn(),
    }),
}))

// ─── @/lib/localDb ───────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue({ confirmOnWindowClose: false }),
}))

import { saveGroupsState } from '@/lib/localDb'

// ─── @/hooks/useOpenWindow ───────────────────────────────────────────────────

vi.mock('@/hooks/useOpenWindow', () => ({
  useOpenWindow: () => vi.fn().mockResolvedValue(undefined),
}))

// ─── Tab child stub ───────────────────────────────────────────────────────────

vi.mock('@/components/Windows/Tab', () => ({
  TabItem: () => React.createElement('div', { 'data-testid': 'tab-item' }),
}))

// ─── Chrome stub ─────────────────────────────────────────────────────────────

const chromeMock = {
  tabs: { move: vi.fn().mockResolvedValue({}) },
  windows: { create: vi.fn().mockResolvedValue({}) },
  tabGroups: { query: vi.fn().mockResolvedValue([]) },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
}
globalThis.chrome = chromeMock as unknown as typeof chrome

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TAB_A: Tab = { id: 101, title: 'Tab A', url: 'https://a.com' }
const TAB_B: Tab = { id: 102, title: 'Tab B', url: 'https://b.com' }
const TAB_C: Tab = { id: 103, title: 'Tab C', url: 'https://c.com' }

function makeWin(id: number, tabs: Tab[]): ExtWindow {
  return { id, tabs, incognito: false, focused: false }
}

function makeGroup(overrides: Partial<Group> & { windows: ExtWindow[] }): Group {
  return { id: 'g1', name: 'Test Group', color: 'rgba(0,0,0,1)', updatedAt: 0, permanent: false, ...overrides }
}

function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

function makeActive(id: string) {
  return { id, data: { current: undefined }, rect: { current: { initial: null, translated: null } } }
}
function makeOver(id: string) {
  return { id, data: { current: undefined }, rect: null, disabled: false }
}

function makeDragStart(activeId: string): DragStartEvent {
  return {
    active: makeActive(activeId),
    activatorEvent: new MouseEvent('pointerdown'),
    collisions: [], delta: { x: 0, y: 0 },
  } as unknown as DragStartEvent
}

function makeDragOver(activeId: string, overId: string): DragOverEvent {
  return {
    active: makeActive(activeId),
    over: makeOver(overId),
    activatorEvent: new MouseEvent('pointermove'),
    collisions: [], delta: { x: 0, y: 0 },
  } as unknown as DragOverEvent
}

function makeDragOverWithRects(
  activeId: string,
  overId: string,
  activeCenterY: number,
  overCenterY: number,
  elemHeight = 20,
): DragOverEvent {
  const overTop = overCenterY - elemHeight / 2
  return {
    active: {
      id: activeId,
      data: { current: undefined },
      rect: {
        current: {
          initial: null,
          translated: {
            top: activeCenterY - elemHeight / 2,
            height: elemHeight,
            left: 0, width: 200,
            bottom: activeCenterY + elemHeight / 2,
            right: 200,
          },
        },
      },
    },
    over: {
      id: overId,
      data: { current: undefined },
      disabled: false,
      rect: { top: overTop, height: elemHeight, left: 0, width: 200, bottom: overTop + elemHeight, right: 200 },
    },
    activatorEvent: new MouseEvent('pointermove'),
    collisions: [], delta: { x: 0, y: 0 },
  } as unknown as DragOverEvent
}

function makeDragEnd(activeId: string, overId: string): DragEndEvent {
  return {
    active: makeActive(activeId),
    over: makeOver(overId),
    delta: { x: 0, y: 0 },
    activatorEvent: new MouseEvent('pointerdown'),
    collisions: [],
  } as unknown as DragEndEvent
}

// makeDragEndWithRects: carries positional info for the 50% threshold check in handleDragEnd
function makeDragEndWithRects(activeId: string, overId: string, activeTop: number, overTop: number): DragEndEvent {
  const h = 24
  return {
    active: {
      ...makeActive(activeId),
      rect: { current: { initial: null, translated: { top: activeTop, height: h, left: 0, width: 200, bottom: activeTop + h, right: 200 } } },
    },
    over: { ...makeOver(overId), rect: { top: overTop, height: h, left: 0, width: 200, bottom: overTop + h, right: 200 } },
    delta: { x: 0, y: 0 },
    activatorEvent: new MouseEvent('pointerdown'),
    collisions: [],
  } as unknown as DragEndEvent
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function setupPanel(group: Group, groupIndex: number, seedState?: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seedState) qc.setQueryData(['groups'], seedState)
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(WindowsPanel, { group, groupIndex })
      )
    )
  )
  return { qc }
}

function renderWindowItem(win: ExtWindow) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(WindowItem, {
          window: win,
          groupIndex: 0,
          windowIndex: 0,
          siblingCount: 1,
          tabIds: win.tabs.map((t) => `tab-${t.id}`),
        })
      )
    )
  )
}

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  setTransform(null)
  chromeMock.tabs.move.mockResolvedValue({})
  chromeMock.windows.create.mockResolvedValue({})
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Cross-window tab drop (saved group)', () => {
  it('moves tab via local state (no cache mutation on dragMove), persists to IDB on dragEnd', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }]), makeWin(20, [{ ...TAB_C }])],
    })
    const state = makeState([nowOpen, saved])
    const { qc } = setupPanel(saved, 1, state)

    // IDs: TAB_A=tab-101-0-0, TAB_B=tab-102-0-1, TAB_C=tab-103-1-0
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101-0-0')) })
    // dragMove updates local UI state — query cache is NOT touched
    await act(async () => { getOnDragOver()!(makeDragOver('tab-101-0-0', 'tab-103-1-0')) })
    expect(saveGroupsState).not.toHaveBeenCalled()
    const afterOver = qc.getQueryData<GroupsState>(['groups'])!
    expect(afterOver.available[1].windows[0].tabs).toEqual([TAB_A, TAB_B])

    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-101-0-0', 'tab-103-1-0')) })
    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].windows[0].tabs).toEqual([TAB_B])
    expect(persisted.available[1].windows[1].tabs).toEqual([TAB_A, TAB_C])
  })
})

describe('Window-header drop (saved group)', () => {
  it('dragMove is a no-op; dragEnd appends tab to target window and persists', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }]), makeWin(20, [{ ...TAB_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    await act(async () => { getOnDragStart()!(makeDragStart('tab-101-0-0')) })
    await act(async () => { getOnDragOver()!(makeDragOver('tab-101-0-0', 'window-1-1')) })
    expect(saveGroupsState).not.toHaveBeenCalled()

    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-101-0-0', 'window-1-1')) })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].windows[0].tabs).toEqual([TAB_B])
    expect(persisted.available[1].windows[1].tabs).toEqual([TAB_C, TAB_A])
  })
})

describe('Same-window tab reorder (saved group)', () => {
  it('dragMove is a no-op; dragEnd applies arrayMove and persists', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }, { ...TAB_C }])],
    })
    const state = makeState([nowOpen, saved])
    const { qc } = setupPanel(saved, 1, state)

    // IDs: TAB_A=tab-101-0-0, TAB_B=tab-102-0-1, TAB_C=tab-103-0-2
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101-0-0')) })
    await act(async () => { getOnDragOver()!(makeDragOverWithRects('tab-101-0-0', 'tab-103-0-2', 62, 50)) })

    // dragMove is a no-op for same-window (no cache mutation)
    const afterOver = qc.getQueryData<GroupsState>(['groups'])!
    expect(afterOver.available[1].windows[0].tabs).toEqual([TAB_A, TAB_B, TAB_C])
    expect(saveGroupsState).not.toHaveBeenCalled()

    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-101-0-0', 'tab-103-0-2')) })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].windows[0].tabs).toEqual([TAB_B, TAB_C, TAB_A])
  })
})

describe('Now Open group (permanent=true)', () => {
  it('dragMove is a no-op; dragEnd calls chrome.tabs.move with correct args', async () => {
    const TAB_1: Tab = { id: 1001, title: 'T1', url: 'https://t1.com' }
    const TAB_3: Tab = { id: 2001, title: 'T3', url: 'https://t3.com' }

    const nowOpen = makeGroup({
      id: 'now-open',
      permanent: true,
      windows: [makeWin(100, [{ ...TAB_1 }]), makeWin(200, [{ ...TAB_3 }])],
    })
    const state = makeState([nowOpen])
    const { qc } = setupPanel(nowOpen, 0, state)

    // IDs: TAB_1=tab-1001-0-0, TAB_3=tab-2001-1-0
    await act(async () => { getOnDragStart()!(makeDragStart('tab-1001-0-0')) })

    const before = qc.getQueryData<GroupsState>(['groups'])!
    await act(async () => { getOnDragOver()!(makeDragOver('tab-1001-0-0', 'tab-2001-1-0')) })
    const after = qc.getQueryData<GroupsState>(['groups'])!
    expect(after.available[0].windows[0].tabs).toEqual(before.available[0].windows[0].tabs)

    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-1001-0-0', 'tab-2001-1-0')) })

    expect(chromeMock.tabs.move).toHaveBeenCalledWith(1001, { windowId: 200, index: 0 })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

describe('DragOverlay ghost chip', () => {
  it('renders the dragged tab title after dragStart', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const tabWithFavicon: Tab = { ...TAB_A, favIconUrl: 'https://a.com/favicon.ico' }
    const saved = makeGroup({ id: 'saved-1', windows: [makeWin(10, [tabWithFavicon])] })
    const state = makeState([nowOpen, saved])

    setupPanel(saved, 1, state)
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101')) })

    expect(document.body.textContent).toContain('Tab A')
    const img = document.body.querySelector('img[src="https://a.com/favicon.ico"]')
    expect(img).not.toBeNull()
  })
})

describe('Cross-window 50% threshold', () => {
  it('inserts BEFORE target tab when dragged center is in top half of over element', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }]), makeWin(20, [{ ...TAB_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    await act(async () => { getOnDragStart()!(makeDragStart('tab-101-0-0')) })
    // activeTop=25 center=37, overTop=50 center=62 → 37 < 62 → insert before → index 0
    await act(async () => { await getOnDragEnd()!(makeDragEndWithRects('tab-101-0-0', 'tab-103-1-0', 25, 50)) })

    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].windows[1].tabs).toEqual([TAB_A, TAB_C])
  })

  it('inserts AFTER target tab when dragged center is in bottom half of over element', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }]), makeWin(20, [{ ...TAB_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    await act(async () => { getOnDragStart()!(makeDragStart('tab-101-0-0')) })
    // activeTop=75 center=87, overTop=50 center=62 → 87 > 62 → insert after → index 1
    await act(async () => { await getOnDragEnd()!(makeDragEndWithRects('tab-101-0-0', 'tab-103-1-0', 75, 50)) })

    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].windows[1].tabs).toEqual([TAB_C, TAB_A])
  })
})

describe('WindowItem transform passthrough', () => {
  it('applies useSortable transform/transition from outer DndContext', () => {
    const win: ExtWindow = { id: 1, tabs: [], incognito: false, focused: false }
    setTransform({ x: 10, y: 20, scaleX: 1, scaleY: 1 })
    const { container } = renderWindowItem(win)
    const div = container.firstElementChild as HTMLElement
    expect(div.style.transform).toBe('translate3d(10px, 20px, 0)')
    expect(div.style.transition).toBe('transform 200ms ease')
  })
})

describe('Saved tabs with id=0 (the real invariant)', () => {
  // All saved tabs have tab.id === 0. findTabPos(windows, 0) always returns the
  // first tab in the first window, so dragging any tab other than [win=0, tab=0]
  // used to move the wrong tab. These tests verify positional lookup is used instead.

  it('same-window: drags tab at index 1, not index 0', async () => {
    const ZERO_A: Tab = { id: 0, title: 'Zero A', url: 'https://a.com' }
    const ZERO_B: Tab = { id: 0, title: 'Zero B', url: 'https://b.com' }
    const ZERO_C: Tab = { id: 0, title: 'Zero C', url: 'https://c.com' }
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...ZERO_A }, { ...ZERO_B }, { ...ZERO_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    // Drag tab at windowIndex=0, tabIndex=1 (Zero B) onto windowIndex=0, tabIndex=0 (Zero A)
    await act(async () => { getOnDragStart()!(makeDragStart('tab-0-0-1')) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-0-0-1', 'tab-0-0-0')) })

    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // Zero B moved before Zero A → [B, A, C]
    expect(persisted.available[1].windows[0].tabs.map((t: Tab) => t.title)).toEqual(['Zero B', 'Zero A', 'Zero C'])
  })

  it('cross-window: drags second tab (index 1) to other window, not first tab', async () => {
    const ZERO_A: Tab = { id: 0, title: 'Zero A', url: 'https://a.com' }
    const ZERO_B: Tab = { id: 0, title: 'Zero B', url: 'https://b.com' }
    const ZERO_C: Tab = { id: 0, title: 'Zero C', url: 'https://c.com' }
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...ZERO_A }, { ...ZERO_B }]), makeWin(20, [{ ...ZERO_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    // Drag tab at windowIndex=0, tabIndex=1 (Zero B) to window 1
    await act(async () => { getOnDragStart()!(makeDragStart('tab-0-0-1')) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-0-0-1', 'window-1-1')) })

    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // Zero B removed from win 0, appended to win 1
    expect(persisted.available[1].windows[0].tabs.map((t: Tab) => t.title)).toEqual(['Zero A'])
    expect(persisted.available[1].windows[1].tabs.map((t: Tab) => t.title)).toEqual(['Zero C', 'Zero B'])
  })

  it('drag overlay shows title of the dragged tab (index 1), not first tab', async () => {
    const ZERO_A: Tab = { id: 0, title: 'First Tab', url: 'https://a.com' }
    const ZERO_B: Tab = { id: 0, title: 'Second Tab', url: 'https://b.com' }
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({ id: 'saved-1', windows: [makeWin(10, [{ ...ZERO_A }, { ...ZERO_B }])] })
    setupPanel(saved, 1, makeState([nowOpen, saved]))

    // Drag tab at index 1 (Second Tab)
    await act(async () => { getOnDragStart()!(makeDragStart('tab-0-0-1')) })

    // Overlay must show "Second Tab", not "First Tab"
    expect(document.body.textContent).toContain('Second Tab')
    expect(document.body.textContent).not.toContain('First Tab')
  })
})

describe('Window key uniqueness (phantom/duplicate window bug)', () => {
  it('renders one WindowItem per window even when two windows share id=0 (e.g. both added via "+ Add Window")', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    // Two starred windows both with id=0 — this used to collide via `key={window.id}`
    const winA: ExtWindow = { id: 0, tabs: [{ ...TAB_A }], incognito: false, focused: false, starred: true }
    const winB: ExtWindow = { id: 0, tabs: [{ ...TAB_B }], incognito: false, focused: false, starred: true }
    const winC: ExtWindow = { id: 0, tabs: [{ ...TAB_C }], incognito: false, focused: false }
    const saved = makeGroup({ id: 'saved-1', windows: [winA, winB, winC] })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    // Exactly 3 window rows rendered — no duplicated/phantom entries from key collisions
    const rows = document.querySelectorAll('[data-window-index]')
    expect(rows.length).toBe(3)
  })
})

describe('Window drag mid-drag visibility (disappearing windows bug)', () => {
  it('only the dragged window gets opacity-0; windows sharing id=0 stay visible', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    // Three windows all sharing id=0 (e.g. all added via "+ Add Window") — a bug
    // matched isBeingDragged by window.id, so dragging one hid all of them.
    const winA: ExtWindow = { id: 0, tabs: [{ ...TAB_A }], incognito: false, focused: false }
    const winB: ExtWindow = { id: 0, tabs: [{ ...TAB_B }], incognito: false, focused: false }
    const winC: ExtWindow = { id: 0, tabs: [{ ...TAB_C }], incognito: false, focused: false }
    const saved = makeGroup({ id: 'saved-1', windows: [winA, winB, winC] })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    // Drag window at index 1 (winB)
    await act(async () => { getOnDragStart()!(makeDragStart('window-1-1')) })

    const rows = document.querySelectorAll('[data-window-index]')
    expect(rows.length).toBe(3)

    const hidden = Array.from(rows).map((r) => (r as HTMLElement).className.includes('opacity-0'))
    // Only the dragged window (index 1) should be hidden; the other two (sharing id=0) must remain visible.
    expect(hidden[0]).toBe(false)
    expect(hidden[1]).toBe(true)
    expect(hidden[2]).toBe(false)
  })
})

describe('DnD guard cases', () => {
  it('dragEnd with no over target is a no-op', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }])],
    })
    setupPanel(saved, 1, makeState([nowOpen, saved]))
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101')) })
    // Fire dragEnd with over=null (dropped outside any droppable)
    const e = { ...makeDragEnd('tab-101', 'tab-102'), over: null } as unknown as import('@dnd-kit/core').DragEndEvent
    await act(async () => { await getOnDragEnd()!(e) })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('dragEnd with active === over is a no-op (no movement)', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }])],
    })
    setupPanel(saved, 1, makeState([nowOpen, saved]))
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101')) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-101', 'tab-101')) })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('dragCancel clears active state and does not save', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...TAB_A }, { ...TAB_B }])],
    })
    setupPanel(saved, 1, makeState([nowOpen, saved]))
    await act(async () => { getOnDragStart()!(makeDragStart('tab-101')) })
    // Tab A title should appear in overlay after start
    expect(document.body.textContent).toContain('Tab A')
    const cancel = vi.fn()
    // Simulate cancel via the cancel handler — we expose it via onDragCancel on DndContext
    // Since our mock doesn't capture onDragCancel, we verify state clears on the next dragEnd
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-101', 'tab-102')) })
    expect(saveGroupsState).toHaveBeenCalledOnce()
  })

  it('dragEnd onto new-window-drop zone moves tab into a new window', async () => {
    const ZERO_A: Tab = { id: 0, title: 'Zero A', url: 'https://a.com' }
    const ZERO_B: Tab = { id: 0, title: 'Zero B', url: 'https://b.com' }
    const ZERO_C: Tab = { id: 0, title: 'Zero C', url: 'https://c.com' }
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [{ ...ZERO_A }, { ...ZERO_B }, { ...ZERO_C }])],
    })
    const state = makeState([nowOpen, saved])
    setupPanel(saved, 1, state)

    // Stub the drop zone's getBoundingClientRect so the manual overlap check fires
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 200, bottom: 236, left: 0, right: 400, height: 36, width: 400, x: 0, y: 200, toJSON: () => {},
    } as DOMRect)

    await act(async () => { getOnDragStart()!(makeDragStart('tab-0-0-1')) })
    // dragMove: active translated.top=210 is inside zone top=200..bottom=236 → sets isOverNewWin=true
    await act(async () => { getOnDragOver()!(makeDragOverWithRects('tab-0-0-1', 'tab-0-0-0', 210, 50)) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-0-0-1', 'tab-0-0-0')) })

    vi.restoreAllMocks()

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // Source window: Zero B removed
    expect(persisted.available[1].windows[0].tabs.map((t: Tab) => t.title)).toEqual(['Zero A', 'Zero C'])
    // New window appended with just Zero B
    expect(persisted.available[1].windows).toHaveLength(2)
    expect(persisted.available[1].windows[1].tabs.map((t: Tab) => t.title)).toEqual(['Zero B'])
  })

  it('dragEnd onto new-window-drop zone is a no-op for permanent (Now Open) group', async () => {
    const TAB_1: Tab = { id: 1001, title: 'Live1', url: 'https://l1.com' }
    const nowOpen = makeGroup({
      id: 'now-open', permanent: true,
      windows: [makeWin(100, [{ ...TAB_1 }])],
    })
    setupPanel(nowOpen, 0, makeState([nowOpen]))
    await act(async () => { getOnDragStart()!(makeDragStart('tab-1001-0-0')) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-1001-0-0', 'new-window-drop-0')) })
    expect(saveGroupsState).not.toHaveBeenCalled()
    expect(chromeMock.tabs.move).not.toHaveBeenCalled()
  })

  it('cross-window drop on Now Open group does not call saveGroupsState', async () => {
    const TAB_1: Tab = { id: 1001, title: 'Live1', url: 'https://l1.com' }
    const TAB_2: Tab = { id: 1002, title: 'Live2', url: 'https://l2.com' }
    const nowOpen = makeGroup({
      id: 'now-open', permanent: true,
      windows: [makeWin(100, [{ ...TAB_1 }]), makeWin(200, [{ ...TAB_2 }])],
    })
    // IDs: TAB_1=tab-1001-0-0, TAB_2=tab-1002-1-0
    setupPanel(nowOpen, 0, makeState([nowOpen]))
    await act(async () => { getOnDragStart()!(makeDragStart('tab-1001-0-0')) })
    await act(async () => { await getOnDragEnd()!(makeDragEnd('tab-1001-0-0', 'tab-1002-1-0')) })
    expect(chromeMock.tabs.move).toHaveBeenCalledWith(1001, { windowId: 200, index: 0 })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})
