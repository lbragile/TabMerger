import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowsPanel } from '@/components/Windows'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core'

// ─── vi.hoisted — capture DndContext handlers after render ────────────────────

const { getOnDragStart, setOnDragStart, getOnDragOver, setOnDragOver, getOnDragEnd, setOnDragEnd } = vi.hoisted(() => {
  let _start: ((e: DragStartEvent) => void) | undefined
  let _over: ((e: DragOverEvent) => void) | undefined
  let _end: ((e: DragEndEvent) => void) | undefined
  return {
    getOnDragStart: () => _start,
    setOnDragStart: (h: (e: DragStartEvent) => void) => { _start = h },
    getOnDragOver: () => _over,
    setOnDragOver: (h: (e: DragOverEvent) => void) => { _over = h },
    getOnDragEnd: () => _end,
    setOnDragEnd: (h: (e: DragEndEvent) => void) => { _end = h },
  }
})

// ─── DnD stubs ────────────────────────────────────────────────────────────────

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children, onDragStart, onDragOver, onDragEnd,
  }: {
    children: React.ReactNode
    onDragStart?: (e: DragStartEvent) => void
    onDragOver?: (e: DragOverEvent) => void
    onDragEnd?: (e: DragEndEvent) => void
  }) => {
    if (onDragStart) setOnDragStart(onDragStart)
    if (onDragOver) setOnDragOver(onDragOver)
    if (onDragEnd) setOnDragEnd(onDragEnd)
    return React.createElement(React.Fragment, null, children)
  },
  closestCenter: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  DragOverlay: () => null,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const a = [...arr]; const [item] = a.splice(from, 1); a.splice(to, 0, item); return a;
  },
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

// ─── useDnd — keep real parseDndId, stub hooks ───────────────────────────────

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useWindowDndHandlers: () => ({ onDragEnd: vi.fn() }),
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

// ─── Stub WindowItem to avoid its heavy deps ─────────────────────────────────

vi.mock('@/components/Windows/Window', () => ({
  WindowItem: () => React.createElement('div', { 'data-testid': 'window-item' }),
}))

// ─── useGroups — all hooks + GROUPS_QUERY_KEY ─────────────────────────────────

vi.mock('@/hooks/useGroups', () => ({
  useAddWindow: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  useUpdateGroupNote: () => ({ mutate: vi.fn() }),
  useRemoveStaleTabs: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

// ─── uiStore — static return ──────────────────────────────────────────────────

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      searchFilter: '',
      selectionMode: false,
      selectedItems: [],
      openModal: vi.fn(),
    }),
}))

// ─── localDb ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
}))

import { saveGroupsState } from '@/lib/localDb'

// ─── Chrome stub ─────────────────────────────────────────────────────────────

const chromeMock = {
  tabs: { move: vi.fn().mockResolvedValue({}) },
  tabGroups: { query: vi.fn().mockResolvedValue([]) },
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
  return {
    id: 'g1',
    name: 'Test Group',
    color: 'rgba(0,0,0,1)',
    updatedAt: 0,
    permanent: false,
    ...overrides,
  }
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
    collisions: [],
    delta: { x: 0, y: 0 },
  } as unknown as DragStartEvent
}

function makeDragOver(activeId: string, overId: string, cursorBelow = false): DragOverEvent {
  const translated = cursorBelow
    ? { top: 100, height: 24, left: 0, width: 200, bottom: 124, right: 200 }
    : null
  const overRect = cursorBelow
    ? { top: 50, height: 24, left: 0, width: 200, bottom: 74, right: 200 }
    : null
  return {
    active: { ...makeActive(activeId), rect: { current: { initial: null, translated } } },
    over: { ...makeOver(overId), rect: overRect },
    activatorEvent: new MouseEvent('pointermove'),
    collisions: [],
    delta: { x: 0, y: 0 },
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

// ─── Setup helper ─────────────────────────────────────────────────────────────

function setup(group: Group, groupIndex: number, seedState?: GroupsState) {
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

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  chromeMock.tabs.move.mockResolvedValue({})
})

// ─── Tests ────────────────────────────────────────────────────────────────────
// Tab DnD (same-window sort, Now Open chrome.tabs.move) is now handled entirely
// inside WindowItem's per-window DndContext — not WindowsPanel. Tests for that
// logic live in windowsDnd.test.tsx.

describe('WindowsPanel handleDragEnd — saved group (window reorder only)', () => {
  it('delegates to onWindowDragEnd when a window is dragged', async () => {
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin(10, [TAB_A]), makeWin(20, [TAB_B])],
    })
    setup(saved, 1)

    // dragStart captures the window; dragEnd delegates to useWindowDndHandlers
    await act(async () => { getOnDragStart()!(makeDragStart('window-1-0')) })
    await act(async () => { getOnDragEnd()!(makeDragEnd('window-1-0', 'window-1-1')) })

    // saveGroupsState not called by WindowsPanel (window reorder is handled by useWindowDndHandlers mock)
    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})
