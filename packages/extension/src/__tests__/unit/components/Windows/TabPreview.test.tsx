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

const MockQuotaExceededError = vi.hoisted(() => class extends Error {
  isQuotaExceeded = true as const
})

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAI', () => ({
  useTabSummary: () => ({ mutateAsync: mockFetchSummary }),
  QuotaExceededError: MockQuotaExceededError,
}))
vi.mock('@/components/AIQuotaExceededPrompt', () => ({
  AIQuotaExceededPrompt: () => React.createElement('div', null, 'Buy more AI calls'),
}))

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return { id: 1, title: 'Example Page', url: 'https://example.com', ...overrides }
}

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)
}

describe('TabPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) } })
  })

  it('renders trigger children without showing tooltip content initially', () => {
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    expect(screen.getByText('Example Page')).toBeTruthy()
    expect(screen.queryByText('https://example.com')).toBeNull()
  })

  it('shows tab title/url and falls back to no-preview state on hover (non-AI tier)', async () => {
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('https://example.com').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
  })

  it('uses the pre-supplied ogImage without calling chrome.tabs when tab.ogImage is set', async () => {
    const user = userEvent.setup()
    wrap(<TabPreview tab={makeTab({ ogImage: 'https://img.example.com/x.png' })}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.queryByText('No preview')).toBeNull())
  })

  it('does not auto-fetch AI summary on hover, but shows a Generate summary button', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /generate summary/i, hidden: true }).length).toBeGreaterThan(0))
    expect(mockFetchSummary).not.toHaveBeenCalled()
  })

  it('fetches AI summary when the Generate summary button is clicked', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockFetchSummary.mockResolvedValue({ summary: 'A concise page summary.' })
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    const buttons = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: /generate summary/i, hidden: true })
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    const button = buttons[0]
    await user.click(button)
    await waitFor(() => expect(screen.getAllByText('A concise page summary.').length).toBeGreaterThan(0))
    expect(mockFetchSummary).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example Page' })
  })

  it('shows the buy-more-AI-calls CTA instead of silently failing when generateSummary hits a quota-exceeded error', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockFetchSummary.mockRejectedValue(new MockQuotaExceededError('quota exceeded'))
    const user = userEvent.setup()
    wrap(<TabPreview tab={makeTab({ url: 'https://quota-exceeded-example.com' })}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    const buttons = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: /generate summary/i, hidden: true })
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    await user.click(buttons[0])
    await waitFor(() => expect(screen.getAllByText('Buy more AI calls').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /generate summary/i, hidden: true })).toBeNull()
  })

  it('only fetches the preview once across repeated opens (fetchedRef guard)', async () => {
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    const trigger = screen.getByText('Example Page')
    await user.hover(trigger)
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  describe('server og-image fallback', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    })

    it('live tab: falls back to the server route when the content script yields nothing', async () => {
      vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) } })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: 'https://img.example.com/server.png' }) }))
      const user = userEvent.setup()
      wrap(<TabPreview tab={makeTab({ id: 42 })} isLive={true}><span>Example Page</span></TabPreview>)
      await user.hover(screen.getByText('Example Page'))
      await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://tabmerger.app/api/og-preview?url=https%3A%2F%2Fexample.com'))
      // ponytail: assert on the rendered <img src> rather than "No preview" absence —
      // jsdom fires the <img>'s onError synchronously (it can't actually load images),
      // which would otherwise flip the fallback back on right after this resolves.
      await waitFor(() => expect(document.querySelector('img[src="https://img.example.com/server.png"]')).not.toBeNull())
    })

    it('saved/non-live tab: goes straight to the server route without messaging chrome.tabs', async () => {
      const sendMessage = vi.fn()
      vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]), sendMessage } })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: 'https://img.example.com/server.png' }) }))
      const user = userEvent.setup()
      wrap(<TabPreview {...{ tab: makeTab(), isLive: false }}><span>Example Page</span></TabPreview>)
      await user.hover(screen.getByText('Example Page'))
      await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://tabmerger.app/api/og-preview?url=https%3A%2F%2Fexample.com'))
      await waitFor(() => expect(document.querySelector('img[src="https://img.example.com/server.png"]')).not.toBeNull())
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('shows "No preview" without crashing when the server route also returns null', async () => {
      vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockRejectedValue(new Error('no receiver')) } })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: null }) }))
      const user = userEvent.setup()
      wrap(<TabPreview {...{ tab: makeTab(), isLive: false }}><span>Example Page</span></TabPreview>)
      await user.hover(screen.getByText('Example Page'))
      await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
    })
  })
})
