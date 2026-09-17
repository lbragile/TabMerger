/**
 * tabSuppressTransform.test.tsx  — REWRITTEN for the DnD rework (RED PHASE)
 *
 * WHAT CHANGED & WHY:
 *   The old file verified a workaround: because tabs used to live inside a
 *   PER-WINDOW <DndContext>, dnd-kit's `useSortable` transform for tabs in a
 *   non-hovered window produced janky motion, so `TabItem` took `isDraggingTab` +
 *   `activeWindowIndex` props and blanked `style.transform` / `style.transition`
 *   for tabs whose window wasn't the active one.
 *
 *   After the rework every tab in the panel is in ONE unified <DndContext> /
 *   <SortableContext>, so `useSortable` computes correct cross-window transforms on
 *   its own and the suppression hack is REMOVED. The new working path: a tab keeps
 *   its sortable transform during a drag regardless of which window it's in — that
 *   is what animates the placeholder gap in both the source and the target window.
 *
 *   This test now asserts the suppression is gone: even with the (now vestigial)
 *   `isDraggingTab` / `activeWindowIndex` props supplied, the transform is applied.
 *
 * MUST fail now — current `TabItem` still suppresses, and `@/hooks/useDndModel`
 * does not exist. Green once reworked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
// RED anchor — module created by the rework.
import { buildDndModel } from '@/hooks/useDndModel'
import { TabItem } from '@/components/Windows/Tab'
import type { Tab } from '@/lib/types'

const { getTransform, setTransform } = vi.hoisted(() => {
  type Transform = { x: number; y: number; scaleX: number; scaleY: number } | null
  let _t: Transform = null
  return { getTransform: () => _t, setTransform: (t: Transform) => { _t = t } }
})

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: getTransform(), transition: 'transform 200ms ease', isDragging: false,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: (t: { x: number; y: number } | null) => (t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '') } },
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  DragOverlay: () => null,
  useSensors: vi.fn(() => []),
  useSensor: vi.fn(),
}))
vi.mock('@/hooks/useGroups', () => ({
  useDeleteTab: () => ({ mutate: vi.fn() }),
  useMoveTab: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: undefined }),
  useUpdateTabNote: () => ({ mutate: vi.fn() }),
  useSetTabReminder: () => ({ mutate: vi.fn() }),
  useClearTabReminder: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: object) => unknown) =>
    sel({ selectionMode: false, selectedItems: [], openModal: vi.fn(), toggleSelection: vi.fn(), enterSelectionMode: vi.fn() }),
}))
vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({ confirmOnTabClose: false }),
}))
vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: vi.fn().mockResolvedValue(undefined) }))

const chromeMock = { tabs: { create: vi.fn() }, tabGroups: undefined }
globalThis.chrome = chromeMock as unknown as typeof chrome

const TAB: Tab = { id: 0, title: 'Test Tab', url: 'https://example.com' }

function renderTab(props: { isDraggingTab?: boolean; activeWindowIndex?: number | null; windowIndex?: number }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(TabItem, {
          tab: TAB,
          groupIndex: 0,
          windowIndex: props.windowIndex ?? 0,
          tabIndex: 0,
          siblingCount: 2,
          isDraggingTab: props.isDraggingTab,
          activeWindowIndex: props.activeWindowIndex,
        } as never),
      ),
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setTransform(null)
})

describe('TabItem — cross-window transform suppression hack REMOVED (single unified DndContext)', () => {
  // Anchor the new model module so this file is also gated on the rework landing.
  it('depends on the new DnD model module', () => {
    const model = buildDndModel({
      active: { id: 'g', index: 0 },
      available: [{ id: 'g', name: 'g', color: 'x', updatedAt: 0, permanent: true, windows: [] }],
    })
    expect(model.permanentGroupId).toBeDefined()
  })

  it('a tab in a NON-active window during a tab drag KEEPS its sortable transform (old code blanked it to "")', () => {
    setTransform({ x: 0, y: -24, scaleX: 1, scaleY: 1 })
    const { container } = renderTab({ isDraggingTab: true, activeWindowIndex: 1, windowIndex: 0 })
    const div = container.firstElementChild as HTMLElement
    // OLD: suppressTransform === true → style.transform === '' and style.transition === ''
    expect(div.style.transform).toBe('translate3d(0px, -24px, 0)')
    expect(div.style.transition).toBe('transform 200ms ease')
  })
})
