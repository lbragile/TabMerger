import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import React from 'react'
import {
  INACTIVE_PANEL_SEARCH,
  PanelSearchContext,
  buildPanelSearchView,
  useSearchFilters,
  useSearchMode,
  usePanelSearch,
  withoutFilteredOut,
} from '@/hooks/useSearchView'
import { NO_FILTERS, groupSearchState } from '@/lib/searchMatch'
import { useUIStore } from '@/stores/uiStore'
import type { Group } from '@/lib/types'

const { mockSettings } = vi.hoisted(() => ({ mockSettings: vi.fn() }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockSettings() }))

const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title}` })
const group: Group = {
  id: 'g',
  name: 'Work',
  color: 'rgba(0,0,0,1)',
  updatedAt: 0,
  windows: [
    { id: 1, tabs: [tab('alpha'), tab('beta')], incognito: false, focused: false },
    { id: 2, tabs: [tab('gamma')], incognito: false, focused: false },
  ],
}
const filters = { ...NO_FILTERS, tabQuery: 'alpha' }

beforeEach(() => {
  mockSettings.mockReturnValue({ data: undefined })
  useUIStore.setState({ tourActive: false, searchFilter: '' })
})

describe('useSearchMode', () => {
  it('defaults to hide while settings load or when nothing is stored', () => {
    expect(renderHook(() => useSearchMode()).result.current).toBe('hide')
    mockSettings.mockReturnValue({ data: {} })
    expect(renderHook(() => useSearchMode()).result.current).toBe('hide')
  })

  it('returns the stored mode when it is valid', () => {
    mockSettings.mockReturnValue({ data: { searchNonMatching: 'dim' } })
    expect(renderHook(() => useSearchMode()).result.current).toBe('dim')
    mockSettings.mockReturnValue({ data: { searchNonMatching: 'hide' } })
    expect(renderHook(() => useSearchMode()).result.current).toBe('hide')
  })

  it('ignores a corrupt stored value (normalizes to the default)', () => {
    for (const bad of ['DIM', 'show', 1, null, {}]) {
      mockSettings.mockReturnValue({ data: { searchNonMatching: bad } })
      expect(renderHook(() => useSearchMode()).result.current).toBe('hide')
    }
  })

  it('is always dim while the guided tour runs, whatever is stored', () => {
    mockSettings.mockReturnValue({ data: { searchNonMatching: 'hide' } })
    useUIStore.setState({ tourActive: true })
    expect(renderHook(() => useSearchMode()).result.current).toBe('dim')
  })
})

describe('useSearchFilters', () => {
  it('is the shared empty filter set for an empty box (same object, no re-parse)', () => {
    expect(renderHook(() => useSearchFilters()).result.current).toBe(NO_FILTERS)
  })

  it('splits prefixes from plain words', () => {
    useUIStore.setState({ searchFilter: 'hello group:work window:main tag:x' })
    const f = renderHook(() => useSearchFilters()).result.current
    expect(f.groupFilter).toBe('work')
    expect(f.windowFilter).toBe('main')
    expect(f.tagFilter).toBe('x')
    expect(f.tabQuery).toBe('hello')
  })
})

describe('buildPanelSearchView / usePanelSearch', () => {
  const state = groupSearchState(group, filters)

  it('is the inactive view without an active search or without a group state', () => {
    expect(buildPanelSearchView(NO_FILTERS, 'hide', state)).toBe(INACTIVE_PANEL_SEARCH)
    expect(buildPanelSearchView(filters, 'hide', null)).toBe(INACTIVE_PANEL_SEARCH)
  })

  it('hide locks reordering; dim does not', () => {
    const hide = buildPanelSearchView(filters, 'hide', state)
    expect(hide).toMatchObject({ active: true, hide: true, reorderLocked: true })
    const dim = buildPanelSearchView(filters, 'dim', state)
    expect(dim).toMatchObject({ active: true, hide: false, reorderLocked: false })
  })

  it('usePanelSearch is inactive outside a panel and reads the provided view inside', () => {
    expect(renderHook(() => usePanelSearch()).result.current).toBe(INACTIVE_PANEL_SEARCH)
    const view = buildPanelSearchView(filters, 'hide', state)
    const wrapper = ({ children }: { children: React.ReactNode }) => <PanelSearchContext.Provider value={view}>{children}</PanelSearchContext.Provider>
    expect(renderHook(() => usePanelSearch(), { wrapper }).result.current).toBe(view)
  })
})

describe('withoutFilteredOut', () => {
  const items = [
    { type: 'tab' as const, id: 'tab-1-0-0' }, // alpha: matches
    { type: 'tab' as const, id: 'tab-1-0-1' }, // beta: no
    { type: 'window' as const, id: 'window-1-0' }, // has a match
    { type: 'window' as const, id: 'window-1-1' }, // none
    { type: 'tab' as const, id: 'tab-1-1-0' }, // gamma: no
  ]

  it('returns the items untouched with no active search', () => {
    expect(withoutFilteredOut(INACTIVE_PANEL_SEARCH, items)).toBe(items)
  })

  it('hide mode drops non-matching tabs and windows that are not drawn', () => {
    const view = buildPanelSearchView(filters, 'hide', groupSearchState(group, filters))
    expect(withoutFilteredOut(view, items).map((i) => i.id)).toEqual(['tab-1-0-0', 'window-1-0'])
  })

  it('dim mode drops non-matching tabs but keeps every window (they are still drawn)', () => {
    const view = buildPanelSearchView(filters, 'dim', groupSearchState(group, filters))
    expect(withoutFilteredOut(view, items).map((i) => i.id)).toEqual(['tab-1-0-0', 'window-1-0', 'window-1-1'])
  })

  it('keeps items it cannot place (other id shapes, unknown indices)', () => {
    const view = buildPanelSearchView(filters, 'hide', groupSearchState(group, filters))
    const odd = [{ type: 'tab' as const, id: 'weird' }, { type: 'tab' as const, id: 'tab-1-9-9' }]
    expect(withoutFilteredOut(view, odd)).toEqual(odd)
  })
})
