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

const { cap, mockUseGroupDndHandlers, mockUseUIStore, mockUseGroups, mockUseDndContext, mockUseEntitlements } = vi.hoisted(() => ({
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
  mockUseDndContext: vi.fn(() => ({ overrideState: null, active: null, isDragging: false })),
  mockUseEntitlements: vi.fn(() => ({ maxGroups: Infinity, tier: 'pro' }))
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
  useEntitlements: () => mockUseEntitlements(),
  isOverFreeLimit: () => false
}))

vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: [] }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveSession: () => ({ mutateAsync: vi.fn() })
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
  openModal: vi.fn(),
  renameTarget: null as unknown,
  selectedItems: [] as { type: string; id: string }[],
  toggleSelection: vi.fn(),
  enterSelectionMode: vi.fn(),
  selectRange: vi.fn(),
  selectionAnchor: null as unknown
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
  mockUseEntitlements.mockReturnValue({ maxGroups: Infinity, tier: 'pro' })
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

// ─────────────────────────────────────────────────────────────────────────────
// 2b — the sidebar "drop here for a new group" zone
// ─────────────────────────────────────────────────────────────────────────────

describe('SidePanel — "new group" drop zone (2b)', () => {
  const state = makeGroupsState([
    makeGroup({ id: 'now', permanent: true, name: 'Now Open' }),
    makeGroup({ id: 'alpha', name: 'Alpha' })
  ])
  const zone = () => screen.getByTestId('new-group-dropzone')
  const dragging = (type: string | null) =>
    mockUseDndContext.mockReturnValue({
      overrideState: null,
      active: (type ? { id: 'x', type } : null) as never,
      isDragging: !!type
    })

  it('is ALWAYS mounted, and hidden + inert when no drag is running (C4)', () => {
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(zone().className).toMatch(/invisible/)
    expect(zone().className).toMatch(/pointer-events-none/)
    expect(zone().getAttribute('aria-hidden')).toBe('true')
  })

  it('stays mounted and only flips visibility during a TAB drag', () => {
    dragging('tab')
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(zone().className).not.toMatch(/invisible/)
    expect(zone().getAttribute('aria-hidden')).toBe('false')
    expect(zone().textContent).toMatch(/new group/i)
  })

  it('is active for a WINDOW drag too, but not for a GROUP drag', () => {
    dragging('window')
    const a = wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(a.getByTestId('new-group-dropzone').className).not.toMatch(/invisible/)
    a.unmount()
    dragging('group')
    const b = wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(b.getByTestId('new-group-dropzone').className).toMatch(/invisible/)
  })

  it('registers the shared NEW_GROUP_ID droppable, disabled unless a tab/window drag is live', async () => {
    const { NEW_GROUP_ID } = await import('@/lib/dndMove')
    wrap(React.createElement(SidePanel, { groupsState: state }))
    const idle = cap.droppableCalls.find((c) => c.id === NEW_GROUP_ID)
    expect(idle).toBeTruthy()
    expect((idle as { disabled?: boolean }).disabled).toBe(true)
    expect(idle!.data).toEqual({ type: 'new-group' })

    cap.droppableCalls = []
    dragging('tab')
    wrap(React.createElement(SidePanel, { groupsState: state }))
    const live = cap.droppableCalls.find((c) => c.id === NEW_GROUP_ID)
    expect((live as { disabled?: boolean }).disabled).toBe(false)
  })

  it('takes NO layout: it is absolutely positioned over the "Add Group" button', () => {
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(zone().className).toMatch(/absolute/)
    expect(zone().parentElement!.className).toMatch(/relative/)
    // The button is its sibling inside that same box.
    expect(zone().parentElement!.textContent).toMatch(/Add Group/)
  })

  it('at the free-group cap the zone is HIDDEN, inert and silent — but still mounted (C4)', async () => {
    const { setNewGroupZoneGate, getNewGroupZoneGate } = await import('@/hooks/useDndHandlers')
    setNewGroupZoneGate(false)
    // 2 saved groups, limit 2 → at the cap.
    const capped = makeGroupsState([
      makeGroup({ id: 'now', permanent: true, name: 'Now Open' }),
      makeGroup({ id: 'alpha', name: 'Alpha' }),
      makeGroup({ id: 'beta', name: 'Beta' })
    ])
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, tier: 'free' })
    cap.droppableCalls = []
    dragging('tab')
    wrap(React.createElement(SidePanel, { groupsState: capped }))
    // User decision 2026-09-18: hide it rather than show-then-warn.
    const el = screen.getByTestId('new-group-dropzone')
    expect(el).toBeTruthy() // never unmounted mid-drag
    expect(el.className).toMatch(/invisible/)
    expect(el.className).toMatch(/pointer-events-none/)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    const { NEW_GROUP_ID } = await import('@/lib/dndMove')
    const droppable = cap.droppableCalls.find((c) => c.id === NEW_GROUP_ID)
    expect((droppable as { disabled?: boolean }).disabled).toBe(true)
    // No toast: nothing was offered, so there is nothing to explain.
    const { toast } = await import('sonner')
    expect(toast.error).not.toHaveBeenCalled()
    // The cap is still published, so a drop resolved from the throttled stream is refused.
    expect(getNewGroupZoneGate().atLimit).toBe(true)
  })

  it('below the cap the gate reads false, so the zone takes drops normally', async () => {
    const { getNewGroupZoneGate } = await import('@/hooks/useDndHandlers')
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })
    dragging('tab')
    wrap(React.createElement(SidePanel, { groupsState: state }))
    expect(screen.getByTestId('new-group-dropzone').className).not.toMatch(/invisible/)
    expect(getNewGroupZoneGate().atLimit).toBe(false)
  })
})
