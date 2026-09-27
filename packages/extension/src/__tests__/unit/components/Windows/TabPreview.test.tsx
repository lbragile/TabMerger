import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabPreview } from '@/components/Windows/TabPreview'
import type { Tab } from '@/lib/types'

const { mockUseEntitlements, mockFetchSummary, mockUseAppSettings } = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockFetchSummary: vi.fn(),
  mockUseAppSettings: vi.fn(),
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
// showPreviewImages defaults OFF — tests that need the network fetch path opt in explicitly.
vi.mock('@/hooks/useAppSettings', () => ({
  useAppSettings: () => mockUseAppSettings(),
  DEFAULT_APP_SETTINGS: { showPreviewImages: false },
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
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: false } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: null, description: null }) }))
  })

  it('renders trigger children without showing tooltip content initially', () => {
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    expect(screen.getByText('Example Page')).toBeTruthy()
    expect(screen.queryByText('https://example.com')).toBeNull()
  })

  it('shows tab title/url and a "Not enabled" placeholder on hover when the setting is off (non-AI tier)', async () => {
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('https://example.com').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByText('Not enabled').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/Page images are off\. Turn on in Settings\./).length).toBeGreaterThan(0)
  })

  it('uses the pre-supplied ogImage without hitting the network when tab.ogImage is set', async () => {
    const user = userEvent.setup()
    wrap(<TabPreview tab={makeTab({ ogImage: 'https://img.example.com/x.png' })}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.queryByText('No preview')).toBeNull())
    expect(fetch).not.toHaveBeenCalled()
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
    // ponytail: getPageMetaForTab() short-circuits (no fetch at all) when VITE_WEB_APP_URL is
    // unset — this test only exercises the fetchedRef guard, not that short-circuit, so it must
    // pin the env explicitly rather than riding on whatever `.env.local` happens to supply.
    // Without this, the test silently passed locally (dev's `.env.local` sets a real
    // VITE_WEB_APP_URL, so `import.meta.env.VITE_WEB_APP_URL` is truthy as vitest's ambient
    // default) but failed in CI (no `.env.local` → fetch is never called → 0 vs 1 assertion).
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: true } })
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    const trigger = screen.getByText('Example Page')
    await user.hover(trigger)
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches the og:image via a POST to the server-side og-preview API when the setting is on', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: 'https://img.example.com/og.png', description: null }) }))
    const user = userEvent.setup()
    wrap(<TabPreview tab={makeTab({ id: 42 })}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(document.querySelector('img[src="https://img.example.com/og.png"]')).not.toBeNull())
    expect(fetch).toHaveBeenCalledWith('https://tabmerger.app/api/og-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
  })

  it('shows "No preview" without crashing when the server route returns null (setting on)', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ogImage: null }) }))
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
  })

  it('shows "No preview" without crashing when the fetch itself rejects (setting on)', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: true } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
  })

  it('never calls fetch when the setting is off, even with a valid VITE_WEB_APP_URL', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: false } })
    const user = userEvent.setup()
    wrap(<TabPreview {...{ tab: makeTab() }}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(screen.getAllByText('Not enabled').length).toBeGreaterThan(0))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a stored ogImage instead of "No preview" when the setting is off', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockUseAppSettings.mockReturnValue({ data: { showPreviewImages: false } })
    const user = userEvent.setup()
    wrap(<TabPreview tab={makeTab({ ogImage: 'https://img.example.com/stored.png' })}><span>Example Page</span></TabPreview>)
    await user.hover(screen.getByText('Example Page'))
    await waitFor(() => expect(document.querySelector('img[src="https://img.example.com/stored.png"]')).not.toBeNull())
    expect(fetch).not.toHaveBeenCalled()
  })
})
