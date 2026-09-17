/**
 * unifiedDnd.test.tsx  — RED PHASE (TDD)
 *
 * Component-level specs for the reworked popup DnD layer: ONE <DndContext> at the
 * root of the windows panel (no more per-window contexts), a real placeholder
 * reflow on `onDragOver` (NOT a drawn insertion line), a single <DragOverlay>, and
 * wired screen-reader announcements.
 *
 * CONTRACT ASSUMPTIONS (coordinate with extension-dev):
 *   - `@/hooks/useDndModel`  exports `buildDndModel` (importing it here makes the whole
 *     file RED until the rework lands — the accepted "module not found" red reason).
 *   - `@/lib/dndMove`        exports `canDrop` / `applyMove`.
 *   - `WindowsPanel` from `@/components/Windows` renders exactly one `DndContext`
 *     whose `onDragStart` / `onDragOver` / `onDragCancel` / `onDragEnd` we capture
 *     via the mock below, and passes an `accessibility={{ announcements }}` object.
 *   - During an active drag the rendered tab rows carry `[data-testid="tab-item"]`
 *     inside a `[data-window-index]` container (existing test-id convention).
 *   - NO element with `[data-insertion-line]` / `[data-testid="insertion-line"]`
 *     is ever rendered — the reflow itself is the affordance.
 *
 * If the final component API differs, these fail with import / missing-handler
 * errors (acceptable RED) and are reconciled in the green phase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
// RED anchor: this module does not exist yet.
import { buildDndModel } from '@/hooks/useDndModel'
import { WindowsPanel } from '@/components/Windows'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragCancelEvent,
  Announcements,
} from '@dnd-kit/core'

// ─── capture DnD context props ───────────────────────────────────────────────

const cap = vi.hoisted(() => {
  const store: {
    onDragStart?: (e: DragStartEvent) => void
    onDragOver?: (e: DragOverEvent) => void
    onDragCancel?: (e: DragCancelEvent) => void
    onDragEnd?: (e: DragEndEvent) => void
    announcements?: Announcements
    contextCount: number
    sortableStrategies: unknown[]
  } = { contextCount: 0, sortableStrategies: [] }
  return store
})

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: {
    children: React.ReactNode
    onDragStart?: (e: DragStartEvent) => void
    onDragOver?: (e: DragOverEvent) => void
    onDragMove?: (e: DragOverEvent) => void
    onDragCancel?: (e: DragCancelEvent) => void
    onDragEnd?: (e: DragEndEvent) => void
    accessibility?: { announcements?: Announcements }
  }) => {
    cap.contextCount += 1
    cap.onDragStart = props.onDragStart
    cap.onDragOver = props.onDragOver ?? (props.onDragMove as typeof props.onDragOver)
    cap.onDragCancel = props.onDragCancel
    cap.onDragEnd = props.onDragEnd
    cap.announcements = props.accessibility?.announcements
    return React.createElement(React.Fragment, null, props.children)
  },
  closestCenter: vi.fn(),
  pointerWithin: vi.fn(() => []),
  rectIntersection: vi.fn(() => []),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  PointerSensor: class {},
  KeyboardSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  DragOverlay: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
}))

vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  // spread the REAL module so `verticalListSortingStrategy` stays the actual
  // function reference — needed to assert it (not a no-op) is what's passed to
  // SortableContext. See "reinstated live sibling reflow" below.
  ...(await importOriginal<typeof import('@dnd-kit/sortable')>()),
  SortableContext: ({ children, strategy }: { children: React.ReactNode; strategy?: unknown }) => {
    cap.sortableStrategies.push(strategy)
    return React.createElement(React.Fragment, null, children)
  },
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const a = [...arr]
    const [it] = a.splice(from, 1)
    a.splice(to, 0, it)
    return a
  },
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null,
    transition: null, isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/components/Windows/Tab', () => ({
  TabItem: ({ tab }: { tab: Tab }) =>
    React.createElement('div', { 'data-testid': 'tab-item' }, tab.title),
}))

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
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: undefined }),
  useUpdateGroupNote: () => ({ mutate: vi.fn() }),
  useRemoveStaleTabs: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      searchFilter: '', selectionMode: false, selectedItems: [],
      scrollToWindowIndex: null, activeGroupIndex: 0,
      openModal: vi.fn(), toggleSelection: vi.fn(), enterSelectionMode: vi.fn(),
      setScrollToWindowIndex: vi.fn(), pushUndo: vi.fn(),
    }),
}))

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
}))

vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ data: { maxTabs: Infinity } }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: {} }) }))

const chromeMock = {
  tabs: { move: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
  windows: { create: vi.fn().mockResolvedValue({}) },
  tabGroups: { query: vi.fn().mockResolvedValue([]) },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
}
globalThis.chrome = chromeMock as unknown as typeof chrome

// ─── fixtures ────────────────────────────────────────────────────────────────

const TA: Tab = { id: 0, title: 'Alpha', url: 'https://a' }
const TB: Tab = { id: 0, title: 'Bravo', url: 'https://b' }
const TC: Tab = { id: 0, title: 'Charlie', url: 'https://c' }
// (TD fixture removed with the old ghost-card tests)

function win(tabs: Tab[]): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false }
}
function group(over: Partial<Group> & { windows: ExtWindow[] }): Group {
  return { id: 'g', name: 'G', color: 'rgba(0,0,0,1)', updatedAt: 0, permanent: false, ...over }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

function renderPanel(g: Group, groupIndex: number, seed: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], seed)
  const utils = render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(WindowsPanel, { group: g, groupIndex }),
      ),
    ),
  )
  return { qc, ...utils }
}

function tabRowsInWindow(container: HTMLElement, windowIndex: number): number {
  const win = container.querySelector(`[data-window-index="${windowIndex}"]`)
  if (!win) return 0
  return win.querySelectorAll('[data-testid="tab-item"]').length
}

beforeEach(() => {
  vi.clearAllMocks()
  cap.contextCount = 0
  cap.sortableStrategies = []
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('32. onDragOver does NOT reflow the lists mid-drag', () => {
  it('the source/target windows keep their exact row counts during the drag (a mid-drag reflow would abort the native HTML5 drag) — no insertion-line element either', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }]), win([{ ...TC }])] })
    const { container } = renderPanel(saved, 1, makeState([nowOpen, saved]))

    expect(cap.contextCount).toBe(1) // exactly one unified DndContext

    expect(tabRowsInWindow(container, 0)).toBe(2)
    expect(tabRowsInWindow(container, 1)).toBe(1)

    act(() => {
      cap.onDragStart!({ active: { id: 'saved::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      cap.onDragOver!({
        active: { id: 'saved::w0::t0' },
        over: { id: 'saved::w1::t0' },
      } as unknown as DragOverEvent)
    })

    // UNCHANGED — the source row stays mounted + in place; only the <DragOverlay>
    // moves. `Html5DragSensor` runs a native HTML5 drag and re-rendering the
    // dragged subtree mid-drag makes Chrome abort it.
    expect(tabRowsInWindow(container, 0)).toBe(2)
    expect(tabRowsInWindow(container, 1)).toBe(1)

    // no drawn insertion line either
    expect(container.querySelector('[data-insertion-line]')).toBeNull()
    expect(container.querySelector('[data-testid="insertion-line"]')).toBeNull()
  })
})

describe('33. onDragCancel after an onDragOver leaves the structure untouched', () => {
  it('there is no mid-drag reflow to revert — counts are stable through start → over → cancel', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }]), win([{ ...TC }])] })
    const { container } = renderPanel(saved, 1, makeState([nowOpen, saved]))

    act(() => { cap.onDragStart!({ active: { id: 'saved::w0::t0' } } as unknown as DragStartEvent) })
    act(() => {
      cap.onDragOver!({
        active: { id: 'saved::w0::t0' }, over: { id: 'saved::w1::t0' },
      } as unknown as DragOverEvent)
    })
    expect(tabRowsInWindow(container, 0)).toBe(2)
    expect(tabRowsInWindow(container, 1)).toBe(1)

    act(() => { cap.onDragCancel!({ active: { id: 'saved::w0::t0' } } as unknown as DragCancelEvent) })

    expect(tabRowsInWindow(container, 0)).toBe(2)
    expect(tabRowsInWindow(container, 1)).toBe(1)
  })
})

describe('34. no React-rendered drag ghost inside the DndContext subtree', () => {
  // There is no `<DragOverlay>` and no React ghost component. The drag ghost is
  // created IMPERATIVELY by `Html5DragSensor` into `#tm-dnd-aux-host` (a <body>
  // sibling of #root, OUTSIDE <DndContext>) and positioned by a rAF loop — never
  // a React re-render, so it can't mutate a grip's ancestor chain and abort the
  // native drag. Ghost lifecycle is covered by `dndHtml5Sensor.test.ts`; here we
  // only assert nothing React-side renders a ghost into the provider tree.

  it('starting a drag adds NO drag-overlay / ghost element inside the provider', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }])] })
    renderPanel(saved, 1, makeState([nowOpen, saved]))
    expect(document.querySelectorAll('[data-testid="drag-overlay"]')).toHaveLength(0)
    act(() => { cap.onDragStart!({ active: { id: 'saved::w0::t0' } } as unknown as DragStartEvent) })
    expect(document.querySelectorAll('[data-testid="drag-overlay"]')).toHaveLength(0)
    expect(document.getElementById('tm-dnd-ghost-host')).toBeNull()
  })

  it('starting a drag does not add a child inside the dnd-provider subtree', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }, { ...TC }])] })
    const { container } = renderPanel(saved, 1, makeState([nowOpen, saved]))
    const provider = container.querySelector('[data-testid="dnd-provider"]')!
    const before = provider.querySelectorAll('*').length
    act(() => { cap.onDragStart!({ active: { id: 'saved::w0' } } as unknown as DragStartEvent) })
    expect(provider.querySelectorAll('*').length).toBe(before)
  })
})

describe('35. keyboard DnD + screen-reader announcements', () => {
  it('wires a non-empty announcements object for start/over/end', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }])] })
    renderPanel(saved, 1, makeState([nowOpen, saved]))

    const a = cap.announcements
    expect(a).toBeDefined()
    expect(typeof a!.onDragStart).toBe('function')
    expect(typeof a!.onDragOver).toBe('function')
    expect(typeof a!.onDragEnd).toBe('function')

    for (const type of ['tab', 'window', 'group'] as const) {
      const started = a!.onDragStart!({ active: { id: `saved::w0::t0`, data: { current: { type } } } } as never)
      expect(typeof started).toBe('string')
      expect((started as string).length).toBeGreaterThan(0)
    }
  })

  it('a keyboard drag (Space to lift, Arrow to move, Space to drop) commits a model move', () => {
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }, { ...TC }])] })
    const { qc } = renderPanel(saved, 1, makeState([nowOpen, saved]))

    // simulate the sensor's resolved gesture landing in onDragEnd
    act(() => {
      void cap.onDragEnd!({
        active: { id: 'saved::w0::t0' },
        over: { id: 'saved::w0::t2' },
      } as unknown as DragEndEvent)
    })

    const next = qc.getQueryData<GroupsState>(['groups'])!
    expect(next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })
})

describe('35. windows + tabs SortableContexts use the REAL verticalListSortingStrategy', () => {
  // Regression guard: a prior round swapped both to `() => null` to kill a
  // post-drop flicker, which also killed the classic "siblings slide out of the
  // way" live preview. It's back (CSS-transform-only, no data mutation) — pin it
  // here so it can't silently regress to a no-op again.
  it('both the tabs list and the windows list pass the real strategy, never a no-op', async () => {
    const { verticalListSortingStrategy } = await import('@dnd-kit/sortable')
    const nowOpen = group({ id: 'now-open', permanent: true, windows: [] })
    const saved = group({ id: 'saved', windows: [win([{ ...TA }, { ...TB }]), win([{ ...TC }])] })
    renderPanel(saved, 1, makeState([nowOpen, saved]))

    expect(cap.sortableStrategies.length).toBeGreaterThan(0)
    for (const s of cap.sortableStrategies) {
      expect(s).toBe(verticalListSortingStrategy)
    }
  })
})
