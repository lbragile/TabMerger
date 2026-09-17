/**
 * tabKeyboardDragVisuals.test.tsx — accessibility audit S1: during a KEYBOARD drag a
 * sighted user must SEE the row move. A keyboard drag has no native HTML5 session (spec
 * C4 doesn't apply), so the dragged row renders dnd-kit's live transform + a lifted style,
 * and the other selected rows riding along get a visible marker.
 *
 * A NATIVE (pointer) drag must render exactly as before: no transform on the dragged row
 * and no class change on it or on selected companions (that would abort the drag).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabItem } from '@/components/Windows/Tab'
import type { Tab } from '@/lib/types'

const s = vi.hoisted(() => ({
  isDragging: false,
  active: null as null | { id: string; keyboard?: boolean; selectionIds?: string[] },
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: { x: 0, y: 48, scaleX: 1, scaleY: 1 },
    transition: 'transform 200ms ease',
    isDragging: s.isDragging,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: (t: { x: number; y: number } | null) => (t ? `translate3d(${t.x}px, ${t.y}px, 0)` : '') } },
}))
vi.mock('@/components/dnd/DndProvider', () => ({
  useDndContext: () => ({ overrideState: null, active: s.active, isDragging: s.active != null, gap: null }),
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
  useUIStore: (sel: (st: object) => unknown) =>
    sel({ selectionMode: false, selectedItems: [], openModal: vi.fn(), toggleSelection: vi.fn(), enterSelectionMode: vi.fn() }),
}))
vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/hooks/useUrlRules', () => ({ useUrlRules: () => ({ data: [] }), matchUrlToRule: vi.fn() }))
vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: vi.fn().mockResolvedValue(undefined) }))

const TAB: Tab = { id: 0, title: 'Alpha', url: 'https://example.com/alpha' }

function row(tabIndex = 0): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(TabItem, { groupId: 'g', tab: TAB, groupIndex: 1, windowIndex: 0, tabIndex, siblingCount: 3 })
      )
    )
  )
  return container.querySelector('[role="listitem"]') as HTMLElement
}

beforeEach(() => {
  s.isDragging = false
  s.active = null
})

describe('TabItem — keyboard drag visuals (S1)', () => {
  it('KEYBOARD drag: the dragged row follows dnd-kit\'s transform and is visibly lifted', () => {
    s.isDragging = true
    s.active = { id: 'g::w0::t0', keyboard: true }
    const r = row()
    expect(r.style.transform).toBe('translate3d(0px, 48px, 0)')
    // ring-ring, not ring-primary: primary is 2.73:1 on a selected light row (WCAG 1.4.11 needs 3:1)
    expect(r.className.split(' ')).toEqual(expect.arrayContaining(['ring-2', 'ring-ring', 'shadow-lg']))
    expect(r.className.split(' ')).not.toContain('ring-primary')
  })

  it('NATIVE drag: the dragged row gets NO transform and NO lifted class (C4 unchanged)', () => {
    s.isDragging = true
    s.active = { id: 'g::w0::t0', keyboard: false }
    const r = row()
    expect(r.style.transform).toBe('')
    expect(r.className).not.toContain('shadow-lg')
    expect(r.className).not.toContain('outline-dashed')
  })

  it('KEYBOARD multi-drag: the OTHER selected rows are marked; unselected rows are not', () => {
    s.active = { id: 'g::w0::t0', keyboard: true, selectionIds: ['g::w0::t0', 'g::w0::t2'] }
    expect(row(2).className).toContain('outline-dashed')
  })

  it('KEYBOARD multi-drag: an unselected sibling carries no marker', () => {
    s.active = { id: 'g::w0::t0', keyboard: true, selectionIds: ['g::w0::t0', 'g::w0::t2'] }
    expect(row(1).className).not.toContain('outline-dashed')
  })

  it('NATIVE multi-drag: selected companions get no class change (the sensor collapses them instead)', () => {
    s.active = { id: 'g::w0::t0', keyboard: false, selectionIds: ['g::w0::t0', 'g::w0::t2'] }
    expect(row(2).className).not.toContain('outline-dashed')
  })
})
