/**
 * tabSuppressTransform.test.tsx
 *
 * Verifies that TabItem suppresses dnd-kit's CSS transform for tabs in
 * non-active windows during a tab drag, while tabs in the active (hovered)
 * window keep their transforms so they can animate the insertion gap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabItem } from '@/components/Windows/Tab'
import type { Tab } from '@/lib/types'

const { getTransform, setTransform } = vi.hoisted(() => {
  type Transform = { x: number; y: number; scaleX: number; scaleY: number } | null
  let _t: Transform = null
  return {
    getTransform: () => _t,
    setTransform: (t: Transform) => { _t = t },
  }
})

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: getTransform(),
    transition: 'transform 200ms ease',
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (t: { x: number; y: number } | null) =>
        t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '',
    },
  },
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
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
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      selectionMode: false,
      selectedItems: [],
      openModal: vi.fn(),
      toggleSelection: vi.fn(),
      enterSelectionMode: vi.fn(),
    }),
}))

vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue({ confirmOnTabClose: false }),
}))

vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

vi.mock('@/lib/chromeGroups', () => ({
  openTabInChromeGroup: vi.fn().mockResolvedValue(undefined),
}))

const chromeMock = { tabs: { create: vi.fn() }, tabGroups: undefined }
globalThis.chrome = chromeMock as unknown as typeof chrome

const TAB: Tab = { id: 1, title: 'Test Tab', url: 'https://example.com' }

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
        })
      )
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setTransform(null)
})

describe('TabItem suppressTransform', () => {
  it('suppresses transform in non-active window (activeWindowIndex !== windowIndex)', () => {
    setTransform({ x: 0, y: -24, scaleX: 1, scaleY: 1 })
    // Tab is in window 0, but active window is window 1 → suppress
    const { container } = renderTab({ isDraggingTab: true, activeWindowIndex: 1, windowIndex: 0 })
    const div = container.firstElementChild as HTMLElement
    expect(div.style.transform).toBe('')
    expect(div.style.transition).toBe('')
  })

  it('applies transform in active window (activeWindowIndex === windowIndex)', () => {
    setTransform({ x: 0, y: -24, scaleX: 1, scaleY: 1 })
    // Tab is in window 1, active window is also 1 → animate
    const { container } = renderTab({ isDraggingTab: true, activeWindowIndex: 1, windowIndex: 1 })
    const div = container.firstElementChild as HTMLElement
    expect(div.style.transform).toBe('translate3d(0px, -24px, 0)')
  })

  it('applies transform when not dragging (isDraggingTab=false)', () => {
    setTransform({ x: 0, y: 10, scaleX: 1, scaleY: 1 })
    const { container } = renderTab({ isDraggingTab: false, activeWindowIndex: 1, windowIndex: 0 })
    const div = container.firstElementChild as HTMLElement
    expect(div.style.transform).toBe('translate3d(0px, 10px, 0)')
  })
})
