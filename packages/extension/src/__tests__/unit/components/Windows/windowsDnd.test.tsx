/**
 * windowsDnd.test.tsx  — REWRITTEN for the DnD rework (RED PHASE)
 *
 * WHAT CHANGED & WHY:
 *   The old file drove <WindowsPanel> / <WindowItem> through string ids
 *   ("tab-101-0-0", "window-1-1") + a locally-mocked `parseDndId`, and asserted the
 *   full move pipeline (cross-window tab drop, window-header drop, same-window
 *   reorder, Now Open `chrome.tabs.move`, 50% insert threshold, new-window drop
 *   zone). After the rework:
 *     - Move LOGIC (all of the above, incl. Now Open side-effects and the
 *       target-index math) is pure and lives in `src/__tests__/unit/lib/dndMove.test.ts`.
 *     - Placeholder reflow / single DragOverlay / announcements live in
 *       `src/__tests__/unit/components/Windows/unifiedDnd.test.tsx`.
 *   What remains genuinely component-level — and is KEPT here, converted to the
 *   synthesized model-id scheme from `buildDndModel` — is the `id:0` rendering
 *   invariants: windows/tabs that all share `id:0` must still get distinct keys,
 *   the correct row must be picked positionally, and dragging one `id:0` window
 *   must not visually collapse its `id:0` siblings.
 *
 * MUST fail now with "Cannot find module '@/hooks/useDndModel'". Green once reworked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { buildDndModel } from '@/hooks/useDndModel'
import { WindowsPanel } from '@/components/Windows'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'

const cap = vi.hoisted(() => {
  const s: { onDragStart?: (e: DragStartEvent) => void; onDragEnd?: (e: DragEndEvent) => void } = {}
  return s
})

vi.mock('@dnd-kit/core', () => ({
  DndContext: (p: { children: React.ReactNode; onDragStart?: (e: DragStartEvent) => void; onDragEnd?: (e: DragEndEvent) => void }) => {
    cap.onDragStart = p.onDragStart
    cap.onDragEnd = p.onDragEnd
    return React.createElement(React.Fragment, null, p.children)
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
  DragOverlay: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: <T,>(a: T[], f: number, t: number): T[] => { const c = [...a]; const [x] = c.splice(f, 1); c.splice(t, 0, x); return c },
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: 'transform 200ms ease', isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: (t: { x: number; y: number } | null) => (t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '') } } }))
vi.mock('@/components/Windows/Tab', () => ({ TabItem: ({ tab }: { tab: Tab }) => React.createElement('div', { 'data-testid': 'tab-item' }, tab.title) }))
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
  useUIStore: (sel: (s: object) => unknown) =>
    sel({ searchFilter: '', selectionMode: false, selectedItems: [], scrollToWindowIndex: null, activeGroupIndex: 0, openModal: vi.fn(), toggleSelection: vi.fn(), enterSelectionMode: vi.fn(), setScrollToWindowIndex: vi.fn(), pushUndo: vi.fn() }),
}))
vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue({ confirmOnWindowClose: false }),
}))
vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ data: { maxTabs: Infinity } }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: {} }) }))

const chromeMock = {
  tabs: { move: vi.fn().mockResolvedValue({}) },
  windows: { create: vi.fn().mockResolvedValue({}) },
  tabGroups: { query: vi.fn().mockResolvedValue([]) },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
}
globalThis.chrome = chromeMock as unknown as typeof chrome

const TAB_A: Tab = { id: 0, title: 'Tab A', url: 'https://a.com' }
const TAB_B: Tab = { id: 0, title: 'Tab B', url: 'https://b.com' }
const TAB_C: Tab = { id: 0, title: 'Tab C', url: 'https://c.com' }

function makeWin(tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, ...over }
}
function makeGroup(over: Partial<Group> & { windows: ExtWindow[] }): Group {
  return { id: 'g1', name: 'Test Group', color: 'rgba(0,0,0,1)', updatedAt: 0, permanent: false, ...over }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}
function setupPanel(group: Group, groupIndex: number, seed: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], seed)
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null, React.createElement(WindowsPanel, { group, groupIndex })),
    ),
  )
  return { qc }
}

beforeEach(() => {
  vi.clearAllMocks()
  chromeMock.tabs.move.mockResolvedValue({})
})

describe('id:0 rendering invariants (windows/tabs that all share id:0)', () => {
  it('renders one row per window even when three windows share id:0', () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({
      id: 'saved-1',
      windows: [makeWin([{ ...TAB_A }]), makeWin([{ ...TAB_B }]), makeWin([{ ...TAB_C }])],
    })
    setupPanel(saved, 1, makeState([nowOpen, saved]))
    expect(document.querySelectorAll('[data-window-index]').length).toBe(3)
  })

  it('dragging the middle id:0 window does NOT mutate any window row (native HTML5 drag would abort); all 3 stay visible', async () => {
    const state = makeState([
      makeGroup({ id: 'now-open', permanent: true, windows: [] }),
      makeGroup({ id: 'saved-1', windows: [makeWin([{ ...TAB_A }]), makeWin([{ ...TAB_B }]), makeWin([{ ...TAB_C }])] }),
    ])
    setupPanel(state.available[1], 1, state)

    const model = buildDndModel(state)
    const savedGid = model.groupIds[1]
    const midWindowId = model.groups[savedGid].windowIds[1]

    const before = (Array.from(document.querySelectorAll('[data-window-index]')) as HTMLElement[]).map((r) => r.className)

    await act(async () => { cap.onDragStart!({ active: { id: midWindowId } } as unknown as DragStartEvent) })

    const rows = Array.from(document.querySelectorAll('[data-window-index]')) as HTMLElement[]
    expect(rows).toHaveLength(3)
    // no `opacity-0` / dragging class churn on the dragged row — the ghost card is the affordance
    expect(rows.some((r) => r.className.includes('opacity-0'))).toBe(false)
    expect(rows.map((r) => r.className)).toEqual(before)
  })

  it('cross-window drag uses the positionally-correct id:0 tab (second tab), not the first', async () => {
    const state = makeState([
      makeGroup({ id: 'now-open', permanent: true, windows: [] }),
      makeGroup({
        id: 'saved-1',
        windows: [
          makeWin([{ id: 0, title: 'Zero A', url: 'https://a' }, { id: 0, title: 'Zero B', url: 'https://b' }]),
          makeWin([{ id: 0, title: 'Zero C', url: 'https://c' }]),
        ],
      }),
    ])
    const { qc } = setupPanel(state.available[1], 1, state)

    const model = buildDndModel(state)
    const savedGid = model.groupIds[1]
    const [w0, w1] = model.groups[savedGid].windowIds
    const zeroB = model.windows[w0].tabIds[1] // the SECOND id:0 tab

    await act(async () => { cap.onDragStart!({ active: { id: zeroB } } as unknown as DragStartEvent) })
    await act(async () => { await cap.onDragEnd!({ active: { id: zeroB }, over: { id: w1 } } as unknown as DragEndEvent) })

    const next = qc.getQueryData<GroupsState>(['groups'])!
    expect(next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['Zero A'])
    expect(next.available[1].windows[1].tabs.map((t) => t.title)).toEqual(['Zero C', 'Zero B'])
  })
})
