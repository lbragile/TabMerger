/**
 * sidePanelUnifiedDnd.test.tsx — RED PHASE (TDD)
 *
 *   Item 2 — `SidePanel` must stop hosting its own `<DndContext>` /
 *            `useGroupDndHandlers` and instead render only a `SortableContext`
 *            whose `items` are MODEL ids (`group.id`), not positional
 *            `group-{realIndex}` strings.
 *
 *   Item 3 — `GroupItem` must register both its `useSortable` and its
 *            `useDroppable` under `group.id` (not `group-{groupIndex}`), and the
 *            droppable `data` must be `{ type: 'group', groupId: group.id,
 *            index: groupIndex }`.
 *
 *   Item 7 (visual slice) — a non-anchor row that is part of an active multi-drag
 *            selection renders at `opacity: 0.4`.
 *
 * Both components exist — failures here are ASSERTIONS about the wrong id scheme /
 * a stray `DndContext` / a missing dim style, not missing imports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import { GroupItem } from '@/components/SidePanel/GroupItem'
import type { Group, GroupsState } from '@/lib/types'

const { cap, mockUseGroupDndHandlers, mockUseUIStore, mockUseGroups, mockUseDndContext } = vi.hoisted(() => ({
  cap: {
    dndContextCount: 0,
    sortableContextItems: [] as unknown[][],
    sortableContextStrategy: undefined as unknown,
    sortableCalls: [] as Array<{ id?: unknown }>,
    droppableCalls: [] as Array<{ id?: unknown; data?: Record<string, unknown> }>,
    droppableIsOver: false
  },
  mockUseGroupDndHandlers: vi.fn(() => ({ onDragEnd: vi.fn() })),
  mockUseUIStore: vi.fn(),
  mockUseGroups: vi.fn(),
  mockUseDndContext: vi.fn(() => ({ overrideState: null, active: null, isDragging: false }))
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => {
    cap.dndContextCount += 1
    return React.createElement(React.Fragment, null, children)
  },
  closestCenter: vi.fn(),
  useDroppable: (opts: { id?: unknown; data?: Record<string, unknown> }) => {
    cap.droppableCalls.push(opts)
    return { setNodeRef: vi.fn(), isOver: cap.droppableIsOver }
  }
}))

vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  // spread the REAL module so `verticalListSortingStrategy` stays the actual
  // function (needed to assert-by-reference that it — not a no-op — is what
  // gets passed to SortableContext; see "reinstated live sibling reflow" below).
  ...(await importOriginal<typeof import('@dnd-kit/sortable')>()),
  SortableContext: ({ items, strategy, children }: { items: unknown[]; strategy?: unknown; children: React.ReactNode }) => {
    cap.sortableContextItems.push(items)
    cap.sortableContextStrategy = strategy
    return React.createElement(React.Fragment, null, children)
  },
  useSortable: (opts: { id?: unknown }) => {
    cap.sortableCalls.push(opts)
    return {
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: false
    }
  }
}))

vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useGroupDndHandlers: () => mockUseGroupDndHandlers(),
  setBodyDragCursor: vi.fn()
}))

vi.mock('@/components/dnd/DndProvider', () => ({
  DndProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useDndContext: () => mockUseDndContext()
}))

vi.mock('@/components/SidePanel/GroupContextMenu', () => ({
  GroupContextMenu: ({
    children,
    wrapperRef,
    wrapperClassName,
    wrapperStyle
  }: {
    children: React.ReactNode
    wrapperRef?: (n: HTMLElement | null) => void
    wrapperClassName?: string
    wrapperStyle?: React.CSSProperties
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'group-wrapper', ref: wrapperRef, className: wrapperClassName, style: wrapperStyle },
      children
    )
}))

vi.mock('@/components/ColorPicker', () => ({ ColorPicker: () => null }))

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroupName: () => ({ mutate: vi.fn() }),
  useUpdateGroupColor: () => ({ mutate: vi.fn() }),
  useToggleGroupStar: () => ({ mutate: vi.fn() }),
  useGroups: () => mockUseGroups()
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ maxGroups: Infinity, tier: 'pro' }),
  isOverFreeLimit: () => false
}))

vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: [] }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false })
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

class MockResizeObserver {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(t: Element) {
    this.cb([{ target: t } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: `g-${Math.random()}`,
    name: 'Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [{ id: 1, name: 'W1', tabs: [{ id: 1, title: 'T', url: 'https://a' }], starred: false, incognito: false, focused: false }],
    permanent: false,
    starred: false,
    ...overrides
  }
}
function makeGroupsState(groups: Group[]): GroupsState {
  return { available: groups, active: { id: groups[0]?.id ?? '', index: 0 } }
}

const baseUIState = {
  selectionMode: false,
  activeGroupIndex: 0,
  setActiveGroupIndex: vi.fn(),
  setRenameTarget: vi.fn(),
  renameTarget: null as unknown,
  selectedItems: [] as { type: string; id: string }[],
  toggleSelection: vi.fn(),
  enterSelectionMode: vi.fn()
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  cap.dndContextCount = 0
  cap.sortableContextItems = []
  cap.sortableCalls = []
  cap.droppableCalls = []
  cap.droppableIsOver = false
  mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  mockUseGroups.mockReturnValue({ data: { available: [makeGroup(), makeGroup()], active: { id: '', index: 0 } } })
  mockUseDndContext.mockReturnValue({ overrideState: null, active: null, isDragging: false })
})

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector)
}))

// ─────────────────────────────────────────────────────────────────────────────
// Item 2 — SidePanel migrated off its own DndContext
// ─────────────────────────────────────────────────────────────────────────────

describe('SidePanel — migrated onto the unified DnD layer (item 2)', () => {
  const state = makeGroupsState([
    makeGroup({ id: 'now', permanent: true, name: 'Now Open' }),
    makeGroup({ id: 'alpha', name: 'Alpha' }),
    makeGroup({ id: 'beta', name: 'Beta' })
  ])

  it('does not render its own <DndContext> (relies on the app-level provider)', () => {
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(cap.dndContextCount).toBe(0)
  })

  it('feeds SortableContext the MODEL group ids (group.id), not positional "group-N"', () => {
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(cap.sortableContextItems.at(-1)).toEqual(['now', 'alpha', 'beta'])
  })

  it('uses the REAL verticalListSortingStrategy — not a no-op — so sibling rows live-reflow during a drag', async () => {
    // Regression guard: a prior round swapped this for `() => null` to kill a
    // post-drop flicker, but that also killed the classic "siblings slide out of
    // the way" preview. It's back — pin it so it can't silently regress again.
    const { verticalListSortingStrategy } = await import('@dnd-kit/sortable')
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(cap.sortableContextStrategy).toBe(verticalListSortingStrategy)
  })

  it('no longer calls the legacy useGroupDndHandlers hook', () => {
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(mockUseGroupDndHandlers).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 3 — GroupItem uses model ids for sortable + droppable
// ─────────────────────────────────────────────────────────────────────────────

describe('GroupItem — model-id sortable & droppable (item 3)', () => {
  function renderItem(group: Group, groupIndex: number) {
    return wrap(
      React.createElement(GroupItem, { group, groupIndex, isActive: false, onClick: vi.fn() })
    )
  }

  it('registers its sortable under group.id, not "group-{index}"', () => {
    renderItem(makeGroup({ id: 'grp-xyz' }), 3)
    expect(cap.sortableCalls.some((c) => c.id === 'grp-xyz')).toBe(true)
    expect(cap.sortableCalls.some((c) => c.id === 'group-3')).toBe(false)
  })

  it('registers its droppable under group.id with data { type, groupId, index }', () => {
    renderItem(makeGroup({ id: 'grp-xyz' }), 3)
    const call = cap.droppableCalls.find((c) => c.id === 'grp-xyz')
    expect(call).toBeDefined()
    expect(call?.data).toMatchObject({ type: 'group', groupId: 'grp-xyz', index: 3 })
  })

  it('shows a drop affordance on the row while a compatible item is dragged over it', () => {
    cap.droppableIsOver = true
    renderItem(makeGroup({ id: 'grp-xyz' }), 1)
    const wrapper = screen.getByTestId('group-wrapper')
    expect(wrapper.className).toMatch(/ring/)
  })

  it('dims a non-anchor row that is part of an active multi-drag selection to opacity 0.4', () => {
    mockUseDndContext.mockReturnValue({
      overrideState: null,
      isDragging: true,
      active: { id: 'some-other-row', type: 'window', selectionIds: ['grp-xyz', 'some-other-row'] }
    } as never)
    renderItem(makeGroup({ id: 'grp-xyz' }), 2)
    const wrapper = screen.getByTestId('group-wrapper')
    expect(wrapper.style.opacity).toBe('0.4')
  })
})
