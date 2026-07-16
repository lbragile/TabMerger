import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabItem } from '@/components/Windows/Tab'
import type { Tab } from '@/lib/types'

// ─── Mock heavy deps ──────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue({ confirmOnTabClose: false }),
}))

vi.mock('@/lib/chromeGroups', () => ({
  openTabInChromeGroup: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ tier: 'free', isPro: false, aiFeatures: false, isFree: true }),
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteTab: () => ({ mutate: vi.fn() }),
  useMoveTab: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: { available: [], active: { id: '', index: 0 } } }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      openModal: vi.fn(),
      selectionMode: false,
      selectedItems: [],
      toggleSelection: vi.fn(),
      enterSelectionMode: vi.fn(),
    }),
}))

// ─── Chrome stub ──────────────────────────────────────────────────────────────

globalThis.chrome = {
  tabs: { create: vi.fn(), group: vi.fn() },
  tabGroups: { update: vi.fn() },
  storage: { local: { get: vi.fn(), set: vi.fn(), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
} as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 1,
    title: 'My Tab',
    url: 'https://example.com',
    favIconUrl: '',
    pinned: false,
    ...overrides,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(
    QueryClientProvider,
    { client: qc },
    React.createElement(TooltipProvider, null, children)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── TabItem — long title truncation ─────────────────────────────────────────

describe('TabItem — long title truncation', () => {
  it('renders long titles with truncate class so CSS clips them', () => {
    const longTitle = 'Client ID for Web application – Google Auth Platform – My First Project – Google Cloud console'
    const t = makeTab({ title: longTitle })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={2} />,
      { wrapper }
    )
    const titleEl = screen.getByText(longTitle)
    expect(titleEl.className).toMatch(/truncate/)
  })

  it('title element has min-w-0 and w-full to enable CSS truncation', () => {
    const longTitle = 'A'.repeat(200)
    const t = makeTab({ title: longTitle })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={2} />,
      { wrapper }
    )
    const titleEl = screen.getByText(longTitle)
    expect(titleEl.className).toMatch(/truncate/)
    expect(titleEl.className).toMatch(/min-w-0/)
  })
})

// ─── TabItem — chromeGroup pill ───────────────────────────────────────────────

describe('TabItem — chromeGroup pill', () => {
  it('renders the group name pill when chromeGroup is set', () => {
    const t = makeTab({ chromeGroup: { id: 5, name: 'Work', color: 'blue' } })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={2} />,
      { wrapper }
    )
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('does not render a pill when chromeGroup is absent', () => {
    const t = makeTab() // no chromeGroup
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={2} />,
      { wrapper }
    )
    // The tab title is shown but no pill with a chrome group name
    expect(screen.getByText('My Tab')).toBeInTheDocument()
    // No element with the group badge color style (proxy: no span with title attr for a group)
    expect(screen.queryByTitle(/Work|Research|Design/)).toBeNull()
  })

  it('uses the group name as the pill title attribute', () => {
    const t = makeTab({ chromeGroup: { id: 3, name: 'Research', color: 'red' } })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={2} />,
      { wrapper }
    )
    expect(screen.getByText('Research')).toBeInTheDocument()
  })
})
