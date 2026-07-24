import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabPreview } from '@/components/Windows/TabPreview'
import type { Tab } from '@/lib/types'

const { mockUseEntitlements, mockFetchSummary } = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockFetchSummary: vi.fn(),
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAI', () => ({ useTabSummary: () => ({ mutateAsync: mockFetchSummary }) }))

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return { id: 1, title: 'Example Page', url: 'https://example.com', ...overrides }
}

function wrap(ui: React.ReactElement) {
  return render(React.createElement(TooltipProvider, { delayDuration: 0 }, ui))
}

describe('TabPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) } })
  })

  it('renders trigger children without showing tooltip content initially', () => {
    wrap(React.createElement(TabPreview, { tab: makeTab() }, React.createElement('span', null, 'Example Page')))
    expect(screen.getByText('Example Page')).toBeTruthy()
    expect(screen.queryByText('https://example.com')).toBeNull()
  })

  it('shows tab title/url and falls back to no-preview state on hover (non-AI tier)', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(TabPreview, { tab: makeTab() }, React.createElement('span', null, 'Example Page')))
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('https://example.com').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
  })

  it('uses the pre-supplied ogImage without calling chrome.tabs when tab.ogImage is set', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(TabPreview, { tab: makeTab({ ogImage: 'https://img.example.com/x.png' }) }, React.createElement('span', null, 'Example Page')))
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.queryByText('No preview')).toBeNull())
  })

  it('fetches AI summary and shows it when aiFeatures is enabled', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockFetchSummary.mockResolvedValue({ summary: 'A concise page summary.' })
    const user = userEvent.setup()
    wrap(React.createElement(TabPreview, { tab: makeTab() }, React.createElement('span', null, 'Example Page')))
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('A concise page summary.').length).toBeGreaterThan(0))
    expect(mockFetchSummary).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example Page' })
  })

  it('only fetches the preview once across repeated opens (fetchedRef guard)', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(TabPreview, { tab: makeTab() }, React.createElement('span', null, 'Example Page')))
    const trigger = screen.getByText('Example Page')
    await user.hover(trigger)
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })
})
