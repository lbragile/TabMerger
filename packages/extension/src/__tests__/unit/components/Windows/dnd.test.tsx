/**
 * dnd.test.tsx  — REWRITTEN for the DnD rework (RED PHASE)
 *
 * WHAT CHANGED & WHY:
 *   The old file rendered <WindowsPanel> with a stubbed per-panel <DndContext> and
 *   asserted that dragging a window "delegates to onWindowDragEnd" (a separate
 *   `useWindowDndHandlers` hook) and that WindowsPanel itself never calls
 *   `saveGroupsState`. After the rework there is ONE unified <DndContext> and no
 *   delegation hop — the panel's own `onDragEnd` runs the pure `applyMove` and
 *   persists the result. This test is re-expressed as: dragging a window inside a
 *   saved group commits the reorder through the unified handler and writes it back
 *   to the query cache. The old string ids ("window-1-0") are replaced by
 *   synthesized model ids from `buildDndModel`.
 *
 *   Tab move-logic assertions that used to live here now live in
 *   `src/__tests__/unit/lib/dndMove.test.ts` (pure) and
 *   `src/__tests__/unit/components/Windows/unifiedDnd.test.tsx` (reflow/overlay).
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
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'

const cap = vi.hoisted(() => {
  const s: { onDragStart?: (e: DragStartEvent) => void; onDragEnd?: (e: DragEndEvent) => void; count: number } = { count: 0 }
  return s
})

vi.mock('@dnd-kit/core', () => ({
  DndContext: (p: { children: React.ReactNode; onDragStart?: (e: DragStartEvent) => void; onDragEnd?: (e: DragEndEvent) => void }) => {
    cap.count += 1
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
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
vi.mock('@/components/Windows/Window', () => ({ WindowItem: () => React.createElement('div', { 'data-testid': 'window-item' }) }))
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
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: object) => unknown) =>
    sel({ searchFilter: '', selectionMode: false, selectedItems: [], scrollToWindowIndex: null, activeGroupIndex: 0, openModal: vi.fn(), setScrollToWindowIndex: vi.fn(), pushUndo: vi.fn() }),
}))
vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ data: { maxTabs: Infinity } }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: {} }) }))

import { saveGroupsState } from '@/lib/localDb'

const chromeMock = { tabs: { move: vi.fn().mockResolvedValue({}) }, tabGroups: { query: vi.fn().mockResolvedValue([]) } }
globalThis.chrome = chromeMock as unknown as typeof chrome

const TAB_A: Tab = { id: 0, title: 'Tab A', url: 'https://a.com' }
const TAB_B: Tab = { id: 0, title: 'Tab B', url: 'https://b.com' }

function makeWin(tabs: Tab[], name: string): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, name }
}
function makeGroup(over: Partial<Group> & { windows: ExtWindow[] }): Group {
  return { id: 'g1', name: 'Test Group', color: 'rgba(0,0,0,1)', updatedAt: 0, permanent: false, ...over }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}
function setup(group: Group, groupIndex: number, seed: GroupsState) {
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
  cap.count = 0
})

describe('WindowsPanel — unified DnD, window reorder inside a saved group', () => {
  it('commits a window reorder through the single unified onDragEnd and persists it', async () => {
    const nowOpen = makeGroup({ id: 'now-open', permanent: true, windows: [] })
    const saved = makeGroup({ id: 'saved-1', windows: [makeWin([{ ...TAB_A }], 'w0'), makeWin([{ ...TAB_B }], 'w1')] })
    const state = makeState([nowOpen, saved])
    const { qc } = setup(saved, 1, state)

    expect(cap.count).toBe(1) // exactly one DndContext for the whole panel

    const model = buildDndModel(state)
    const savedGid = model.groupIds[1]
    const [w0, w1] = model.groups[savedGid].windowIds

    await act(async () => { cap.onDragStart!({ active: { id: w0 } } as unknown as DragStartEvent) })
    await act(async () => { await cap.onDragEnd!({ active: { id: w0 }, over: { id: w1 } } as unknown as DragEndEvent) })

    const next = qc.getQueryData<GroupsState>(['groups'])!
    expect(next.available[1].windows.map((w) => w.name)).toEqual(['w1', 'w0'])
    expect(saveGroupsState).toHaveBeenCalledOnce()
  })
})
