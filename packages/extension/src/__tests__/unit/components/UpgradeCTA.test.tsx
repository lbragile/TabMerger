import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseEntitlements, mockUseGroups } = vi.hoisted(() => {
  const mockUseEntitlements = vi.fn()
  const mockUseGroups = vi.fn()
  return { mockUseEntitlements, mockUseGroups }
})

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: mockUseEntitlements,
  isApproachingLimit: (g: number, t: number, mg: number, mt: number) =>
    g >= mg - 1 || t >= mt - 5,
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: mockUseGroups,
}))

// chrome.tabs.create stub
const mockTabsCreate = vi.fn()
globalThis.chrome = { tabs: { create: mockTabsCreate } } as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freeEntitlements(overrides: Partial<ReturnType<typeof mockUseEntitlements>> = {}) {
  return {
    tier: 'free',
    maxGroups: 5,
    maxTabs: 50,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    subscriptionStatus: null,
    loading: false,
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, ui))
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mockTabsCreate.mockResolvedValue(undefined)
})

describe('UpgradeCTA', () => {
  // 4 saved groups (index 1-4 after Now Open) — approaching limit of 5
  const approachingGroupsState = {
    data: {
      available: [
        { id: 'g0', permanent: true, windows: [] },
        { id: 'g1', windows: [{ tabs: [] }] },
        { id: 'g2', windows: [{ tabs: [] }] },
        { id: 'g3', windows: [{ tabs: [] }] },
        { id: 'g4', windows: [{ tabs: [] }] },
      ],
      active: { id: 'g0', index: 0 },
    },
  }

  const safeGroupsState = {
    data: {
      available: [
        { id: 'g0', permanent: true, windows: [] },
        { id: 'g1', windows: [{ tabs: [] }] },
      ],
      active: { id: 'g0', index: 0 },
    },
  }

  async function renderCTA() {
    const { UpgradeCTA } = await import('@/components/UpgradeCTA')
    return wrap(React.createElement(UpgradeCTA))
  }

  it('renders when approaching group limit (free tier, 4 groups)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    expect(screen.getByText(/approaching the free limit/)).toBeInTheDocument()
  })

  it('does not render for pro users', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({ tier: 'pro', maxGroups: Infinity, maxTabs: Infinity }))
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('does not render when subscriptionStatus is not null (e.g. past_due)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({ subscriptionStatus: 'past_due' }))
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('does not render when well within limits', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(safeGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('dismiss button sets sessionStorage and hides banner', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    expect(screen.getByText(/approaching the free limit/)).toBeInTheDocument()

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    await user.click(dismissBtn)

    expect(screen.queryByText(/approaching the free limit/)).toBeNull()
    expect(sessionStorage.getItem('upgrade_cta_dismissed')).toBe('1')
  })

  it('upgrade button opens pricing page', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    await user.click(screen.getByRole('button', { name: /upgrade/i }))
    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/pricing') }))
  })

  it('does not render if already dismissed in sessionStorage', async () => {
    sessionStorage.setItem('upgrade_cta_dismissed', '1')
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })
})
